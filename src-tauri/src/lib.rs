mod day_plan_runtime;
mod overdue_notifications;

mod tray;

use tray::TrayState;

use app_core::{
    CanvasDocument, CanvasDocumentSummary, CanvasLayer, CanvasObject, CanvasSnapshot, CanvasType,
    CanvasViewport, CreateQuranCaptureRequestInput, CreateReminderInput, DailyRoutineRun,
    QuranRecording, QuranRecordingQuery, Reminder, ReminderImageAttachment, ReminderImageDataInput,
    ReminderQuery, RevisionSession, RevisionSessionGoal, RevisionSessionOrigin,
    RevisionSessionStatus, SaveCanvasInput, SaveDailyRoutineRunInput,
    SetRevisionSessionStatusInput, StartRevisionSessionInput, UpdateReminderInput,
    WorkflowDocumentKind,
};
use data_client::DataClient;
use day_plan_runtime::start_day_plan_monitor;
use overdue_notifications::{start_monitor, OverdueNotificationState};
use serde::Deserialize;
use std::path::{Component, Path, PathBuf};
use tauri::{
    http::{header, Method, Request as HttpRequest, Response as HttpResponse, StatusCode},
    AppHandle, Emitter, Manager, State,
};
#[cfg(not(target_os = "macos"))]
use tauri::{WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;

struct AppState {
    client: Option<DataClient>,
    config_error: Option<String>,
}

fn show_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "The Reminders window is unavailable.".to_owned())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
fn show_preferences_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("preferences") {
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    WebviewWindowBuilder::new(
        app,
        "preferences",
        WebviewUrl::App("index.html?window=preferences".into()),
    )
    .title("Reminders Settings")
    .inner_size(560.0, 360.0)
    .min_inner_size(520.0, 320.0)
    .resizable(false)
    .decorations(true)
    .build()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_overdue_notification_permission(granted: bool, state: State<'_, OverdueNotificationState>) {
    state.set_enabled(granted);
}

impl AppState {
    fn client(&self) -> Result<DataClient, String> {
        self.client.clone().ok_or_else(|| {
            self.config_error
                .clone()
                .unwrap_or_else(|| "data service is unavailable".into())
        })
    }
}

pub(crate) const DAY_PLAN_ID: &str = "reminders-today-routine";

pub(crate) fn seeded_day_plan() -> SaveCanvasInput {
    SaveCanvasInput {
        id: DAY_PLAN_ID.into(),
        title: "Day Plan".into(),
        project: "Reminders".into(),
        canvas_type: CanvasType::Workflow,
        workflow_kind: WorkflowDocumentKind::Workflow,
        icon: "network".into(),
        starred: false,
        cover_media_id: None,
        expected_revision: None,
        canvas: CanvasSnapshot {
            schema_version: 3,
            active_layer_id: "main".into(),
            focused_layer_id: None,
            unfocused_layer_opacity: 0.35,
            viewport: CanvasViewport::default(),
            layers: vec![CanvasLayer {
                id: "main".into(),
                name: "Day Plan".into(),
                z_index: 0,
                visible: true,
                opacity: 1.0,
                interaction_color: 0x3b82f6,
            }],
            objects: vec![CanvasObject {
                id: "day-plan-start".into(),
                layer_id: "main".into(),
                object_type: "workflow-node".into(),
                sort_index: 0,
                payload: serde_json::json!({
                    "id": "day-plan-start",
                    "type": "workflow-node",
                    "layerId": "main",
                    "x": 120,
                    "y": 220,
                    "width": 72,
                    "height": 72,
                    "rotation": 0,
                    "opacity": 1,
                    "nodeKind": "trigger",
                    "name": "Start",
                    "description": "Start today's routine",
                    "triggerType": "manual",
                    "time": null,
                    "weekdays": [0, 1, 2, 3, 4, 5, 6],
                    "firedAt": null,
                    "lastFiredDate": null
                }),
            }],
        },
    }
}

#[tauri::command]
async fn get_day_plan(state: State<'_, AppState>) -> Result<CanvasDocument, String> {
    let client = state.client()?;
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
        .ok_or_else(|| "The Day Plan could not be created.".into())
}

#[tauri::command]
async fn save_day_plan(
    mut input: SaveCanvasInput,
    state: State<'_, AppState>,
) -> Result<CanvasDocumentSummary, String> {
    input.id = DAY_PLAN_ID.into();
    input.canvas_type = CanvasType::Workflow;
    input.workflow_kind = WorkflowDocumentKind::Workflow;
    state
        .client()?
        .save_canvas(input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_day_plan_run(
    local_date: String,
    state: State<'_, AppState>,
) -> Result<Option<DailyRoutineRun>, String> {
    state
        .client()?
        .get_daily_routine_run(DAY_PLAN_ID.into(), local_date)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn save_day_plan_run(
    mut input: SaveDailyRoutineRunInput,
    app: AppHandle,
    state: State<'_, AppState>,
    notifications: State<'_, OverdueNotificationState>,
) -> Result<DailyRoutineRun, String> {
    input.workflow_id = DAY_PLAN_ID.into();
    let client = state.client()?;
    let previous = client
        .get_daily_routine_run(DAY_PLAN_ID.into(), input.local_date.clone())
        .await
        .map_err(|error| error.to_string())?;
    let previously_completed = previous
        .map(|run| {
            run.nodes
                .into_iter()
                .filter(|node| node.status == app_core::DailyRoutineNodeStatus::Completed)
                .map(|node| node.node_id)
                .collect::<std::collections::HashSet<_>>()
        })
        .unwrap_or_default();
    let newly_completed = input
        .nodes
        .iter()
        .filter(|node| {
            node.status == app_core::DailyRoutineNodeStatus::Completed
                && !previously_completed.contains(&node.node_id)
        })
        .map(|node| node.node_id.clone())
        .collect::<std::collections::HashSet<_>>();
    let saved = client
        .save_daily_routine_run(input)
        .await
        .map_err(|error| error.to_string())?;
    if notifications.is_enabled() && !newly_completed.is_empty() {
        let trigger_names = client
            .get_canvas(DAY_PLAN_ID.into())
            .await
            .ok()
            .flatten()
            .map(|document| {
                document
                    .canvas
                    .objects
                    .into_iter()
                    .filter(|object| {
                        newly_completed.contains(&object.id)
                            && object
                                .payload
                                .get("nodeKind")
                                .and_then(serde_json::Value::as_str)
                                == Some("trigger")
                    })
                    .map(|object| {
                        object
                            .payload
                            .get("name")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or("Trigger")
                            .to_owned()
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if !trigger_names.is_empty() {
            let _ = app
                .notification()
                .builder()
                .title("Day Plan ready")
                .body(trigger_names.join(", "))
                .show();
        }
    }
    Ok(saved)
}

#[tauri::command]
async fn day_plan_revision_notebooks(
    state: State<'_, AppState>,
) -> Result<Vec<CanvasDocumentSummary>, String> {
    state
        .client()?
        .list_notebooks()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn day_plan_revision_session(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<RevisionSession>, String> {
    state
        .client()?
        .revision_session(id)
        .await
        .map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchDayPlanRevisionInput {
    workflow_id: String,
    node_id: String,
    session_id: String,
    notebook_id: Option<String>,
    goal: RevisionSessionGoal,
}

#[tauri::command]
async fn day_plan_launch_revision(
    input: LaunchDayPlanRevisionInput,
    state: State<'_, AppState>,
) -> Result<RevisionSession, String> {
    let run = state
        .client()?
        .start_revision_session(StartRevisionSessionInput {
            id: input.session_id,
            origin: RevisionSessionOrigin::Workflow,
            workflow_id: Some(input.workflow_id),
            node_id: Some(input.node_id),
            notebook_id: input.notebook_id,
        })
        .await
        .map_err(|error| error.to_string())?;
    let _ = input.goal;
    Ok(run.session)
}

#[tauri::command]
async fn day_plan_set_revision_status(
    id: String,
    status: RevisionSessionStatus,
    state: State<'_, AppState>,
) -> Result<RevisionSession, String> {
    state
        .client()?
        .set_revision_session_status(SetRevisionSessionStatusInput { id, status })
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn day_plan_quran_recordings(
    node_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<QuranRecording>, String> {
    state
        .client()?
        .list_quran_recordings(QuranRecordingQuery {
            workflow_id: Some(DAY_PLAN_ID.into()),
            node_id,
        })
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn day_plan_create_quran_capture(
    input: CreateQuranCaptureRequestInput,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .client()?
        .create_quran_capture_request(input)
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn list_reminders(
    query: ReminderQuery,
    state: State<'_, AppState>,
) -> Result<Vec<Reminder>, String> {
    state
        .client()?
        .list_reminders(query)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn list_reminder_projects(
    state: State<'_, AppState>,
) -> Result<Vec<CanvasDocumentSummary>, String> {
    state
        .client()?
        .list_reminder_projects()
        .await
        .map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateReminderProjectInput {
    id: String,
    title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateReminderProjectInput {
    id: String,
    title: String,
}

#[tauri::command]
async fn create_reminder_project(
    input: CreateReminderProjectInput,
    state: State<'_, AppState>,
) -> Result<CanvasDocumentSummary, String> {
    let title = input.title.trim();
    if input.id.trim().is_empty() || title.is_empty() {
        return Err("project id and title are required".into());
    }
    let client = state.client()?;
    let saved = client
        .save_canvas(SaveCanvasInput {
            id: input.id,
            title: title.to_owned(),
            project: "Drafts".into(),
            canvas_type: CanvasType::Workflow,
            workflow_kind: WorkflowDocumentKind::Project,
            icon: "file-text".into(),
            starred: false,
            cover_media_id: None,
            expected_revision: None,
            canvas: CanvasSnapshot {
                schema_version: 2,
                active_layer_id: "main".into(),
                focused_layer_id: None,
                unfocused_layer_opacity: 0.35,
                viewport: CanvasViewport::default(),
                layers: vec![CanvasLayer {
                    id: "main".into(),
                    name: "Main layer".into(),
                    z_index: 0,
                    visible: true,
                    opacity: 1.0,
                    interaction_color: 0x3b82f6,
                }],
                objects: vec![],
            },
        })
        .await
        .map_err(|error| error.to_string())?;
    let ordered_ids = client
        .list_reminder_projects()
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|project| project.id)
        .collect();
    client
        .reorder_reminder_projects(ordered_ids)
        .await
        .map_err(|error| error.to_string())?;
    Ok(saved)
}

async fn require_reminder_project(client: &DataClient, id: String) -> Result<(), String> {
    let document = client
        .get_canvas(id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "The project no longer exists.".to_owned())?;
    if document.summary.canvas_type != CanvasType::Workflow
        || document.summary.workflow_kind != WorkflowDocumentKind::Project
    {
        return Err("The selected document is not a reminder project.".into());
    }
    Ok(())
}

#[tauri::command]
async fn update_reminder_project(
    input: UpdateReminderProjectInput,
    state: State<'_, AppState>,
) -> Result<CanvasDocumentSummary, String> {
    let title = input.title.trim();
    if input.id.trim().is_empty() || title.is_empty() {
        return Err("project id and title are required".into());
    }
    let client = state.client()?;
    require_reminder_project(&client, input.id.clone()).await?;
    client
        .set_canvas_title(input.id, title.to_owned())
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "The project no longer exists.".to_owned())
}

#[tauri::command]
async fn delete_reminder_project(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let client = state.client()?;
    require_reminder_project(&client, id.clone()).await?;
    client
        .delete_canvas(id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn reorder_reminder_projects(
    ordered_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<CanvasDocumentSummary>, String> {
    state
        .client()?
        .reorder_reminder_projects(ordered_ids)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn create_reminder(
    input: CreateReminderInput,
    state: State<'_, AppState>,
) -> Result<Reminder, String> {
    state
        .client()?
        .create_reminder(input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn update_reminder(
    input: UpdateReminderInput,
    state: State<'_, AppState>,
) -> Result<Reminder, String> {
    state
        .client()?
        .update_reminder(input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn reorder_reminders(
    list_id: String,
    ordered_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Reminder>, String> {
    state
        .client()?
        .reorder_reminders(list_id, ordered_ids)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn set_reminder_completed(
    id: String,
    completed: bool,
    state: State<'_, AppState>,
) -> Result<Option<Reminder>, String> {
    state
        .client()?
        .set_reminder_completed(id, completed)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn delete_reminder(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<Reminder>, String> {
    state
        .client()?
        .delete_reminder(id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn restore_reminder(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<Reminder>, String> {
    state
        .client()?
        .restore_reminder(id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn permanently_delete_reminder(
    id: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    state
        .client()?
        .permanently_delete_reminder(id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn list_reminder_images(
    reminder_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<ReminderImageAttachment>, String> {
    state
        .client()?
        .list_reminder_images(reminder_ids)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn import_reminder_image(
    input: ReminderImageDataInput,
    state: State<'_, AppState>,
) -> Result<ReminderImageAttachment, String> {
    state
        .client()?
        .import_reminder_image(input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn delete_reminder_image(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    state
        .client()?
        .delete_reminder_image(id)
        .await
        .map_err(|error| error.to_string())
}

fn safe_media_path(root: &Path, key: &str) -> Result<PathBuf, String> {
    let relative = Path::new(key);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("invalid media storage key".into());
    }
    let root = std::fs::canonicalize(root).map_err(|error| error.to_string())?;
    let path = std::fs::canonicalize(root.join(relative)).map_err(|error| error.to_string())?;
    if !path.starts_with(&root) {
        return Err("media path escapes storage root".into());
    }
    Ok(path)
}

fn media_response(
    client: DataClient,
    media_root: PathBuf,
    request: HttpRequest<Vec<u8>>,
) -> HttpResponse<Vec<u8>> {
    let segments: Vec<&str> = request
        .uri()
        .path()
        .trim_start_matches('/')
        .split('/')
        .collect();
    if segments.len() != 2 || !matches!(segments[1], "content" | "thumbnail") {
        return response(
            StatusCode::NOT_FOUND,
            "text/plain",
            b"media not found".to_vec(),
        );
    }
    if !matches!(*request.method(), Method::GET | Method::HEAD) {
        return response(StatusCode::METHOD_NOT_ALLOWED, "text/plain", Vec::new());
    }
    let storage =
        match tauri::async_runtime::block_on(client.get_media_storage(segments[0].to_owned())) {
            Ok(Some(storage)) => storage,
            _ => {
                return response(
                    StatusCode::NOT_FOUND,
                    "text/plain",
                    b"media not found".to_vec(),
                )
            }
        };
    let thumbnail = segments[1] == "thumbnail";
    let key = if thumbnail {
        storage
            .thumbnail_key
            .as_deref()
            .unwrap_or(&storage.storage_key)
    } else {
        &storage.storage_key
    };
    let body = if *request.method() == Method::HEAD {
        Vec::new()
    } else {
        match safe_media_path(&media_root, key)
            .and_then(|path| std::fs::read(path).map_err(|error| error.to_string()))
        {
            Ok(body) => body,
            Err(_) => {
                return response(
                    StatusCode::NOT_FOUND,
                    "text/plain",
                    b"media not found".to_vec(),
                )
            }
        }
    };
    response(
        StatusCode::OK,
        if thumbnail && storage.thumbnail_key.is_some() {
            "image/webp"
        } else {
            &storage.mime_type
        },
        body,
    )
}

fn response(status: StatusCode, content_type: &str, body: Vec<u8>) -> HttpResponse<Vec<u8>> {
    HttpResponse::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .body(body)
        .unwrap()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (client, configured_settings, config_error) = match app_config::ProductivityConfig::load() {
        Ok(config) => {
            let settings = config.service_settings();
            (
                Some(DataClient::new(
                    &settings.socket_path,
                    settings.max_request_bytes,
                )),
                Some(settings),
                None,
            )
        }
        Err(error) => (None, None, Some(error.to_string())),
    };
    let protocol_client = client.clone();
    let monitor_client = client.clone();
    let overdue_notification_state = OverdueNotificationState::default();
    let setup_notification_state = overdue_notification_state.clone();
    let protocol_media_root = configured_settings
        .as_ref()
        .map(|settings| PathBuf::from(&settings.media_path));
    tauri::Builder::default()
        .manage(AppState {
            client,
            config_error,
        })
        .manage(TrayState::default())
        .manage(overdue_notification_state)
        .manage(desktop_menu::NativeMenuState::default())
        .menu(|app| desktop_menu::standard_app_menu_with_settings(app, "Reminders", "New Reminder"))
        .setup(move |app| {
            if let Err(error) = desktop_menu::apply_settings_cog_symbol() {
                eprintln!("could not install the Reminders Settings menu icon: {error}");
            }
            setup_notification_state
                .initialize(
                    app.path()
                        .app_data_dir()
                        .map_err(|error| error.to_string())?,
                )
                .map_err(std::io::Error::other)?;
            start_monitor(
                app.handle().clone(),
                monitor_client.clone(),
                setup_notification_state.clone(),
            );
            start_day_plan_monitor(
                app.handle().clone(),
                monitor_client.clone(),
                setup_notification_state.clone(),
            );
            tray::setup(app)?;
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "app:settings" => {
                #[cfg(target_os = "macos")]
                if let Err(error) = desktop_menu::show_preferences(app, "Reminders") {
                    eprintln!("could not open Reminders Settings: {error}");
                }
                #[cfg(not(target_os = "macos"))]
                let _ = show_preferences_window(app);
            }
            "app:new" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("reminders:new-reminder", ());
                    let _ = show_main_window(app);
                }
            }
            "tray:open" => {
                let _ = show_main_window(app);
            }
            _ => {
                desktop_menu::handle_menu_event(app, &event);
            }
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    return;
                }
            }
            if matches!(event, tauri::WindowEvent::Destroyed) {
                desktop_menu::cleanup_window(window.app_handle(), window.label());
            }
        })
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .register_asynchronous_uri_scheme_protocol("media", move |_context, request, responder| {
            let client = protocol_client.clone();
            let media_root = protocol_media_root.clone();
            std::thread::spawn(move || {
                let response = match (client, media_root) {
                    (Some(client), Some(root)) => media_response(client, root, request),
                    _ => response(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "text/plain",
                        b"media service unavailable".to_vec(),
                    ),
                };
                responder.respond(response);
            });
        })
        .invoke_handler(tauri::generate_handler![
            get_day_plan,
            save_day_plan,
            get_day_plan_run,
            save_day_plan_run,
            day_plan_revision_notebooks,
            day_plan_revision_session,
            day_plan_launch_revision,
            day_plan_set_revision_status,
            day_plan_quran_recordings,
            day_plan_create_quran_capture,
            list_reminders,
            list_reminder_projects,
            create_reminder_project,
            update_reminder_project,
            delete_reminder_project,
            reorder_reminder_projects,
            create_reminder,
            update_reminder,
            reorder_reminders,
            set_reminder_completed,
            delete_reminder,
            restore_reminder,
            permanently_delete_reminder,
            list_reminder_images,
            import_reminder_image,
            delete_reminder_image,
            tray::update_today_badge,
            set_overdue_notification_permission,
            desktop_menu::commands::popup_native_context_menu,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Reminders");
}
