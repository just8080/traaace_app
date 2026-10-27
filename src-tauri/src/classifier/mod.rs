use chrono::Local;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use crate::db::{Database, DbBatch};

mod analytics;
mod backup;
pub mod importer;

pub use analytics::{AnalyticsResponse, ObservationRecord};
#[allow(unused_imports)]
pub use importer::{CsvImportResult, DetectedBatch, ImportPreview, ImportResult};

const VALID_MEDIA_EXTS: &[&str] = &[".jpg", ".jpeg", ".mp4", ".avi", ".mov"];
const VIDEO_EXTS: &[&str] = &[".mp4", ".avi", ".mov"];
pub const EXPORTED_PREFIX: &str = "__";

/// True only for debug/dev builds. Gates all sample/demo tooling so release builds
/// ship without it. To strip it permanently, delete code guarded by this constant.
pub const DEV_MODE: bool = cfg!(debug_assertions);

fn sample_sd_card_path(base: &Path) -> Option<String> {
    DEV_MODE.then(|| base.join("sample_sd_card").to_string_lossy().to_string())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    #[serde(rename = "workingFolder")]
    pub working_folder: String,
    #[serde(rename = "exportFolder")]
    pub export_folder: String,
    #[serde(rename = "keyboardDelay")]
    pub keyboard_delay: u64,
    #[serde(rename = "autoAdvance")]
    pub auto_advance: bool,
    /// Milliseconds auto-advance waits after a tag. `default` keeps older settings files loadable.
    #[serde(rename = "autoAdvanceDelay", default)]
    pub auto_advance_delay: u64,
    pub theme: String,
    pub contrast: String,
    #[serde(rename = "uiScale")]
    pub ui_scale: f64,
    #[serde(rename = "samplePath", skip_serializing_if = "Option::is_none")]
    pub sample_path: Option<String>,
    #[serde(rename = "appDir", skip_serializing_if = "Option::is_none")]
    pub app_dir: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct UpdateSettings {
    #[serde(rename = "workingFolder")]
    pub working_folder: Option<String>,
    #[serde(rename = "exportFolder")]
    pub export_folder: Option<String>,
    #[serde(rename = "keyboardDelay")]
    pub keyboard_delay: Option<u64>,
    #[serde(rename = "autoAdvance")]
    pub auto_advance: Option<bool>,
    #[serde(rename = "autoAdvanceDelay")]
    pub auto_advance_delay: Option<u64>,
    pub theme: Option<String>,
    pub contrast: Option<String>,
    #[serde(rename = "uiScale")]
    pub ui_scale: Option<f64>,
    #[serde(rename = "samplePath")]
    pub sample_path: Option<String>,
    #[serde(rename = "appDir")]
    pub app_dir: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BackupInfo {
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "batchCount")]
    pub batch_count: usize,
    #[serde(rename = "classificationCount")]
    pub classification_count: usize,
    #[serde(rename = "speciesCount")]
    pub species_count: usize,
    pub timestamp: String,
    pub message: String,
}


impl Default for AppSettings {
    fn default() -> Self {
        let cwd = std::env::current_dir().unwrap_or_default();
        Self {
            working_folder: String::new(),
            export_folder: String::new(),
            keyboard_delay: 400,
            auto_advance: false,
            auto_advance_delay: 0,
            theme: "light".to_string(),
            contrast: "standard".to_string(),
            ui_scale: 1.0,
            sample_path: sample_sd_card_path(&cwd),
            app_dir: Some(cwd.to_string_lossy().to_string()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BatchSummary {
    pub name: String,
    pub path: String,
    pub site: String,
    #[serde(rename = "totalImages")]
    pub total_images: usize,
    #[serde(rename = "classifiedCount")]
    pub classified_count: usize,
    #[serde(rename = "exportedCount")]
    pub exported_count: usize,
    pub status: String,
    #[serde(rename = "mediaAvailable")]
    pub media_available: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClassificationItem {
    pub species: String,
    pub count: i64,
    pub comment: String,
    pub sha256: Option<String>,
    #[serde(rename = "speciesInFrame")]
    pub species_in_frame: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaItem {
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(rename = "fullPath")]
    pub full_path: String,
    #[serde(rename = "isExported")]
    pub is_exported: bool,
    #[serde(rename = "isVideo")]
    pub is_video: bool,
    pub classifications: Vec<ClassificationItem>,
    #[serde(default)]
    pub timestamp: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BatchMediaResponse {
    #[serde(rename = "batchName")]
    pub batch_name: String,
    #[serde(rename = "siteName")]
    pub site_name: String,
    #[serde(rename = "batchDir")]
    pub batch_dir: String,
    pub items: Vec<MediaItem>,
}


#[allow(unused_imports)]
pub use crate::models::{ExportRecord, ExportResult};


pub struct ClassifierService {
    pub base_dir: PathBuf,
    pub data_dir: PathBuf,
    pub settings_path: PathBuf,
}

impl ClassifierService {
    pub fn new<P: AsRef<Path>>(base_dir: P) -> Self {
        let mut base = base_dir.as_ref().to_path_buf();
        // If current dir was src-tauri, ascend one level to the project root
        if base.ends_with("src-tauri") {
            if let Some(parent) = base.parent() {
                base = parent.to_path_buf();
            }
        }
        let data = base.join("data");
        let settings_path = data.join("settings.json");
        Self {
            base_dir: base,
            data_dir: data,
            settings_path,
        }
    }

    pub fn load_settings(&self) -> AppSettings {
        let sample = sample_sd_card_path(&self.base_dir);
        let app_dir = Some(self.base_dir.to_string_lossy().to_string());

        if let Ok(content) = fs::read_to_string(&self.settings_path) {
            if let Ok(mut settings) = serde_json::from_str::<AppSettings>(&content) {
                // Remove legacy default Downloads folder if it was auto-set on previous run
                if settings.working_folder.ends_with("/Downloads") || settings.working_folder.ends_with("\\Downloads") {
                    settings.working_folder = String::new();
                }
                if settings.export_folder.ends_with("/Downloads") || settings.export_folder.ends_with("\\Downloads") {
                    settings.export_folder = String::new();
                }
                if settings.working_folder.ends_with("/working_folder") && !Path::new(&settings.working_folder).exists() {
                    settings.working_folder = String::new();
                }
                if settings.export_folder.ends_with("/export_folder") && !Path::new(&settings.export_folder).exists() {
                    settings.export_folder = String::new();
                }
                // Never carry a stored sample path into a release build.
                settings.sample_path = sample;
                if settings.app_dir.is_none() {
                    settings.app_dir = app_dir;
                }
                return settings;
            }
        }
        AppSettings {
            working_folder: String::new(),
            export_folder: String::new(),
            sample_path: sample,
            app_dir,
            ..AppSettings::default()
        }
    }

    pub fn save_settings(&self, new_settings: AppSettings) -> Result<AppSettings, String> {
        let _ = fs::create_dir_all(&self.data_dir);
        let serialized = serde_json::to_string_pretty(&new_settings)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;
        fs::write(&self.settings_path, serialized)
            .map_err(|e| format!("Failed to write settings file: {}", e))?;

        if !new_settings.working_folder.is_empty() {
            let _ = fs::create_dir_all(&new_settings.working_folder);
        }
        if !new_settings.export_folder.is_empty() {
            let _ = fs::create_dir_all(&new_settings.export_folder);
        }

        Ok(new_settings)
    }

    pub fn update_settings(&self, patch: UpdateSettings) -> Result<AppSettings, String> {
        let mut current = self.load_settings();
        if let Some(wf) = patch.working_folder {
            current.working_folder = wf;
        }
        if let Some(ef) = patch.export_folder {
            current.export_folder = ef;
        }
        if let Some(kd) = patch.keyboard_delay {
            current.keyboard_delay = kd;
        }
        if let Some(aa) = patch.auto_advance {
            current.auto_advance = aa;
        }
        if let Some(ad) = patch.auto_advance_delay {
            current.auto_advance_delay = ad.min(3000);
        }
        if let Some(th) = patch.theme {
            current.theme = th;
        }
        if let Some(ct) = patch.contrast {
            current.contrast = ct;
        }
        if let Some(us) = patch.ui_scale {
            current.ui_scale = us;
        }
        if let Some(sp) = patch.sample_path {
            current.sample_path = Some(sp);
        }
        if let Some(ad) = patch.app_dir {
            current.app_dir = Some(ad);
        }
        self.save_settings(current)
    }


    pub fn is_valid_media(file_name: &str) -> bool {
        let lower = file_name.to_lowercase();
        VALID_MEDIA_EXTS.iter().any(|ext| lower.ends_with(ext))
    }

    pub fn is_video(file_name: &str) -> bool {
        let lower = file_name.to_lowercase();
        VIDEO_EXTS.iter().any(|ext| lower.ends_with(ext))
    }

    pub(crate) fn read_site_name(batch_dir: &Path, batch_name: &str) -> String {
        let site_txt = batch_dir.join("_site.txt");
        if site_txt.exists() {
            if let Ok(content) = fs::read_to_string(site_txt) {
                let trimmed = content.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
        }
        batch_name.split('-').next().unwrap_or("SITE").to_string()
    }

    pub fn get_batches(&self, db: &Database, settings: &AppSettings) -> Vec<BatchSummary> {
        let mut batches = Vec::new();
        let mut seen_batch_names = HashSet::new();

        // 0. Automatically sync folders inside settings.working_folder into SQLite database
        if !settings.working_folder.trim().is_empty() {
            let working_dir = Path::new(&settings.working_folder);
            if working_dir.exists() && working_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(working_dir) {
                for entry in entries.flatten() {
                    if let Ok(ft) = entry.file_type() {
                        if ft.is_dir() {
                            let path = entry.path();
                            let name = entry.file_name().to_string_lossy().to_string();
                            let site = Self::read_site_name(&path, &name);
                            let db_batch = DbBatch {
                                name: name.clone(),
                                path: path.to_string_lossy().to_string(),
                                site,
                                created_at: Local::now().to_rfc3339(),
                                total_images: 0,
                            };
                            let _ = db.add_batch(&db_batch);
                        }
                    }
                }
            }
        }
        }

        // 1. Database-backed batches (direct in-place workflow)
        let (classified_counts, exported_counts) = db.get_batch_counts().unwrap_or_default();
        if let Ok(db_batches) = db.get_all_batches() {
            for b in db_batches {
                let path = Path::new(&b.path);
                let classified = *classified_counts.get(&b.name).unwrap_or(&0);
                let exported = *exported_counts.get(&b.name).unwrap_or(&0);

                if !path.exists() {
                    // If the batch has classification data in the database, keep it!
                    // It is an archived/offline batch (e.g. user deleted or moved raw images to cold storage).
                    if classified > 0 || exported > 0 {
                        let total = if b.total_images > 0 {
                            b.total_images
                        } else {
                            classified
                        };
                        seen_batch_names.insert(b.name.clone());
                        batches.push(BatchSummary {
                            name: b.name,
                            path: b.path,
                            site: b.site,
                            total_images: total,
                            classified_count: classified,
                            exported_count: exported,
                            status: "archived".to_string(),
                            media_available: false,
                        });
                    } else {
                        // Truly empty ghost directory deleted before any classification
                        let _ = db.delete_batch(&b.name);
                    }
                    continue;
                }

                let mut total = 0;
                if path.is_dir() {
                    let target_dir = if path.join("DCIM").is_dir() {
                        path.join("DCIM")
                    } else {
                        path.to_path_buf()
                    };
                    for entry in WalkDir::new(&target_dir).max_depth(6).into_iter().filter_map(|e| e.ok()) {
                        if entry.file_type().is_file() {
                            let name = entry.file_name().to_string_lossy();
                            if Self::is_valid_media(&name) {
                                total += 1;
                            }
                        }
                    }
                }

                // Update total_images in SQLite if we found media and it differed
                if total > 0 && total != b.total_images {
                    let _ = db.update_batch_total_images(&b.name, total);
                }

                let status = if total > 0 && exported == total {
                    "exported".to_string()
                } else if total > 0 && classified == total {
                    "ready".to_string()
                } else if classified > 0 {
                    "inprogress".to_string()
                } else {
                    "unclassified".to_string()
                };

                seen_batch_names.insert(b.name.clone());
                batches.push(BatchSummary {
                    name: b.name,
                    path: b.path,
                    site: b.site,
                    total_images: total,
                    classified_count: classified,
                    exported_count: exported,
                    status,
                    media_available: true,
                });
            }
        }

        // 2. Legacy disk-based batches (folders inside working_folder)
        if !settings.working_folder.trim().is_empty() {
            let working_dir = Path::new(&settings.working_folder);
            if working_dir.exists() && working_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(working_dir) {
                for entry in entries.flatten() {
                    if let Ok(ft) = entry.file_type() {
                        if ft.is_dir() {
                            let path = entry.path();
                            let name = entry.file_name().to_string_lossy().to_string();
                            if seen_batch_names.contains(&name) {
                                continue;
                            }
                            let site = Self::read_site_name(&path, &name);

                            let mut total = 0;
                            let mut classified = 0;
                            let mut exported = 0;

                            if let Ok(files) = fs::read_dir(&path) {
                                for f in files.flatten() {
                                    let f_name = f.file_name().to_string_lossy().to_string();
                                    if Self::is_valid_media(&f_name) {
                                        total += 1;
                                        if f_name.starts_with(EXPORTED_PREFIX) {
                                            exported += 1;
                                        }
                                        let stem = Path::new(&f_name).file_stem().unwrap_or_default().to_string_lossy();
                                        let meta_file = path.join(format!("{}.txt", stem));
                                        if meta_file.exists() {
                                            classified += 1;
                                        }
                                    }
                                }
                            }

                            let status = if total > 0 && (classified == total || exported == total) {
                                "archived".to_string()
                            } else if classified > 0 {
                                "inprogress".to_string()
                            } else {
                                "unclassified".to_string()
                            };

                            batches.push(BatchSummary {
                                name,
                                path: path.to_string_lossy().to_string(),
                                site,
                                total_images: total,
                                classified_count: classified,
                                exported_count: exported,
                                status,
                                media_available: true,
                            });
                        }
                    }
                }
            }
        }
        }

        batches.sort_by(|a, b| b.name.cmp(&a.name));
        batches
    }

    pub fn preview_import(&self, source_path: &str) -> Result<ImportPreview, String> {
        importer::preview_import(source_path)
    }

    pub fn execute_import(
        &self,
        db: &Database,
        settings: &AppSettings,
        source_path: &str,
        site_name: &str,
    ) -> Result<ImportResult, String> {
        importer::execute_import(db, settings, source_path, site_name)
    }

    pub fn delete_batch(&self, db: &Database, _settings: &AppSettings, batch_name: &str) -> Result<(), String> {
        let _ = db.delete_batch(batch_name);
        Ok(())
    }

    pub fn relink_batch(&self, db: &Database, batch_name: &str, new_path: &str) -> Result<bool, String> {
        let p = Path::new(new_path);
        if !p.exists() || !p.is_dir() {
            return Err("The selected folder does not exist or is not a directory.".to_string());
        }
        db.update_batch_path(batch_name, new_path).map_err(|e| e.to_string())?;
        Ok(true)
    }

    pub fn update_batch_site(&self, db: &Database, batch_name: &str, new_site: &str) -> Result<bool, String> {
        let clean_site = new_site.trim();
        if clean_site.is_empty() {
            return Err("Site / location name cannot be empty.".to_string());
        }

        db.update_batch_site(batch_name, clean_site).map_err(|e| e.to_string())?;

        // Also write to _site.txt inside the batch folder if it exists
        if let Ok(Some(db_batch)) = db.get_batch(batch_name) {
            let p = Path::new(&db_batch.path);
            if p.exists() && p.is_dir() {
                let site_txt = p.join("_site.txt");
                let _ = fs::write(site_txt, clean_site);
            }
        }

        Ok(true)
    }

    pub fn delete_batch_local_images(&self, db: &Database, batch_name: &str) -> Result<bool, String> {
        if let Ok(Some(db_batch)) = db.get_batch(batch_name) {
            let p = Path::new(&db_batch.path);
            if p.exists() {
                fs::remove_dir_all(p).map_err(|e| format!("Failed to delete local image folder: {}", e))?;
                return Ok(true);
            }
            Ok(false)
        } else {
            Err(format!("Batch '{}' not found in database.", batch_name))
        }
    }

    pub fn get_batch_media(
        &self,
        db: &Database,
        settings: &AppSettings,
        batch_name: &str,
    ) -> Result<BatchMediaResponse, String> {
        // 1. Database-backed batch (direct in-place)
        if let Ok(Some(db_batch)) = db.get_batch(batch_name) {
            let batch_dir = PathBuf::from(&db_batch.path);
            if !batch_dir.exists() {
                return Err(format!(
                    "Batch media folder is offline or has been moved: {:?}. You can re-link the folder to view and classify photos.",
                    batch_dir
                ));
            }

            let site_name = db_batch.site;
            let classifications_map = db.get_classifications_map_for_batch(batch_name).unwrap_or_default();
            let media_status_map = db.get_media_status_map_for_batch(batch_name).unwrap_or_default();

            let mut items = Vec::new();
            let scan_dir = if batch_dir.join("DCIM").is_dir() {
                batch_dir.join("DCIM")
            } else {
                batch_dir.clone()
            };

            for entry in WalkDir::new(&scan_dir).max_depth(6).into_iter().filter_map(|e| e.ok()) {
                if entry.file_type().is_file() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if Self::is_valid_media(&name) {
                        let is_exported = *media_status_map.get(&name).unwrap_or(&false);
                        let is_vid = Self::is_video(&name);
                        let classifications = classifications_map.get(&name).cloned().unwrap_or_default();

                        let timestamp = entry
                            .metadata()
                            .ok()
                            .and_then(|m| m.modified().ok())
                            .map(|mtime| {
                                let dt: chrono::DateTime<chrono::Utc> = mtime.into();
                                dt.to_rfc3339()
                            });

                        items.push(MediaItem {
                            file_name: name,
                            full_path: entry.path().to_string_lossy().to_string(),
                            is_exported,
                            is_video: is_vid,
                            classifications,
                            timestamp,
                        });
                    }
                }
            }

            items.sort_by(|a, b| a.file_name.cmp(&b.file_name));

            return Ok(BatchMediaResponse {
                batch_name: batch_name.to_string(),
                site_name,
                batch_dir: batch_dir.to_string_lossy().to_string(),
                items,
            });
        }

        // 2. Legacy fallback: directory in working_folder
        let batch_dir = Path::new(&settings.working_folder).join(batch_name);
        if !batch_dir.exists() {
            return Err(format!("Batch directory does not exist: {:?}", batch_dir));
        }

        let site_name = Self::read_site_name(&batch_dir, batch_name);
        let mut items = Vec::new();

        if let Ok(entries) = fs::read_dir(&batch_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if Self::is_valid_media(&name) {
                    let is_exported = name.starts_with(EXPORTED_PREFIX);
                    let is_vid = Self::is_video(&name);
                    let stem = Path::new(&name).file_stem().unwrap_or_default().to_string_lossy();
                    let meta_file = batch_dir.join(format!("{}.txt", stem));

                    let mut classifications = Vec::new();
                    if meta_file.exists() {
                        if let Ok(meta_content) = fs::read_to_string(&meta_file) {
                            for line in meta_content.lines() {
                                let parts: Vec<&str> = line.split('\t').collect();
                                if parts.len() >= 2 {
                                    classifications.push(ClassificationItem {
                                        species: parts[0].trim().to_string(),
                                        count: parts[1].trim().parse().unwrap_or(1),
                                        comment: parts.get(2).map(|c| c.trim().to_string()).unwrap_or_default(),
                                        sha256: parts.get(3).map(|s| s.trim().to_string()),
                                        species_in_frame: parts.get(4).and_then(|v| v.trim().parse().ok()),
                                    });
                                }
                            }
                        }
                    }

                    let timestamp = entry
                        .metadata()
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .map(|mtime| {
                            let dt: chrono::DateTime<chrono::Utc> = mtime.into();
                            dt.to_rfc3339()
                        });

                    items.push(MediaItem {
                        file_name: name,
                        full_path: entry.path().to_string_lossy().to_string(),
                        is_exported,
                        is_video: is_vid,
                        classifications,
                        timestamp,
                    });
                }
            }
        }

        items.sort_by(|a, b| a.file_name.cmp(&b.file_name));

        Ok(BatchMediaResponse {
            batch_name: batch_name.to_string(),
            site_name,
            batch_dir: batch_dir.to_string_lossy().to_string(),
            items,
        })
    }

    pub fn save_classification(
        &self,
        db: &mut Database,
        settings: &AppSettings,
        batch_name: &str,
        file_name: &str,
        classifications: &[ClassificationItem],
    ) -> Result<usize, String> {
        // If batch is in database, save directly into SQLite (zero .txt files created)
        if let Ok(Some(_)) = db.get_batch(batch_name) {
            return db
                .save_classifications(batch_name, file_name, classifications)
                .map_err(|e| e.to_string());
        }

        // Legacy fallback: write .txt file in working_folder/batch_name
        let batch_dir = Path::new(&settings.working_folder).join(batch_name);
        let media_path = batch_dir.join(file_name);
        if !media_path.exists() {
            return Err(format!("File does not exist: {:?}", media_path));
        }

        let stem = Path::new(file_name).file_stem().unwrap_or_default().to_string_lossy();
        let meta_path = batch_dir.join(format!("{}.txt", stem));

        if classifications.is_empty() {
            if meta_path.exists() {
                let _ = fs::remove_file(meta_path);
            }
            return Ok(0);
        }

        let total = classifications.len();
        let mut lines = Vec::new();
        for item in classifications {
            let sp = item.species.replace('\t', " ").trim().to_string();
            let count = item.count;
            let comment = item.comment.replace('\t', " ").trim().to_string();
            let sha = item.sha256.clone().unwrap_or_default();
            lines.push(format!("{}\t{}\t{}\t{}\t{}", sp, count, comment, sha, total));
        }

        fs::write(&meta_path, lines.join("\n") + "\n").map_err(|e| e.to_string())?;
        Ok(total)
    }

    #[cfg(test)]
    pub fn export_batch(
        &self,
        db: &Database,
        settings: &AppSettings,
        batch_name: &str,
    ) -> Result<ExportResult, String> {
        self.export_combined_batches_with_full_options(db, settings, &[batch_name.to_string()], None, None, Some(false), None, None, None, None, None)
    }

    #[cfg(test)]
    pub fn export_batch_with_options(
        &self,
        db: &Database,
        settings: &AppSettings,
        batch_name: &str,
        export_type: Option<&str>,
        destination_path: Option<&str>,
        merge_data: Option<bool>,
    ) -> Result<ExportResult, String> {
        self.export_combined_batches_with_full_options(db, settings, &[batch_name.to_string()], export_type, destination_path, merge_data, None, None, None, None, None)
    }

    pub fn export_batch_with_full_options(
        &self,
        db: &Database,
        settings: &AppSettings,
        batch_name: &str,
        export_type: Option<&str>,
        destination_path: Option<&str>,
        merge_data: Option<bool>,
        export_csv: Option<bool>,
        export_xlsx: Option<bool>,
        export_json: Option<bool>,
        export_txt: Option<bool>,
        image_structure: Option<&str>,
    ) -> Result<ExportResult, String> {
        self.export_combined_batches_with_full_options(db, settings, &[batch_name.to_string()], export_type, destination_path, merge_data, export_csv, export_xlsx, export_json, export_txt, image_structure)
    }

    #[cfg(test)]
    pub fn export_combined_batches(
        &self,
        db: &Database,
        settings: &AppSettings,
        batch_names: &[String],
    ) -> Result<ExportResult, String> {
        self.export_combined_batches_with_full_options(db, settings, batch_names, None, None, Some(false), None, None, None, None, None)
    }

    pub fn export_combined_batches_with_full_options(
        &self,
        db: &Database,
        settings: &AppSettings,
        batch_names: &[String],
        export_type: Option<&str>,
        destination_path: Option<&str>,
        merge_data: Option<bool>,
        export_csv: Option<bool>,
        export_xlsx: Option<bool>,
        export_json: Option<bool>,
        export_txt: Option<bool>,
        image_structure: Option<&str>,
    ) -> Result<ExportResult, String> {
        crate::export::export_combined_batches_with_full_options(
            db,
            settings,
            batch_names,
            export_type,
            destination_path,
            merge_data,
            export_csv,
            export_xlsx,
            export_json,
            export_txt,
            image_structure,
        )
    }

    pub fn get_analytics_data(&self, db: &Database, settings: &AppSettings) -> AnalyticsResponse {
        analytics::get_analytics_data(self, db, settings)
    }

    pub fn create_backup(&self, db: &Database, dest_zip_path: &Path) -> Result<BackupInfo, String> {
        backup::create_backup(db, dest_zip_path, &self.settings_path)
    }

    pub fn restore_backup(&self, db: &mut Database, src_zip_path: &Path) -> Result<BackupInfo, String> {
        backup::restore_backup(self, db, src_zip_path)
    }

    pub fn extract_capture_date_from_file(path: &Path) -> Option<String> {
        importer::extract_capture_date_from_file(path)
    }

    pub fn import_csv_file(&self, db: &mut Database, csv_path: &Path) -> Result<CsvImportResult, String> {
        importer::import_csv_file(self, db, csv_path)
    }
}


#[allow(unused_imports)]
pub use crate::export::{
    escape_csv, sanitize_folder_name, write_csv_records, write_json_records, write_txt_records,
    write_xlsx_records,
};


#[cfg(test)]
mod tests;
