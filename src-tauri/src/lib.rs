#[cfg(feature = "ai")]
pub mod ai;
mod ai_commands;
mod classifier;
mod commands;
mod db;
mod export;
mod media_server;
mod models;

use classifier::{ClassifierService, DEV_MODE};
use commands::AppState;
use db::Database;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

fn resolve_app_dir(app: &tauri::App) -> PathBuf {
    if DEV_MODE {
        let mut dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        if dir.ends_with("src-tauri") {
            if let Some(parent) = dir.parent() {
                dir = parent.to_path_buf();
            }
        }
        dir
    } else {
        app.path()
            .app_data_dir()
            .expect("Failed to resolve app data directory")
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Info and above only: the libraries' debug and trace messages (every web request, every window event) hid anything useful.
        .plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())
        // Reopen the window at the size, position and maximized state the user left it in. Not its visibility: the
        // page shows the window itself once it is ready (startup.ts). The first start uses tauri.conf.json (centred).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .setup(|app| {
            let app_dir = resolve_app_dir(app);
            let data_dir = app_dir.join("data");
            std::fs::create_dir_all(&data_dir)?;

            let db = Database::new(data_dir.join("trace_classifier.sqlite"))?;
            let classifier = ClassifierService::new(&app_dir);

            app.manage(ai_commands::AiState::default());
            app.manage(AppState {
                db: Arc::new(Mutex::new(db)),
                classifier: Arc::new(classifier),
            });

            app.manage(media_server::MediaState::default());

            // The window starts hidden and the page shows it once it has drawn (see startup.ts), so the user
            // never sees a blank window, a resize or the theme being applied. If that never happens (the page
            // failed to load), show it anyway after a few seconds rather than leave an invisible app.
            if let Some(window) = app.get_webview_window("main") {
                // The app's dark background for the webview too, so any area not yet painted during a resize is never
                // white (Windows' webview defaults to white).
                let _ = window.set_background_color(Some(tauri::window::Color(16, 18, 20, 255)));
                // First start (no saved window state yet): the default 1280x840, but never more than 85% of the
                // usable screen, so it fits small laptop screens with display scaling. Later starts use the saved size.
                let first_start = app
                    .path()
                    .app_config_dir()
                    .map(|dir| !dir.join(tauri_plugin_window_state::DEFAULT_FILENAME).exists())
                    .unwrap_or(false);
                if first_start {
                    if let Ok(Some(monitor)) = window.current_monitor() {
                        let scale = monitor.scale_factor();
                        let area = monitor.work_area().size.to_logical::<f64>(scale);
                        let width = (area.width * 0.85).min(1280.0);
                        let height = (area.height * 0.85).min(840.0);
                        let _ = window.set_size(tauri::LogicalSize::new(width, height));
                        let _ = window.center();
                    }
                }
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Project Library Commands (SQLite Backed)
            commands::get_settings,
            commands::save_settings,
            commands::get_batches,
            commands::delete_batch,
            commands::update_batch_site,
            commands::get_batch_media,
            commands::save_classification,
            commands::save_classifications_bulk,
            commands::save_ai_suggestions,
            commands::get_ai_suggestions,
            commands::clear_ai_suggestions,
            commands::export_batch,
            commands::export_combined_batches,
            commands::select_folder,
            commands::preview_import,
            commands::execute_import,
            commands::get_active_keymap,
            commands::get_all_keymap,
            commands::save_keymap_item,
            commands::delete_keymap_item,
            commands::reorder_keymap,
            commands::reset_default_keymaps,
            commands::get_comments,
            commands::add_comment,
            commands::delete_comment,
            commands::reset_default_comments,
            commands::get_analytics_data,
            commands::get_dev_mode,
            commands::get_sample_path,
            commands::open_path,
            commands::read_media_file,
            commands::export_analytics_csv,
            commands::relink_batch_path,
            commands::delete_batch_local_images,
            commands::get_app_data_path,
            commands::open_app_data_folder,
            commands::select_save_backup_path,
            commands::select_backup_file,
            commands::backup_app_data,
            commands::restore_app_data,
            commands::select_csv_file,
            commands::select_save_csv_path,
            commands::import_analytics_csv,
            commands::start_drag,
            media_server::media_url,

            // Quick Classify Commands (Ephemeral)
            commands::scan_folder,
            commands::export_quick_session,
            commands::update_file_timestamp,
            commands::get_or_create_thumbnail,
            commands::generate_thumbnails,

            // Optional AI add-on
            ai_commands::ai_status,
            ai_commands::ai_download_info,
            ai_commands::ai_install_start,
            ai_commands::ai_install_cancel,
            ai_commands::ai_uninstall,
            ai_commands::ai_scan_start,
            ai_commands::ai_scan_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
