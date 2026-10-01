use std::sync::Mutex;

use tauri::{
    menu::{IconMenuItem, Menu, MenuItem, NativeIcon, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, State, Wry,
};

use crate::show_main_window;

#[derive(Default)]
pub struct TrayState(pub Mutex<Option<TrayIcon<Wry>>>);

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "tray:open", "Open Reminders", true, None::<&str>)?;

    let new_reminder =
        MenuItem::with_id(app, "app:new", "New Reminder", true, Some("CmdOrCtrl+N"))?;

    let settings = IconMenuItem::with_id_and_native_icon(
        app,
        "app:settings",
        "Settings…",
        true,
        Some(NativeIcon::PreferencesGeneral),
        Some("CmdOrCtrl+,"),
    )?;

    let separator = PredefinedMenuItem::separator(app)?;
    let separator_two = PredefinedMenuItem::separator(app)?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit Reminders"))?;

    let tray_menu = Menu::with_items(
        app,
        &[
            &open,
            &new_reminder,
            &separator,
            &settings,
            &separator_two,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("reminders-tray")
        .tooltip("Reminders — nothing due today")
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                let _ = show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    let tray = builder.build(app)?;

    if let Ok(mut state) = app.state::<TrayState>().0.lock() {
        *state = Some(tray);
    }

    Ok(())
}

#[tauri::command]
pub fn update_today_badge(
    count: u32,
    app: AppHandle,
    tray_state: State<'_, TrayState>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_badge_count((count > 0).then_some(count as i64))
            .map_err(|error| error.to_string())?;
    }

    let state = tray_state
        .0
        .lock()
        .map_err(|_| "tray state is unavailable".to_owned())?;

    if let Some(tray) = state.as_ref() {
        tray.set_title((count > 0).then(|| count.to_string()))
            .map_err(|error| error.to_string())?;

        tray.set_tooltip(Some(if count > 0 {
            format!("Reminders — {count} due today")
        } else {
            "Reminders — nothing due today".to_owned()
        }))
        .map_err(|error| error.to_string())?;
    }

    Ok(())
}
