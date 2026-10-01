use app_core::{Reminder, ReminderQuery, ReminderView};
use chrono::{DateTime, Local, NaiveDate, Utc};
use data_client::DataClient;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex},
    thread,
    time::Duration,
};
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

const CHECK_INTERVAL: Duration = Duration::from_secs(30);
const HISTORY_FILE: &str = "overdue-notifications.json";

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
struct NotificationHistory {
    #[serde(default)]
    notified_due_at: HashMap<String, i64>,
}

#[derive(Default)]
struct OverdueNotificationInner {
    enabled: Mutex<bool>,
    wake: Condvar,
    history: Mutex<NotificationHistory>,
    history_path: Mutex<Option<PathBuf>>,
}

#[derive(Clone, Default)]
pub struct OverdueNotificationState(Arc<OverdueNotificationInner>);

impl OverdueNotificationState {
    pub fn initialize(&self, app_data_dir: PathBuf) -> Result<(), String> {
        fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
        let path = app_data_dir.join(HISTORY_FILE);
        let history = load_history(&path);
        *self
            .0
            .history
            .lock()
            .map_err(|_| "notification history is unavailable".to_owned())? = history;
        *self
            .0
            .history_path
            .lock()
            .map_err(|_| "notification history path is unavailable".to_owned())? = Some(path);
        Ok(())
    }

    pub fn set_enabled(&self, enabled: bool) {
        if let Ok(mut current) = self.0.enabled.lock() {
            *current = enabled;
            self.0.wake.notify_all();
        }
    }

    pub(crate) fn is_enabled(&self) -> bool {
        self.0.enabled.lock().is_ok_and(|enabled| *enabled)
    }

    fn wait_until_enabled(&self) {
        let Ok(mut enabled) = self.0.enabled.lock() else {
            return;
        };
        while !*enabled {
            let Ok(next) = self.0.wake.wait(enabled) else {
                return;
            };
            enabled = next;
        }
    }

    fn wait_for_next_check(&self) {
        let Ok(enabled) = self.0.enabled.lock() else {
            return;
        };
        let _ = self
            .0
            .wake
            .wait_timeout_while(enabled, CHECK_INTERVAL, |enabled| *enabled);
    }

    fn persist(&self, history: &NotificationHistory) -> Result<(), String> {
        let path = self
            .0
            .history_path
            .lock()
            .map_err(|_| "notification history path is unavailable".to_owned())?
            .clone()
            .ok_or_else(|| "notification history has not been initialized".to_owned())?;
        let json = serde_json::to_vec(history).map_err(|error| error.to_string())?;
        fs::write(path, json).map_err(|error| error.to_string())
    }
}

fn load_history(path: &Path) -> NotificationHistory {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn local_date(timestamp_millis: i64) -> Option<NaiveDate> {
    DateTime::<Utc>::from_timestamp_millis(timestamp_millis)
        .map(|timestamp| timestamp.with_timezone(&Local).date_naive())
}

fn is_overdue_with_dates(
    due_at: Option<i64>,
    due_has_time: bool,
    now: i64,
    due_date: Option<NaiveDate>,
    now_date: Option<NaiveDate>,
) -> bool {
    let Some(due_at) = due_at else {
        return false;
    };
    if due_at >= now {
        return false;
    }
    due_has_time
        || due_date
            .zip(now_date)
            .is_some_and(|(due, today)| due < today)
}

fn is_overdue(reminder: &Reminder, now: i64) -> bool {
    is_overdue_with_dates(
        reminder.due_at,
        reminder.due_has_time,
        now,
        reminder.due_at.and_then(local_date),
        local_date(now),
    )
}

fn pending_overdue<'a>(
    reminders: &'a [Reminder],
    history: &NotificationHistory,
    now: i64,
) -> Vec<&'a Reminder> {
    reminders
        .iter()
        .filter(|reminder| {
            let Some(due_at) = reminder.due_at else {
                return false;
            };
            is_overdue(reminder, now)
                && history.notified_due_at.get(&reminder.id).copied() != Some(due_at)
        })
        .collect()
}

fn prune_inactive(history: &mut NotificationHistory, reminders: &[Reminder]) -> bool {
    let active_ids = reminders
        .iter()
        .map(|reminder| reminder.id.as_str())
        .collect::<HashSet<_>>();
    let previous_len = history.notified_due_at.len();
    history
        .notified_due_at
        .retain(|reminder_id, _| active_ids.contains(reminder_id.as_str()));
    history.notified_due_at.len() != previous_len
}

fn notification_copy(reminders: &[&Reminder]) -> (String, String) {
    if let [reminder] = reminders {
        return ("Reminder overdue".to_owned(), reminder.title.clone());
    }

    let shown = reminders
        .iter()
        .take(3)
        .map(|reminder| reminder.title.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let body = if reminders.len() > 3 {
        format!("{shown}, and {} more", reminders.len() - 3)
    } else {
        shown
    };
    (format!("{} overdue reminders", reminders.len()), body)
}

async fn check_once(
    app: &AppHandle,
    client: &DataClient,
    state: &OverdueNotificationState,
) -> Result<(), String> {
    let reminders = client
        .list_reminders(ReminderQuery {
            view: ReminderView::All,
            list_id: None,
            project_id: None,
            day_start: None,
            day_end: None,
        })
        .await
        .map_err(|error| error.to_string())?;
    let now = chrono::Utc::now().timestamp_millis();

    let (pending_ids, history_after_cleanup) = {
        let mut history = state
            .0
            .history
            .lock()
            .map_err(|_| "notification history is unavailable".to_owned())?;
        let history_changed = prune_inactive(&mut history, &reminders);
        let pending = pending_overdue(&reminders, &history, now)
            .into_iter()
            .map(|reminder| reminder.id.clone())
            .collect::<Vec<_>>();
        let cleaned = history_changed.then(|| history.clone());
        (pending, cleaned)
    };

    if pending_ids.is_empty() {
        if let Some(history) = history_after_cleanup {
            state.persist(&history)?;
        }
        return Ok(());
    }
    if !state.is_enabled() {
        return Ok(());
    }

    let pending = pending_ids
        .iter()
        .filter_map(|id| reminders.iter().find(|reminder| reminder.id == *id))
        .collect::<Vec<_>>();
    let (title, body) = notification_copy(&pending);
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())?;

    let snapshot = {
        let mut history = state
            .0
            .history
            .lock()
            .map_err(|_| "notification history is unavailable".to_owned())?;
        for reminder in pending {
            if let Some(due_at) = reminder.due_at {
                history.notified_due_at.insert(reminder.id.clone(), due_at);
            }
        }
        history.clone()
    };
    state.persist(&snapshot)
}

pub fn start_monitor(app: AppHandle, client: Option<DataClient>, state: OverdueNotificationState) {
    let Some(client) = client else {
        return;
    };
    let _ = thread::Builder::new()
        .name("reminders-overdue-monitor".to_owned())
        .spawn(move || loop {
            state.wait_until_enabled();
            if state.is_enabled() {
                if let Err(error) =
                    tauri::async_runtime::block_on(check_once(&app, &client, &state))
                {
                    eprintln!("could not check overdue reminders: {error}");
                }
            }
            state.wait_for_next_check();
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_core::ReminderPriority;

    fn reminder(id: &str, title: &str, due_at: i64, due_has_time: bool) -> Reminder {
        Reminder {
            id: id.to_owned(),
            list_id: "reminders-inbox".to_owned(),
            title: title.to_owned(),
            notes: String::new(),
            due_at: Some(due_at),
            due_has_time,
            priority: ReminderPriority::None,
            project_id: None,
            subtasks: Vec::new(),
            completed_at: None,
            deleted_at: None,
            sort_index: 0,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn timed_reminders_become_overdue_after_their_exact_time() {
        let day = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        assert!(!is_overdue_with_dates(
            Some(1_000),
            true,
            1_000,
            Some(day),
            Some(day)
        ));
        assert!(is_overdue_with_dates(
            Some(1_000),
            true,
            1_001,
            Some(day),
            Some(day)
        ));
    }

    #[test]
    fn date_only_reminders_wait_until_the_due_day_has_ended() {
        let due_day = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        let next_day = NaiveDate::from_ymd_opt(2026, 10, 2).unwrap();
        assert!(!is_overdue_with_dates(
            Some(1_000),
            false,
            2_000,
            Some(due_day),
            Some(due_day),
        ));
        assert!(is_overdue_with_dates(
            Some(1_000),
            false,
            2_000,
            Some(due_day),
            Some(next_day),
        ));
    }

    #[test]
    fn a_due_timestamp_is_only_pending_once() {
        let now = chrono::Utc::now().timestamp_millis();
        let first = reminder("one", "First", now - 1_000, true);
        let reminders = vec![first.clone()];
        let mut history = NotificationHistory::default();
        assert_eq!(pending_overdue(&reminders, &history, now).len(), 1);
        history
            .notified_due_at
            .insert(first.id.clone(), first.due_at.unwrap());
        assert!(pending_overdue(&reminders, &history, now).is_empty());

        let moved = reminder("one", "First", now - 500, true);
        assert_eq!(pending_overdue(&[moved], &history, now).len(), 1);
    }

    #[test]
    fn several_due_reminders_are_grouped() {
        let now = chrono::Utc::now().timestamp_millis();
        let reminders = [
            reminder("one", "First", now - 3_000, true),
            reminder("two", "Second", now - 2_000, true),
            reminder("three", "Third", now - 1_000, true),
            reminder("four", "Fourth", now - 500, true),
        ];
        let references = reminders.iter().collect::<Vec<_>>();
        let (title, body) = notification_copy(&references);
        assert_eq!(title, "4 overdue reminders");
        assert_eq!(body, "First, Second, Third, and 1 more");
    }

    #[test]
    fn permission_state_starts_disabled() {
        let state = OverdueNotificationState::default();
        assert!(!state.is_enabled());
        state.set_enabled(true);
        assert!(state.is_enabled());
        state.set_enabled(false);
        assert!(!state.is_enabled());
    }

    #[test]
    fn inactive_reminders_are_removed_from_notification_history() {
        let now = chrono::Utc::now().timestamp_millis();
        let active = reminder("active", "Active", now - 1_000, true);
        let mut history = NotificationHistory {
            notified_due_at: HashMap::from([
                (active.id.clone(), active.due_at.unwrap()),
                ("completed-or-deleted".to_owned(), now - 2_000),
            ]),
        };
        assert!(prune_inactive(&mut history, &[active]));
        assert_eq!(history.notified_due_at.len(), 1);
        assert!(history.notified_due_at.contains_key("active"));
    }

    #[test]
    fn notification_history_survives_a_reload() {
        let path = std::env::temp_dir().join(format!(
            "reminders-notification-history-{}-{}.json",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let expected = NotificationHistory {
            notified_due_at: HashMap::from([("reminder".to_owned(), 42)]),
        };
        fs::write(&path, serde_json::to_vec(&expected).unwrap()).unwrap();
        assert_eq!(load_history(&path), expected);
        fs::remove_file(path).unwrap();
    }
}
