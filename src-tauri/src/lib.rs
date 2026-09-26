use app_core::{
    CanvasDocumentSummary, CanvasLayer, CanvasSnapshot, CanvasType, CanvasViewport,
    CreateReminderInput, Reminder, ReminderImageAttachment, ReminderImageDataInput, ReminderQuery,
    SaveCanvasInput, UpdateReminderInput, WorkflowDocumentKind,
};
use data_client::DataClient;
use serde::Deserialize;
use std::path::{Component, Path, PathBuf};
use tauri::{
    http::{header, Method, Request as HttpRequest, Response as HttpResponse, StatusCode},
    State,
};

struct AppState {
    client: Option<DataClient>,
    config_error: Option<String>,
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
    let mut projects = state
        .client()?
        .list_canvases()
        .await
        .map_err(|error| error.to_string())?;
    projects.retain(|document| {
        document.canvas_type == CanvasType::Workflow
            && document.workflow_kind == WorkflowDocumentKind::Project
    });
    projects.sort_by(|left, right| left.title.to_lowercase().cmp(&right.title.to_lowercase()));
    Ok(projects)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateReminderProjectInput {
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
    state
        .client()?
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
    let protocol_media_root = configured_settings
        .as_ref()
        .map(|settings| PathBuf::from(&settings.media_path));
    tauri::Builder::default()
        .manage(AppState {
            client,
            config_error,
        })
        .plugin(tauri_plugin_clipboard_manager::init())
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
            list_reminders,
            list_reminder_projects,
            create_reminder_project,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Reminders");
}
