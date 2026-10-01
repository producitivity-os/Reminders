use app_core::{
    CreateReminderInput, DailyRoutineNodeRun, DailyRoutineNodeStatus, DailyRoutineRun,
    DailyRoutineRunStatus, QuranRecordingQuery, ReminderPriority, ReminderSubtask,
    SaveDailyRoutineRunInput,
};
use chrono::{Datelike, Local, NaiveDate, TimeZone, Timelike};
use data_client::DataClient;
use serde_json::{json, Value};
use std::{collections::HashMap, thread, time::Duration};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

use crate::{overdue_notifications::OverdueNotificationState, seeded_day_plan, DAY_PLAN_ID};

const CHECK_INTERVAL: Duration = Duration::from_secs(15);
const DEFAULT_LIST_ID: &str = "reminders-inbox";

fn priority(value: Option<&str>) -> ReminderPriority {
    match value {
        Some("low") => ReminderPriority::Low,
        Some("medium") => ReminderPriority::Medium,
        Some("high") => ReminderPriority::High,
        _ => ReminderPriority::None,
    }
}

fn due_at_for(date: NaiveDate) -> Option<i64> {
    Local
        .with_ymd_and_hms(date.year(), date.month(), date.day(), 0, 0, 0)
        .earliest()
        .map(|value| value.timestamp_millis())
}

fn subtask_values(payload: &Value) -> Vec<ReminderSubtask> {
    payload
        .get("subtasks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            Some(ReminderSubtask {
                id: item.get("id")?.as_str()?.to_owned(),
                title: item
                    .get("name")
                    .or_else(|| item.get("title"))?
                    .as_str()?
                    .to_owned(),
                completed: false,
            })
        })
        .collect()
}

fn fresh_plugin_state(payload: &Value) -> Value {
    let mut data = payload
        .get("pluginData")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let Some(values) = data.as_object_mut() else {
        return data;
    };
    match payload.get("pluginId").and_then(Value::as_str) {
        Some("workflows.revise-nodes") => {
            values.insert("sessionId".into(), Value::Null);
            values.insert("status".into(), json!("idle"));
            for key in [
                "elapsedMs",
                "totalCards",
                "remainingCards",
                "reviewedCount",
                "rightCount",
                "wrongCount",
                "sessionUpdatedAt",
            ] {
                values.insert(key.into(), json!(0));
            }
            values.insert("results".into(), json!([]));
        }
        Some("workflows.quran-nodes") => {
            for key in ["recordingId", "pendingRecordingId", "captureSessionId"] {
                values.insert(key.into(), Value::Null);
            }
            for key in [
                "recordingUpdatedAt",
                "pendingAfterUpdatedAt",
                "latestDurationMs",
                "attemptCount",
            ] {
                values.insert(key.into(), json!(0));
            }
        }
        _ => {}
    }
    data
}

async fn ensure_document(client: &DataClient) -> Result<app_core::CanvasDocument, String> {
    if let Some(document) = client
        .get_canvas(DAY_PLAN_ID.into())
        .await
        .map_err(|error| error.to_string())?
    {
        return Ok(document);
    }
    client
        .save_canvas(seeded_day_plan())
        .await
        .map_err(|error| error.to_string())?;
    client
        .get_canvas(DAY_PLAN_ID.into())
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "the Day Plan could not be initialized".to_owned())
}

async fn fresh_run(
    client: &DataClient,
    document: &app_core::CanvasDocument,
    date: NaiveDate,
    now: i64,
) -> Result<DailyRoutineRun, String> {
    let local_date = date.format("%Y-%m-%d").to_string();
    let mut nodes = Vec::new();
    for object in &document.canvas.objects {
        if object.object_type != "workflow-node" {
            continue;
        }
        let payload = &object.payload;
        let mut reminder_id = None;
        if payload.get("nodeKind").and_then(Value::as_str) == Some("task") {
            let id = format!("day-plan:{local_date}:{}", object.id);
            client
                .create_reminder(CreateReminderInput {
                    id: Some(id.clone()),
                    list_id: DEFAULT_LIST_ID.into(),
                    title: payload
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("Day Plan task")
                        .to_owned(),
                    notes: payload
                        .get("notes")
                        .or_else(|| payload.get("description"))
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                    due_at: due_at_for(date),
                    due_has_time: false,
                    priority: priority(payload.get("priority").and_then(Value::as_str)),
                    project_id: payload
                        .get("projectId")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    subtasks: subtask_values(payload),
                    after_id: None,
                })
                .await
                .map_err(|error| error.to_string())?;
            reminder_id = Some(id);
        }
        nodes.push(DailyRoutineNodeRun {
            node_id: object.id.clone(),
            status: DailyRoutineNodeStatus::Idle,
            elapsed_ms: 0,
            started_at: None,
            completed_at: None,
            reminder_id,
            state: if payload.get("nodeKind").and_then(Value::as_str) == Some("plugin") {
                fresh_plugin_state(payload)
            } else {
                json!({})
            },
            updated_at: now,
        });
    }
    client
        .save_daily_routine_run(SaveDailyRoutineRunInput {
            workflow_id: DAY_PLAN_ID.into(),
            local_date,
            status: DailyRoutineRunStatus::Active,
            started_at: now,
            completed_at: None,
            nodes,
        })
        .await
        .map_err(|error| error.to_string())
}

fn timed_trigger_due(payload: &Value, date: NaiveDate, hour: u32, minute: u32) -> bool {
    if payload.get("triggerType").and_then(Value::as_str) != Some("time") {
        return false;
    }
    let weekday = date.weekday().num_days_from_sunday() as u64;
    let matches_weekday = payload
        .get("weekdays")
        .and_then(Value::as_array)
        .is_none_or(|days| days.iter().any(|day| day.as_u64() == Some(weekday)));
    let Some(time) = payload.get("time").and_then(Value::as_str) else {
        return false;
    };
    let mut parts = time.split(':').filter_map(|part| part.parse::<u32>().ok());
    let Some(trigger_hour) = parts.next() else {
        return false;
    };
    let Some(trigger_minute) = parts.next() else {
        return false;
    };
    matches_weekday && (hour, minute) >= (trigger_hour, trigger_minute)
}

async fn process_once(
    app: &AppHandle,
    client: &DataClient,
    notification_state: &OverdueNotificationState,
) -> Result<(), String> {
    let document = ensure_document(client).await?;
    let now_local = Local::now();
    let now = now_local.timestamp_millis();
    let date = now_local.date_naive();
    let local_date = date.format("%Y-%m-%d").to_string();
    if let Some(yesterday) = date.pred_opt() {
        let yesterday_key = yesterday.format("%Y-%m-%d").to_string();
        if let Some(previous) = client
            .get_daily_routine_run(DAY_PLAN_ID.into(), yesterday_key.clone())
            .await
            .map_err(|error| error.to_string())?
        {
            if previous.status == DailyRoutineRunStatus::Active {
                let _ = client
                    .save_daily_routine_run(SaveDailyRoutineRunInput {
                        workflow_id: DAY_PLAN_ID.into(),
                        local_date: yesterday_key,
                        status: DailyRoutineRunStatus::Archived,
                        started_at: previous.started_at,
                        completed_at: previous.completed_at,
                        nodes: previous.nodes,
                    })
                    .await;
            }
        }
    }
    let mut run = match client
        .get_daily_routine_run(DAY_PLAN_ID.into(), local_date.clone())
        .await
        .map_err(|error| error.to_string())?
    {
        Some(run) => run,
        None => fresh_run(client, &document, date, now).await?,
    };

    let payloads = document
        .canvas
        .objects
        .iter()
        .filter(|object| object.object_type == "workflow-node")
        .map(|object| (object.id.as_str(), &object.payload))
        .collect::<HashMap<_, _>>();
    let recordings = client
        .list_quran_recordings(QuranRecordingQuery {
            workflow_id: Some(DAY_PLAN_ID.into()),
            node_id: None,
        })
        .await
        .unwrap_or_default();
    let mut changed = false;
    let mut fired_names = Vec::new();
    let has_completed_quran = recordings.iter().any(|recording| {
        recording.updated_at >= run.started_at
            && recording.status == app_core::QuranRecordingStatus::Completed
    });
    let mut has_completed_revise = false;
    for candidate in &run.nodes {
        let Some(session_id) = candidate.state.get("sessionId").and_then(Value::as_str) else {
            continue;
        };
        if client
            .revision_session(session_id.to_owned())
            .await
            .ok()
            .flatten()
            .is_some_and(|session| session.status == app_core::RevisionSessionStatus::Completed)
        {
            has_completed_revise = true;
            break;
        }
    }

    for node_run in &mut run.nodes {
        let Some(payload) = payloads.get(node_run.node_id.as_str()) else {
            continue;
        };
        if node_run.status == DailyRoutineNodeStatus::Running {
            let duration = payload
                .get("durationMs")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let elapsed = node_run.elapsed_ms
                + node_run
                    .started_at
                    .map(|started| (now - started).max(0))
                    .unwrap_or(0);
            if duration > 0 && elapsed >= duration {
                node_run.status = DailyRoutineNodeStatus::Completed;
                node_run.elapsed_ms = duration;
                node_run.started_at = None;
                node_run.completed_at = Some(now);
                node_run.updated_at = now;
                changed = true;
                fired_names.push(
                    payload
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("Timer")
                        .to_owned(),
                );
            }
        }
        if node_run.status != DailyRoutineNodeStatus::Completed
            && timed_trigger_due(payload, date, now_local.hour(), now_local.minute())
        {
            node_run.status = DailyRoutineNodeStatus::Completed;
            node_run.completed_at = Some(now);
            node_run.updated_at = now;
            changed = true;
            fired_names.push(
                payload
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("Trigger")
                    .to_owned(),
            );
        }
        if node_run.status != DailyRoutineNodeStatus::Completed
            && payload.get("triggerType").and_then(Value::as_str) == Some("quran-completed")
            && has_completed_quran
        {
            node_run.status = DailyRoutineNodeStatus::Completed;
            node_run.completed_at = Some(now);
            node_run.updated_at = now;
            changed = true;
            fired_names.push(
                payload
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("Quran recording")
                    .to_owned(),
            );
        }
        if node_run.status != DailyRoutineNodeStatus::Completed
            && payload.get("triggerType").and_then(Value::as_str) == Some("revise-completed")
            && has_completed_revise
        {
            node_run.status = DailyRoutineNodeStatus::Completed;
            node_run.completed_at = Some(now);
            node_run.updated_at = now;
            changed = true;
            fired_names.push(
                payload
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("Review")
                    .to_owned(),
            );
        }
        if node_run.status != DailyRoutineNodeStatus::Completed
            && payload.get("pluginId").and_then(Value::as_str) == Some("workflows.revise-nodes")
            && node_run
                .state
                .get("sessionId")
                .and_then(Value::as_str)
                .is_some()
            && has_completed_revise
        {
            node_run.status = DailyRoutineNodeStatus::Completed;
            node_run.completed_at = Some(now);
            node_run.updated_at = now;
            changed = true;
        }
        if node_run.status != DailyRoutineNodeStatus::Completed
            && payload.get("pluginId").and_then(Value::as_str) == Some("workflows.quran-nodes")
            && recordings.iter().any(|recording| {
                recording.node_id.as_deref() == Some(node_run.node_id.as_str())
                    && recording.status == app_core::QuranRecordingStatus::Completed
            })
        {
            node_run.status = DailyRoutineNodeStatus::Completed;
            node_run.completed_at = Some(now);
            node_run.updated_at = now;
            changed = true;
        }
    }

    if changed {
        let completed = run
            .nodes
            .iter()
            .all(|node| node.status == DailyRoutineNodeStatus::Completed);
        let saved = client
            .save_daily_routine_run(SaveDailyRoutineRunInput {
                workflow_id: DAY_PLAN_ID.into(),
                local_date,
                status: if completed {
                    DailyRoutineRunStatus::Completed
                } else {
                    DailyRoutineRunStatus::Active
                },
                started_at: run.started_at,
                completed_at: completed.then_some(now),
                nodes: run.nodes,
            })
            .await
            .map_err(|error| error.to_string())?;
        let _ = app.emit("reminders:day-plan-updated", &saved);
        if notification_state.is_enabled() && !fired_names.is_empty() {
            let body = fired_names.join(", ");
            let _ = app
                .notification()
                .builder()
                .title("Day Plan ready")
                .body(body)
                .show();
        }
    }
    Ok(())
}

pub fn start_day_plan_monitor(
    app: AppHandle,
    client: Option<DataClient>,
    notification_state: OverdueNotificationState,
) {
    let Some(client) = client else { return };
    let _ = thread::Builder::new()
        .name("reminders-day-plan-monitor".into())
        .spawn(move || loop {
            if let Err(error) =
                tauri::async_runtime::block_on(process_once(&app, &client, &notification_state))
            {
                eprintln!("could not process the Day Plan: {error}");
            }
            thread::sleep(CHECK_INTERVAL);
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_trigger_catches_up_after_its_local_deadline() {
        let payload = json!({ "triggerType": "time", "time": "09:30", "weekdays": [4] });
        let date = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        assert!(!timed_trigger_due(&payload, date, 9, 29));
        assert!(timed_trigger_due(&payload, date, 9, 30));
        assert!(timed_trigger_due(&payload, date, 11, 0));
    }

    #[test]
    fn task_priority_defaults_safely() {
        assert_eq!(priority(Some("high")), ReminderPriority::High);
        assert_eq!(priority(Some("unexpected")), ReminderPriority::None);
    }
}
