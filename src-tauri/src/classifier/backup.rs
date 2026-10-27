use super::{AppSettings, BackupInfo, ClassifierService};
use crate::db::Database;
use chrono::Local;
use serde_json::json;
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

pub fn create_backup(
    db: &Database,
    dest_zip_path: &Path,
    settings_path: &Path,
) -> Result<BackupInfo, String> {
    let (batches, classifications, species) = db.get_stats().map_err(|e| e.to_string())?;

    // 1. Snapshot database safely to temporary file
    let temp_dir = std::env::temp_dir().join(format!(
        "traaace_bk_{}",
        Local::now().timestamp_nanos_opt().unwrap_or(11111)
    ));
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;
    let temp_sqlite = temp_dir.join("trace_classifier.sqlite");

    db.export_backup_db(&temp_sqlite)
        .map_err(|e| format!("Failed to snapshot database: {}", e))?;

    // 2. Prepare Zip Writer
    if let Some(parent) = dest_zip_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let zip_file = fs::File::create(dest_zip_path).map_err(|e| {
        format!(
            "Failed to create backup archive at {}: {}",
            dest_zip_path.display(),
            e
        )
    })?;
    let mut zip = ZipWriter::new(zip_file);
    let options =
        SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    // 3. Write manifest.json
    let now_str = Local::now().to_rfc3339();
    let manifest = json!({
        "app": "TRAAACE",
        "version": "0.1.0",
        "createdAt": now_str,
        "batchCount": batches,
        "classificationCount": classifications,
        "speciesCount": species
    });
    zip.start_file("manifest.json", options)
        .map_err(|e| format!("Failed to write manifest to zip: {}", e))?;
    zip.write_all(manifest.to_string().as_bytes())
        .map_err(|e| format!("Failed to write manifest data: {}", e))?;

    // 4. Write trace_classifier.sqlite
    zip.start_file("trace_classifier.sqlite", options)
        .map_err(|e| format!("Failed to write sqlite to zip: {}", e))?;
    let mut sqlite_file = fs::File::open(&temp_sqlite)
        .map_err(|e| format!("Failed to read temporary sqlite file: {}", e))?;
    std::io::copy(&mut sqlite_file, &mut zip)
        .map_err(|e| format!("Failed to copy database into zip: {}", e))?;

    // 5. Write settings.json if it exists
    if settings_path.exists() {
        if let Ok(mut settings_file) = fs::File::open(settings_path) {
            if zip.start_file("settings.json", options).is_ok() {
                let _ = std::io::copy(&mut settings_file, &mut zip);
            }
        }
    }

    zip.finish()
        .map_err(|e| format!("Failed to finalize zip archive: {}", e))?;
    let _ = fs::remove_dir_all(&temp_dir);

    let msg = format!(
        "Backup created successfully: {} batch{}, {} classification{}, and {} species hotkey{}.",
        batches,
        if batches == 1 { "" } else { "es" },
        classifications,
        if classifications == 1 { "" } else { "s" },
        species,
        if species == 1 { "" } else { "s" }
    );

    Ok(BackupInfo {
        file_path: dest_zip_path.to_string_lossy().to_string(),
        batch_count: batches,
        classification_count: classifications,
        species_count: species,
        timestamp: now_str,
        message: msg,
    })
}

pub fn restore_backup(
    service: &ClassifierService,
    db: &mut Database,
    src_zip_path: &Path,
) -> Result<BackupInfo, String> {
    if !src_zip_path.exists() {
        return Err(format!("Backup file not found: {}", src_zip_path.display()));
    }

    let zip_file = fs::File::open(src_zip_path)
        .map_err(|e| format!("Failed to open backup archive: {}", e))?;
    let mut archive = ZipArchive::new(zip_file).map_err(|e| format!("Invalid zip archive: {}", e))?;

    // Check for trace_classifier.sqlite
    let has_sqlite = archive.by_name("trace_classifier.sqlite").is_ok();
    if !has_sqlite {
        return Err("Invalid backup: trace_classifier.sqlite database file not found inside the zip archive.".to_string());
    }

    let temp_dir = std::env::temp_dir().join(format!(
        "traaace_rst_{}",
        Local::now().timestamp_nanos_opt().unwrap_or(22222)
    ));
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;
    let temp_sqlite = temp_dir.join("trace_classifier.sqlite");

    // Extract trace_classifier.sqlite to temp file
    {
        let mut zip_entry = archive
            .by_name("trace_classifier.sqlite")
            .map_err(|e| format!("Failed to read database from zip: {}", e))?;
        let mut out_file = fs::File::create(&temp_sqlite)
            .map_err(|e| format!("Failed to extract database: {}", e))?;
        std::io::copy(&mut zip_entry, &mut out_file)
            .map_err(|e| format!("Failed to write extracted database: {}", e))?;
    }

    // Verify the database is valid SQLite and read its stats
    let (batches, classifications, species) = {
        let test_conn = rusqlite::Connection::open(&temp_sqlite)
            .map_err(|e| format!("Corrupt or unreadable database in backup: {}", e))?;
        let b: usize = test_conn
            .query_row("SELECT count(*) FROM batches", [], |r| r.get(0))
            .unwrap_or(0);
        let c: usize = test_conn
            .query_row("SELECT count(*) FROM classifications", [], |r| r.get(0))
            .unwrap_or(0);
        let s: usize = test_conn
            .query_row("SELECT count(*) FROM keymap", [], |r| r.get(0))
            .unwrap_or(0);
        (b, c, s)
    };

    // Make a safety backup of existing current database if one exists
    let current_sqlite = service.data_dir.join("trace_classifier.sqlite");
    if current_sqlite.exists() {
        let bak_path = service.data_dir.join("trace_classifier.sqlite.bak");
        let _ = fs::copy(&current_sqlite, &bak_path);
    }

    // Safely release SQLite connection file lock before overwriting
    db.prepare_for_replace()
        .map_err(|e| format!("Failed to release current database connection: {}", e))?;

    // Ensure target data dir exists
    let _ = fs::create_dir_all(&service.data_dir);

    // Copy restored sqlite file to data_dir
    fs::copy(&temp_sqlite, &current_sqlite)
        .map_err(|e| format!("Failed to replace database with restored file: {}", e))?;

    // Reopen database connection
    db.reload(&current_sqlite)
        .map_err(|e| format!("Failed to reopen restored database: {}", e))?;

    // Restore settings.json if present
    if let Ok(mut settings_entry) = archive.by_name("settings.json") {
        let mut buf = String::new();
        if settings_entry.read_to_string(&mut buf).is_ok() {
            if let Ok(bk_settings) = serde_json::from_str::<AppSettings>(&buf) {
                let mut current = service.load_settings();
                if !bk_settings.working_folder.is_empty()
                    && Path::new(&bk_settings.working_folder).exists()
                {
                    current.working_folder = bk_settings.working_folder;
                }
                if !bk_settings.export_folder.is_empty()
                    && Path::new(&bk_settings.export_folder).exists()
                {
                    current.export_folder = bk_settings.export_folder;
                }
                current.theme = bk_settings.theme;
                current.contrast = bk_settings.contrast;
                current.ui_scale = bk_settings.ui_scale;
                current.keyboard_delay = bk_settings.keyboard_delay;
                current.auto_advance = bk_settings.auto_advance;
                current.auto_advance_delay = bk_settings.auto_advance_delay;
                let _ = service.save_settings(current);
            }
        }
    }

    let _ = fs::remove_dir_all(&temp_dir);

    let msg = format!(
        "Backup restored successfully: restored {} batch{}, {} classification{}, and {} species hotkey{}.",
        batches,
        if batches == 1 { "" } else { "es" },
        classifications,
        if classifications == 1 { "" } else { "s" },
        species,
        if species == 1 { "" } else { "s" }
    );

    Ok(BackupInfo {
        file_path: src_zip_path.to_string_lossy().to_string(),
        batch_count: batches,
        classification_count: classifications,
        species_count: species,
        timestamp: Local::now().to_rfc3339(),
        message: msg,
    })
}
