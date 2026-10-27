use crate::classifier::{
    AnalyticsResponse, AppSettings, BatchMediaResponse, BatchSummary, ClassificationItem,
    ClassifierService, ExportResult, DEV_MODE,
};
use crate::db::{Database, KeymapItem};
use std::sync::{Arc, Mutex};
use tauri::State;

pub struct AppState {
    pub db: Arc<Mutex<Database>>,
    pub classifier: Arc<ClassifierService>,
}

impl AppState {
    /// Locks the database and runs `f`, converting a lock or `f` error into a String for IPC.
    fn with_db<T, E: ToString>(
        &self,
        f: impl FnOnce(&mut Database) -> Result<T, E>,
    ) -> Result<T, String> {
        let mut db = self.db.lock().map_err(|e| e.to_string())?;
        f(&mut db).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> AppSettings {
    state.classifier.load_settings()
}

#[tauri::command]
pub fn save_settings(
    state: State<AppState>,
    settings: crate::classifier::UpdateSettings,
) -> Result<AppSettings, String> {
    state.classifier.update_settings(settings)
}

#[tauri::command]
pub fn get_batches(state: State<AppState>) -> Vec<BatchSummary> {
    let settings = state.classifier.load_settings();
    if let Ok(db) = state.db.lock() {
        state.classifier.get_batches(&db, &settings)
    } else {
        Vec::new()
    }
}

#[tauri::command]
pub fn preview_import(state: State<AppState>, source_path: String) -> Result<crate::classifier::ImportPreview, String> {
    state.classifier.preview_import(&source_path)
}

#[tauri::command]
pub fn execute_import(
    state: State<AppState>,
    source_path: String,
    site_name: String,
) -> Result<crate::classifier::ImportResult, String> {
    let settings = state.classifier.load_settings();
    state.with_db(|db| state.classifier.execute_import(db, &settings, &source_path, &site_name))
}

#[tauri::command]
pub async fn select_folder(
    app: tauri::AppHandle,
    title: Option<String>,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut builder = app.dialog().file();
    if let Some(t) = title {
        builder = builder.set_title(t);
    }
    if let Some(p) = default_path {
        builder = builder.set_directory(p);
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    builder.pick_folder(move |folder| {
        let path = folder.map(|f| f.to_string());
        let _ = tx.send(path);
    });
    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_batch(state: State<AppState>, batch_name: String) -> Result<bool, String> {
    let settings = state.classifier.load_settings();
    state.with_db(|db| state.classifier.delete_batch(db, &settings, &batch_name))?;
    Ok(true)
}

#[tauri::command]
pub fn update_batch_site(
    state: State<AppState>,
    batch_name: String,
    new_site: String,
) -> Result<bool, String> {
    state.with_db(|db| state.classifier.update_batch_site(db, &batch_name, &new_site))
}

#[tauri::command]
pub fn get_batch_media(state: State<AppState>, batch_name: String) -> Result<BatchMediaResponse, String> {
    let settings = state.classifier.load_settings();
    state.with_db(|db| state.classifier.get_batch_media(db, &settings, &batch_name))
}

#[tauri::command]
pub fn save_classification(
    state: State<AppState>,
    batch_name: String,
    file_name: String,
    classifications: Vec<ClassificationItem>,
) -> Result<usize, String> {
    let settings = state.classifier.load_settings();
    state.with_db(|db| {
        state
            .classifier
            .save_classification(db, &settings, &batch_name, &file_name, &classifications)
    })
}

/// One file's tags, for saving many photos at once.
#[derive(serde::Deserialize)]
pub struct FileClassifications {
    #[serde(rename = "fileName")]
    pub file_name: String,
    pub classifications: Vec<ClassificationItem>,
}

#[tauri::command]
pub fn save_classifications_bulk(
    state: State<AppState>,
    batch_name: String,
    files: Vec<FileClassifications>,
) -> Result<usize, String> {
    let files: Vec<(String, Vec<ClassificationItem>)> = files.into_iter().map(|f| (f.file_name, f.classifications)).collect();
    state.with_db(|db| db.save_classifications_bulk(&batch_name, &files))
}

/// One photo's AI suggestion, stored as the front end's JSON.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct AiSuggestionRow {
    #[serde(rename = "fileName")]
    pub file_name: String,
    pub data: String,
}

#[tauri::command]
pub fn save_ai_suggestions(state: State<AppState>, batch_name: String, rows: Vec<AiSuggestionRow>) -> Result<usize, String> {
    let rows: Vec<(String, String)> = rows.into_iter().map(|r| (r.file_name, r.data)).collect();
    state.with_db(|db| db.save_ai_suggestions(&batch_name, &rows))
}

#[tauri::command]
pub fn get_ai_suggestions(state: State<AppState>, batch_name: String) -> Result<Vec<AiSuggestionRow>, String> {
    state
        .with_db(|db| db.get_ai_suggestions(&batch_name))
        .map(|rows| rows.into_iter().map(|(file_name, data)| AiSuggestionRow { file_name, data }).collect())
}

#[tauri::command]
pub fn clear_ai_suggestions(state: State<AppState>, batch_name: String) -> Result<(), String> {
    state.with_db(|db| db.clear_ai_suggestions(&batch_name))
}

#[tauri::command]
pub fn export_batch(
    state: State<AppState>,
    batch_name: String,
    export_type: Option<String>,
    destination_path: Option<String>,
    merge_data: Option<bool>,
    export_csv: Option<bool>,
    export_xlsx: Option<bool>,
    export_json: Option<bool>,
    export_txt: Option<bool>,
    image_structure: Option<String>,
) -> Result<ExportResult, String> {
    let settings = state.classifier.load_settings();
    state.with_db(|db| {
        state.classifier.export_batch_with_full_options(
            db,
            &settings,
            &batch_name,
            export_type.as_deref(),
            destination_path.as_deref(),
            merge_data,
            export_csv,
            export_xlsx,
            export_json,
            export_txt,
            image_structure.as_deref(),
        )
    })
}

#[tauri::command]
pub fn export_combined_batches(
    state: State<AppState>,
    batch_names: Vec<String>,
    export_type: Option<String>,
    destination_path: Option<String>,
    merge_data: Option<bool>,
    export_csv: Option<bool>,
    export_xlsx: Option<bool>,
    export_json: Option<bool>,
    export_txt: Option<bool>,
    image_structure: Option<String>,
) -> Result<ExportResult, String> {
    let settings = state.classifier.load_settings();
    state.with_db(|db| {
        state.classifier.export_combined_batches_with_full_options(
            db,
            &settings,
            &batch_names,
            export_type.as_deref(),
            destination_path.as_deref(),
            merge_data,
            export_csv,
            export_xlsx,
            export_json,
            export_txt,
            image_structure.as_deref(),
        )
    })
}

#[tauri::command]
pub fn relink_batch_path(
    state: State<AppState>,
    batch_name: String,
    new_path: String,
) -> Result<bool, String> {
    state.with_db(|db| state.classifier.relink_batch(db, &batch_name, &new_path))
}

#[tauri::command]
pub fn delete_batch_local_images(
    state: State<AppState>,
    batch_name: String,
) -> Result<bool, String> {
    state.with_db(|db| state.classifier.delete_batch_local_images(db, &batch_name))
}

#[tauri::command]
pub fn get_active_keymap(state: State<AppState>) -> Result<Vec<KeymapItem>, String> {
    state.with_db(|db| db.get_active_keymap())
}

#[tauri::command]
pub fn get_all_keymap(state: State<AppState>) -> Result<Vec<KeymapItem>, String> {
    state.with_db(|db| db.get_all_keymap())
}

#[tauri::command]
pub fn save_keymap_item(state: State<AppState>, item: KeymapItem) -> Result<Vec<KeymapItem>, String> {
    state.with_db(|db| db.save_keymap_item(&item))
}

#[tauri::command]
pub fn delete_keymap_item(state: State<AppState>, keystrokes: String) -> Result<Vec<KeymapItem>, String> {
    state.with_db(|db| db.delete_keymap_item(&keystrokes))
}

#[tauri::command]
pub fn reorder_keymap(state: State<AppState>, keys: Vec<String>) -> Result<Vec<KeymapItem>, String> {
    state.with_db(|db| db.reorder_keymap(&keys))
}

#[tauri::command]
pub fn reset_default_keymaps(state: State<AppState>) -> Result<Vec<KeymapItem>, String> {
    state.with_db(|db| db.reset_default_keymaps())
}

#[tauri::command]
pub fn get_comments(state: State<AppState>) -> Result<Vec<String>, String> {
    state.with_db(|db| db.get_comments())
}

#[tauri::command]
pub fn add_comment(state: State<AppState>, comment: String) -> Result<Vec<String>, String> {
    state.with_db(|db| db.add_comment(&comment))
}

#[tauri::command]
pub fn delete_comment(state: State<AppState>, comment: String) -> Result<Vec<String>, String> {
    state.with_db(|db| db.delete_comment(&comment))
}

#[tauri::command]
pub fn reset_default_comments(state: State<AppState>) -> Result<Vec<String>, String> {
    state.with_db(|db| db.reset_default_comments())
}

#[tauri::command]
pub fn get_analytics_data(state: State<AppState>) -> AnalyticsResponse {
    let settings = state.classifier.load_settings();
    if let Ok(db) = state.db.lock() {
        state.classifier.get_analytics_data(&db, &settings)
    } else {
        AnalyticsResponse {
            observations: Vec::new(),
            is_sample: false,
        }
    }
}

#[tauri::command]
pub fn get_dev_mode() -> bool {
    DEV_MODE
}

#[tauri::command]
pub fn get_sample_path(state: State<AppState>) -> Option<String> {
    if !DEV_MODE {
        return None;
    }
    state.classifier.load_settings().sample_path
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        if p.is_file() {
            cmd.arg("-R");
        }
        cmd.arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        if p.is_file() {
            std::process::Command::new("explorer")
                .arg(format!("/select,{}", path))
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new("explorer")
                .arg(&path)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn read_media_file(path: String) -> Result<String, String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("File not found: {}", path));
    }
    let data = std::fs::read(p).map_err(|e| format!("Failed to read file: {}", e))?;
    let ext = p.extension().unwrap_or_default().to_string_lossy().to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        _ => "application/octet-stream",
    };
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
pub fn export_analytics_csv(
    state: State<AppState>,
    csv_content: String,
    filename: String,
    destination_path: Option<String>,
) -> Result<String, String> {
    let target_path = if let Some(dest) = destination_path.filter(|d| !d.trim().is_empty()) {
        let p = std::path::PathBuf::from(dest);
        if p.is_dir() {
            p.join(&filename)
        } else {
            p
        }
    } else {
        let settings = state.classifier.load_settings();
        if settings.export_folder.is_empty() {
            return Err("Export Folder is not configured. Please set an Export Folder in Settings first.".to_string());
        }
        let export_root = std::path::Path::new(&settings.export_folder);
        if !export_root.exists() {
            std::fs::create_dir_all(export_root).map_err(|e| e.to_string())?;
        }
        export_root.join(&filename)
    };

    if let Some(parent) = target_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }

    let bytes = if csv_content.as_bytes().starts_with(b"\xEF\xBB\xBF") {
        csv_content.into_bytes()
    } else {
        let mut b = b"\xEF\xBB\xBF".to_vec();
        b.extend_from_slice(csv_content.as_bytes());
        b
    };
    std::fs::write(&target_path, bytes).map_err(|e| e.to_string())?;
    Ok(target_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_app_data_path(state: State<AppState>) -> String {
    state.classifier.data_dir.to_string_lossy().to_string()
}

#[tauri::command]
pub fn open_app_data_folder(state: State<AppState>) -> Result<(), String> {
    let data_dir = state.classifier.data_dir.to_string_lossy().to_string();
    open_path(data_dir)
}

#[tauri::command]
pub async fn select_save_backup_path(
    app: tauri::AppHandle,
    default_name: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut builder = app.dialog().file()
        .add_filter("Zip Archive", &["zip"])
        .set_title("Choose Backup Save Location");
    if let Some(name) = default_name {
        builder = builder.set_file_name(name);
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    builder.save_file(move |file| {
        let path = file.map(|f| f.to_string());
        let _ = tx.send(path);
    });
    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn select_backup_file(
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let builder = app.dialog().file()
        .add_filter("Zip Archive", &["zip"])
        .set_title("Select TRAAACE Backup Archive (.zip)");
    let (tx, rx) = tokio::sync::oneshot::channel();
    builder.pick_file(move |file| {
        let path = file.map(|f| f.to_string());
        let _ = tx.send(path);
    });
    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn backup_app_data(
    state: State<AppState>,
    destination_path: String,
) -> Result<crate::classifier::BackupInfo, String> {
    let dest = std::path::Path::new(&destination_path);
    state.with_db(|db| state.classifier.create_backup(db, dest))
}

#[tauri::command]
pub fn restore_app_data(
    state: State<AppState>,
    source_path: String,
) -> Result<crate::classifier::BackupInfo, String> {
    let src = std::path::Path::new(&source_path);
    state.with_db(|db| state.classifier.restore_backup(db, src))
}

#[tauri::command]
pub async fn select_csv_file(
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let builder = app.dialog().file()
        .add_filter("CSV Spreadsheet", &["csv"])
        .set_title("Select Observation Records CSV File");
    let (tx, rx) = tokio::sync::oneshot::channel();
    builder.pick_file(move |file| {
        let path = file.map(|f| f.to_string());
        let _ = tx.send(path);
    });
    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn select_save_csv_path(
    app: tauri::AppHandle,
    default_name: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut builder = app.dialog().file()
        .add_filter("CSV Spreadsheet", &["csv"])
        .set_title("Save Observation Records CSV");
    if let Some(name) = default_name {
        builder = builder.set_file_name(name);
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    builder.save_file(move |file| {
        let path = file.map(|f| f.to_string());
        let _ = tx.send(path);
    });
    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_analytics_csv(
    state: State<AppState>,
    file_path: String,
) -> Result<crate::classifier::CsvImportResult, String> {
    let path = std::path::Path::new(&file_path);
    state.with_db(|db| state.classifier.import_csv_file(db, path))
}

#[tauri::command]
pub fn start_drag(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scan_folder(path: String, recursive: bool) -> Result<Vec<crate::models::ScannedMediaItem>, String> {
    use walkdir::WalkDir;
    let root = std::path::Path::new(&path);
    if !root.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    let base_dir = if root.is_file() {
        root.parent().unwrap_or(root).to_path_buf()
    } else {
        root.to_path_buf()
    };

    let target_dir = if base_dir.join("DCIM").is_dir() {
        base_dir.join("DCIM")
    } else {
        base_dir
    };

    let max_depth = if recursive { 12 } else { 2 };
    let mut items = Vec::new();

    for entry in WalkDir::new(&target_dir)
        .max_depth(max_depth)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            let filename = entry.file_name().to_string_lossy().to_string();
            let ext = std::path::Path::new(&filename)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif" | "mp4" | "mov" | "avi") && !filename.starts_with('.') {
                let full_path = entry.path().to_string_lossy().to_string();
                let meta = entry.metadata().ok();
                let file_size_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);

                let timestamp = meta
                    .and_then(|m| m.modified().ok())
                    .map(|mtime| {
                        let dt: chrono::DateTime<chrono::Utc> = mtime.into();
                        dt.to_rfc3339()
                    })
                    .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

                items.push(crate::models::ScannedMediaItem {
                    id: format!("{}_{}", items.len(), filename),
                    path: full_path,
                    filename,
                    timestamp,
                    file_size_bytes,
                });
            }
        }
    }

    items.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(items)
}

#[tauri::command]
pub fn export_quick_session(request: crate::models::QuickExportRequest) -> Result<crate::models::QuickExportResult, String> {
    crate::export::execute_quick_export(request)
}

#[tauri::command]
pub fn update_file_timestamp(full_path: String, new_timestamp: String) -> Result<bool, String> {
    use std::fs::FileTimes;
    use chrono::DateTime;
    let path = std::path::Path::new(&full_path);
    if !path.exists() {
        return Err(format!("File does not exist: {}", full_path));
    }
    let dt = DateTime::parse_from_rfc3339(&new_timestamp)
        .map_err(|e| format!("Invalid RFC3339 timestamp: {}", e))?;
    let sys_time: std::time::SystemTime = dt.into();
    let file = std::fs::File::options().write(true).open(path).map_err(|e| e.to_string())?;
    file.set_times(FileTimes::new().set_modified(sys_time)).map_err(|e| e.to_string())?;
    Ok(true)
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageThumbnailItem {
    pub original_path: String,
    pub thumb_path: String,
}

/// Stable cache key for a thumbnail. Includes mtime and size so a replaced or edited file at the
/// same path gets a fresh thumbnail. FNV-1a is hand-rolled because `DefaultHasher` is not
/// guaranteed stable across Rust releases, which would orphan the on-disk cache.
fn thumbnail_cache_key(source: &std::path::Path, mtime_nanos: u128, len: u64) -> String {
    const FNV_OFFSET: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;

    let mut hash = FNV_OFFSET;
    let mut feed = |bytes: &[u8]| {
        for b in bytes {
            hash ^= *b as u64;
            hash = hash.wrapping_mul(FNV_PRIME);
        }
    };
    feed(source.to_string_lossy().as_bytes());
    feed(&mtime_nanos.to_le_bytes());
    feed(&len.to_le_bytes());
    format!("{:016x}", hash)
}

fn create_thumbnail(source: &std::path::Path, cache_dir: &std::path::Path) -> Result<String, String> {
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    // Only process standard image extensions
    if !matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp") {
        return Ok(source.to_string_lossy().into_owned());
    }

    let (mtime_nanos, len) = std::fs::metadata(source)
        .map(|m| {
            let nanos = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_nanos());
            (nanos, m.len())
        })
        .unwrap_or((0, 0));

    let dest = cache_dir.join(format!("{}.webp", thumbnail_cache_key(source, mtime_nanos, len)));

    if !dest.exists() {
        if let Ok(img) = image::open(source) {
            let thumb = img.thumbnail(320, 320);
            let _ = thumb.save(&dest);
        } else {
            return Ok(source.to_string_lossy().into_owned());
        }
    }

    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn get_or_create_thumbnail(app: tauri::AppHandle, path: String) -> Result<String, String> {
    use tauri::Manager;
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("thumbnails");

    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    let _ = app.asset_protocol_scope().allow_directory(&cache_dir, true);

    tauri::async_runtime::spawn_blocking(move || {
        create_thumbnail(std::path::Path::new(&path), &cache_dir)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn generate_thumbnails(app: tauri::AppHandle, paths: Vec<String>) -> Result<Vec<ImageThumbnailItem>, String> {
    use rayon::prelude::*;
    use tauri::Manager;

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("thumbnails");

    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    let _ = app.asset_protocol_scope().allow_directory(&cache_dir, true);

    tauri::async_runtime::spawn_blocking(move || {
        let items: Vec<ImageThumbnailItem> = paths
            .par_iter()
            .map(|orig| {
                let thumb = create_thumbnail(std::path::Path::new(orig), &cache_dir)
                    .unwrap_or_else(|_| orig.clone());
                ImageThumbnailItem {
                    original_path: orig.clone(),
                    thumb_path: thumb,
                }
            })
            .collect();
        Ok(items)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::thumbnail_cache_key;
    use std::path::Path;

    #[test]
    fn thumbnail_key_is_stable() {
        // Pinned value: changing it invalidates every user's on-disk thumbnail cache.
        assert_eq!(
            thumbnail_cache_key(Path::new("/photos/a.jpg"), 1_700_000_000_000_000_000, 2048),
            "bdfdde1ff7736bea"
        );
    }

    #[test]
    fn thumbnail_key_changes_with_path_mtime_and_size() {
        let base = thumbnail_cache_key(Path::new("/photos/a.jpg"), 100, 10);
        assert_ne!(base, thumbnail_cache_key(Path::new("/photos/b.jpg"), 100, 10));
        assert_ne!(base, thumbnail_cache_key(Path::new("/photos/a.jpg"), 101, 10));
        assert_ne!(base, thumbnail_cache_key(Path::new("/photos/a.jpg"), 100, 11));
    }
}
