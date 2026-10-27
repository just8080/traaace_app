use chrono::{DateTime, Local, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use crate::classifier::{AppSettings, ClassifierService, EXPORTED_PREFIX};
use crate::db::{Database, DbBatch, CsvObservationInput};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CsvImportResult {
    #[serde(rename = "importedCount")]
    pub imported_count: usize,
    #[serde(rename = "batchCount")]
    pub batch_count: usize,
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DetectedBatch {
    pub name: String,
    pub path: String,
    pub site: String,
    pub count: usize,
    #[serde(rename = "firstMedia")]
    pub first_media: Option<String>,
    #[serde(rename = "earliestDate")]
    pub earliest_date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImportPreview {
    pub count: usize,
    pub files: Vec<String>,
    #[serde(rename = "earliestDate")]
    pub earliest_date: Option<String>,
    #[serde(rename = "firstMedia")]
    pub first_media: Option<String>,
    #[serde(rename = "isMultiBatch")]
    pub is_multi_batch: bool,
    #[serde(rename = "detectedBatches")]
    pub detected_batches: Vec<DetectedBatch>,
    #[serde(rename = "suggestedSite")]
    pub suggested_site: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImportResult {
    pub name: String,
    #[serde(rename = "batchName")]
    pub batch_name: String,
    pub path: String,
    pub site: String,
    #[serde(rename = "totalImages")]
    pub total_images: usize,
    #[serde(rename = "totalBatches")]
    pub total_batches: usize,
    #[serde(rename = "classifiedCount")]
    pub classified_count: usize,
    #[serde(rename = "exportedCount")]
    pub exported_count: usize,
    pub status: String,
    #[serde(rename = "mediaAvailable")]
    pub media_available: bool,
    pub message: String,
}

pub fn scan_single_dir_media(dir: &Path, collect_files: bool) -> (usize, Vec<String>, Option<String>, Option<String>) {
    let target_dir = if dir.join("DCIM").is_dir() {
        dir.join("DCIM")
    } else {
        dir.to_path_buf()
    };

    let mut count = 0;
    let mut files = Vec::new();
    let mut first_media: Option<String> = None;

    for entry in WalkDir::new(&target_dir).max_depth(8).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            let name = entry.file_name().to_string_lossy();
            if ClassifierService::is_valid_media(&name) && !name.starts_with(EXPORTED_PREFIX) {
                count += 1;
                if first_media.is_none() {
                    first_media = Some(entry.path().to_string_lossy().to_string());
                }
                if collect_files {
                    files.push(entry.path().to_string_lossy().to_string());
                }
            }
        }
    }

    if collect_files {
        files.sort();
    }

    let earliest_date = first_media.as_ref().and_then(|f| {
        if let Ok(metadata) = fs::metadata(f) {
            if let Ok(mtime) = metadata.modified() {
                let dt: DateTime<Utc> = mtime.into();
                return Some(dt.to_rfc3339());
            }
        }
        Some(Utc::now().to_rfc3339())
    });

    (count, files, earliest_date, first_media)
}

pub fn preview_import(source_path: &str) -> Result<ImportPreview, String> {
    let p = Path::new(source_path);
    if !p.exists() || !p.is_dir() {
        return Err(format!("Selected source folder does not exist or is not a directory: {}", source_path));
    }

    let folder_name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "SITE".to_string());
    let suggested_site = ClassifierService::read_site_name(p, &folder_name);

    // Check for subdirectories inside the selected folder (same logic as Working folder imports)
    let mut detected_batches: Vec<DetectedBatch> = Vec::new();

    if let Ok(entries) = fs::read_dir(p) {
        for entry in entries.flatten() {
            if let Ok(ft) = entry.file_type() {
                if ft.is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    // Ignore hidden and system/camera folders
                    if name.starts_with('.')
                        || name.eq_ignore_ascii_case("System Volume Information")
                        || name.eq_ignore_ascii_case("$RECYCLE.BIN")
                        || name.eq_ignore_ascii_case("RECYCLER")
                        || name.eq_ignore_ascii_case("LOST.DIR")
                        || name.eq_ignore_ascii_case("MISC")
                        || name.eq_ignore_ascii_case("DCIM")
                    {
                        continue;
                    }

                    let sub_path = entry.path();
                    let (sub_count, _, sub_earliest, sub_first) = scan_single_dir_media(&sub_path, false);
                    if sub_count > 0 {
                        let site = ClassifierService::read_site_name(&sub_path, &name);
                        detected_batches.push(DetectedBatch {
                            name,
                            path: sub_path.to_string_lossy().to_string(),
                            site,
                            count: sub_count,
                            first_media: sub_first,
                            earliest_date: sub_earliest,
                        });
                    }
                }
            }
        }
    }

    // If subfolders with media exist, treat as multi-batch (Working folder logic)
    if !detected_batches.is_empty() {
        detected_batches.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        let total_count: usize = detected_batches.iter().map(|b| b.count).sum();
        let first_media = detected_batches.first().and_then(|b| b.first_media.clone());
        let earliest_date = detected_batches.first().and_then(|b| b.earliest_date.clone());

        return Ok(ImportPreview {
            count: total_count,
            files: Vec::new(),
            earliest_date,
            first_media,
            is_multi_batch: true,
            detected_batches,
            suggested_site,
        });
    }

    // Otherwise, treat as a single batch (e.g. camera SD card with DCIM or single folder containing media)
    let (count, files, earliest_date, first_media) = scan_single_dir_media(p, true);

    Ok(ImportPreview {
        count,
        files,
        earliest_date,
        first_media,
        is_multi_batch: false,
        detected_batches: Vec::new(),
        suggested_site,
    })
}

pub fn execute_import(
    db: &Database,
    _settings: &AppSettings,
    source_path: &str,
    site_name: &str,
) -> Result<ImportResult, String> {
    let p = Path::new(source_path);
    if !p.exists() || !p.is_dir() {
        return Err(format!("Selected source folder does not exist or is not a directory: {}", source_path));
    }

    let preview = preview_import(source_path)?;
    if preview.count == 0 {
        return Err("Selected folder contains no images/video or all have been exported.".to_string());
    }

    if preview.is_multi_batch {
        let total_batches = preview.detected_batches.len();
        let mut total_imported_images = 0;
        let mut first_batch_name = String::new();
        let mut first_batch_site = String::new();
        let clean_site = site_name.trim();

        for b in &preview.detected_batches {
            let site = if !b.site.is_empty() {
                b.site.clone()
            } else if !clean_site.is_empty() {
                clean_site.to_string()
            } else {
                "SITE".to_string()
            };

            let db_batch = DbBatch {
                name: b.name.clone(),
                path: b.path.clone(),
                site: site.clone(),
                created_at: Local::now().to_rfc3339(),
                total_images: b.count,
            };
            db.add_batch(&db_batch).map_err(|e| e.to_string())?;

            total_imported_images += b.count;
            if first_batch_name.is_empty() {
                first_batch_name = b.name.clone();
                first_batch_site = site;
            }
        }

        Ok(ImportResult {
            name: first_batch_name.clone(),
            batch_name: first_batch_name,
            path: source_path.to_string(),
            site: first_batch_site,
            total_images: total_imported_images,
            total_batches,
            classified_count: 0,
            exported_count: 0,
            status: "unclassified".to_string(),
            media_available: true,
            message: format!("Successfully imported {} batches ({} media files total)", total_batches, total_imported_images),
        })
    } else {
        let clean_site = site_name.trim();
        let effective_site = if !clean_site.is_empty() {
            clean_site.to_string()
        } else if !preview.suggested_site.is_empty() {
            preview.suggested_site.clone()
        } else {
            return Err("Site Name is required".to_string());
        };

        let now = Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
        let batch_name = format!("{}-{}", effective_site, now);

        let db_batch = DbBatch {
            name: batch_name.clone(),
            path: source_path.to_string(),
            site: effective_site.clone(),
            created_at: Local::now().to_rfc3339(),
            total_images: preview.count,
        };

        db.add_batch(&db_batch).map_err(|e| e.to_string())?;

        Ok(ImportResult {
            name: batch_name.clone(),
            batch_name: batch_name,
            path: source_path.to_string(),
            site: effective_site,
            total_images: preview.count,
            total_batches: 1,
            classified_count: 0,
            exported_count: 0,
            status: "unclassified".to_string(),
            media_available: true,
            message: format!("Batch imported successfully with {} media files", preview.count),
        })
    }
}

pub fn extract_capture_date_from_file(path: &Path) -> Option<String> {
    if let Ok(mut file) = fs::File::open(path) {
        use std::io::Read;
        let mut buffer = [0u8; 65536];
        if let Ok(n) = file.read(&mut buffer) {
            let data = &buffer[..n];
            if let Some(date_str) = find_exif_datetime_ascii(data) {
                return Some(date_str);
            }
        }
    }
    // Fallback to file metadata modification time
    if let Ok(meta) = fs::metadata(path) {
        if let Ok(mtime) = meta.modified() {
            let dt: chrono::DateTime<Local> = mtime.into();
            return Some(dt.to_rfc3339());
        }
    }
    None
}

pub fn find_exif_datetime_ascii(data: &[u8]) -> Option<String> {
    if data.len() < 19 {
        return None;
    }
    for i in 0..=(data.len() - 19) {
        let chunk = &data[i..i + 19];
        if (chunk.starts_with(b"19") || chunk.starts_with(b"20"))
            && chunk[2].is_ascii_digit()
            && chunk[3].is_ascii_digit()
            && chunk[4] == b':'
            && chunk[5].is_ascii_digit()
            && chunk[6].is_ascii_digit()
            && chunk[7] == b':'
            && chunk[8].is_ascii_digit()
            && chunk[9].is_ascii_digit()
            && (chunk[10] == b' ' || chunk[10] == b'T')
            && chunk[11].is_ascii_digit()
            && chunk[12].is_ascii_digit()
            && chunk[13] == b':'
            && chunk[14].is_ascii_digit()
            && chunk[15].is_ascii_digit()
            && chunk[16] == b':'
            && chunk[17].is_ascii_digit()
            && chunk[18].is_ascii_digit()
        {
            if let Ok(s) = std::str::from_utf8(chunk) {
                let month: u32 = s[5..7].parse().unwrap_or(0);
                let day: u32 = s[8..10].parse().unwrap_or(0);
                let hour: u32 = s[11..13].parse().unwrap_or(99);
                let minute: u32 = s[14..16].parse().unwrap_or(99);
                let second: u32 = s[17..19].parse().unwrap_or(99);
                if (1..=12).contains(&month) && (1..=31).contains(&day) && hour < 24 && minute < 60 && second < 60 {
                    return Some(format!("{}-{}-{}T{:02}:{:02}:{:02}", &s[0..4], &s[5..7], &s[8..10], hour, minute, second));
                }
            }
        }
    }
    None
}

pub fn format_species_name(slug: &str) -> String {
    let cleaned = slug.replace('-', "_");
    let parts: Vec<&str> = cleaned.split('_').filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        return "Unclassified".to_string();
    }
    parts
        .into_iter()
        .map(|word| {
            let mut c = word.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str().to_lowercase().as_str(),
            }
        })
        .collect::<Vec<String>>()
        .join(" ")
}

pub fn import_csv_file(service: &ClassifierService, db: &mut Database, csv_path: &Path) -> Result<CsvImportResult, String> {
    if !csv_path.exists() {
        return Err(format!("CSV file not found: {}", csv_path.display()));
    }
    let content = fs::read_to_string(csv_path)
        .map_err(|e| format!("Failed to read CSV file: {}", e))?;
    let clean_content = content.strip_prefix("\u{FEFF}").unwrap_or(&content);
    let rows = parse_csv_content(clean_content);
    if rows.is_empty() {
        return Err("The selected CSV file is empty.".to_string());
    }

    let settings = service.load_settings();
    let working_dir = if !settings.working_folder.is_empty() {
        Some(PathBuf::from(&settings.working_folder))
    } else {
        None
    };
    let csv_parent = csv_path.parent().map(|p| p.to_path_buf());
    let mut dir_cache: HashMap<PathBuf, Vec<String>> = HashMap::new();

    // Header mapping
    let header_row = &rows[0];
    let mut col_map = HashMap::new();
    for (idx, name) in header_row.iter().enumerate() {
        let lower = name.trim().to_lowercase().replace(' ', "_").replace('-', "_");
        col_map.insert(lower, idx);
    }

    let find_col = |candidates: &[&str]| -> Option<usize> {
        for c in candidates {
            if let Some(&idx) = col_map.get(*c) {
                return Some(idx);
            }
        }
        None
    };

    // Find column indices with extensive synonym matching
    let col_species = find_col(&[
        "species", "species_name", "speciesname", "animal", "animal_name",
        "taxa", "taxon", "common_name", "commonname", "identification",
        "class", "label", "tag", "observation", "identity", "locally_defined_species"
    ]);
    let col_filepath = find_col(&["file_path", "filepath", "path", "full_path", "image_path"]);
    let col_filename = find_col(&[
        "filename", "file_name", "file", "image", "image_name",
        "photo", "photo_name", "media", "frame"
    ]).or_else(|| col_filepath);
    let col_batch = find_col(&[
        "batch", "batch_name", "folder", "folder_name", "directory",
        "subfolder", "deployment"
    ]);

    if col_species.is_none() && col_filename.is_none() {
        return Err("CSV file must contain at least a 'species' or 'filename' column.".to_string());
    }

    let col_site = find_col(&["site", "site_name", "location", "station", "camera", "camera_id", "cam", "deployment"]);
    let col_timestamp = find_col(&[
        "timestamp", "date_time", "datetime", "date/time", "date_and_time", "time_stamp",
        "capture_datetime", "capture_date_time", "date_time_captured", "datetime_captured",
        "observed_at", "captured_at"
    ]);
    let col_date = find_col(&[
        "date", "capture_date", "obs_date", "observation_date", "date_captured",
        "captured_date", "event_date", "photo_date", "record_date"
    ]);
    let col_time = find_col(&[
        "time", "capture_time", "obs_time", "observation_time", "time_captured",
        "captured_time", "event_time", "photo_time", "record_time"
    ]);
    let col_count = find_col(&["animal_count", "count", "quantity", "number", "animals", "num_animals", "individuals"]);
    let col_sequence = find_col(&["sequence", "seq", "order", "index"]);
    let col_comment = find_col(&["comment", "comments", "notes", "note", "description", "remarks"]);
    let col_in_frame = find_col(&["species_in_frame", "in_frame", "animals_in_frame", "total_in_frame"]);
    let col_sha = find_col(&["image_sha256", "sha256", "hash", "file_hash", "sha"]);

    let default_batch_name = csv_path.file_stem().and_then(|s| s.to_str()).unwrap_or("Imported_Batch");

    let mut parsed_records = Vec::new();
    for (row_idx, row) in rows.iter().skip(1).enumerate() {
        if row.is_empty() || row.iter().all(|f| f.trim().is_empty()) {
            continue;
        }
        let mut species = col_species.and_then(|i| row.get(i)).map(|s| s.trim()).unwrap_or("").to_string();
        let raw_filename = col_filename.and_then(|i| row.get(i)).map(|s| s.trim()).unwrap_or("");
        let raw_filepath = col_filepath.and_then(|i| row.get(i)).map(|s| s.trim()).unwrap_or("");
        if species.is_empty() && raw_filename.is_empty() && raw_filepath.is_empty() {
            continue;
        }

        let filename = Path::new(raw_filename)
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or(raw_filename);

        let raw_batch = col_batch.and_then(|i| row.get(i)).map(|s| s.trim()).unwrap_or("");
        let site = col_site.and_then(|i| row.get(i)).map(|s| s.trim()).unwrap_or("SITE");

        let batch = if !raw_batch.is_empty() && raw_batch != "Imported_Batch" {
            raw_batch.to_string()
        } else if let Some(parent) = Path::new(if !raw_filepath.is_empty() { raw_filepath } else { raw_filename }).parent() {
            let p_str = parent.file_name().and_then(|f| f.to_str()).unwrap_or("");
            if !p_str.is_empty() {
                p_str.to_string()
            } else if !site.is_empty() && site != "SITE" {
                site.to_string()
            } else {
                default_batch_name.to_string()
            }
        } else if !site.is_empty() && site != "SITE" {
            site.to_string()
        } else {
            default_batch_name.to_string()
        };

        // Locate the candidate directory on disk to find the real image file
        let mut candidate_folders: Vec<PathBuf> = Vec::new();
        if !raw_filepath.is_empty() {
            if let Some(p) = Path::new(raw_filepath).parent() {
                if p.exists() {
                    candidate_folders.push(p.to_path_buf());
                }
            }
        }
        if let Some(ref cp) = csv_parent {
            let b_dir = cp.join(&batch);
            if b_dir.exists() {
                candidate_folders.push(b_dir);
            }
            if !raw_batch.is_empty() {
                let rb_dir = cp.join(raw_batch);
                if rb_dir.exists() {
                    candidate_folders.push(rb_dir);
                }
            }
        }
        if let Some(ref wd) = working_dir {
            let b_dir = wd.join(&batch);
            if b_dir.exists() {
                candidate_folders.push(b_dir);
            }
            if !raw_batch.is_empty() {
                let rb_dir = wd.join(raw_batch);
                if rb_dir.exists() {
                    candidate_folders.push(rb_dir);
                }
            }
        }
        if let Ok(Some(existing_batch)) = db.get_batch(&batch) {
            let eb_p = PathBuf::from(&existing_batch.path);
            if eb_p.exists() {
                candidate_folders.push(eb_p);
            }
        }

        let mut matched_folder: Option<PathBuf> = None;
        let mut resolved_filename = filename.to_string();
        let mut resolved_path: Option<PathBuf> = None;

        for folder in candidate_folders {
            let entries = dir_cache.entry(folder.clone()).or_insert_with(|| {
                if let Ok(read) = fs::read_dir(&folder) {
                    read.flatten()
                        .filter_map(|e| e.file_name().into_string().ok())
                        .collect()
                } else {
                    Vec::new()
                }
            });

            let lower_fn = filename.to_lowercase();
            let stem_fn = Path::new(filename)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(filename)
                .to_lowercase();

            let mut found_entry: Option<String> = None;
            for entry in entries.iter() {
                let lower_entry = entry.to_lowercase();
                if lower_entry == lower_fn {
                    found_entry = Some(entry.clone());
                    break;
                }
                if lower_entry.ends_with(&format!("__{}", lower_fn)) || lower_entry.ends_with(&lower_fn) {
                    found_entry = Some(entry.clone());
                    break;
                }
                let entry_stem = Path::new(entry)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(entry)
                    .to_lowercase();
                if entry_stem == stem_fn || entry_stem.ends_with(&format!("__{}", stem_fn)) {
                    found_entry = Some(entry.clone());
                    break;
                }
            }

            if let Some(e) = found_entry {
                resolved_filename = e.clone();
                resolved_path = Some(folder.join(&e));
                matched_folder = Some(folder);
                break;
            } else if matched_folder.is_none() {
                matched_folder = Some(folder);
            }
        }

        // If species is empty or Unclassified, infer from filename
        if species.is_empty() || species.eq_ignore_ascii_case("unclassified") {
            if let Some(pos) = resolved_filename.find("__") {
                let slug = &resolved_filename[..pos];
                if !slug.is_empty() {
                    species = format_species_name(slug);
                }
            } else if let Some(pos) = raw_filename.find("__") {
                let slug = &raw_filename[..pos];
                if !slug.is_empty() {
                    species = format_species_name(slug);
                }
            }
        }
        if species.is_empty() {
            species = "Unclassified".to_string();
        }

        // Build timestamp: prefer explicit column, then combined date/time, then EXIF/mtime, then now
        let raw_ts = col_timestamp.and_then(|i| row.get(i)).map(|s| s.trim()).unwrap_or("");
        let d = col_date.and_then(|i| row.get(i)).map(|s| s.trim()).unwrap_or("");
        let t = col_time.and_then(|i| row.get(i)).map(|s| s.trim()).unwrap_or("");

        let mut candidate_ts = String::new();
        if !raw_ts.is_empty() {
            candidate_ts = raw_ts.to_string();
            // If raw_ts contains only date (no colon) and time column is available:
            if !candidate_ts.contains(':') && !t.is_empty() {
                candidate_ts = format!("{} {}", candidate_ts, t);
            } else if !candidate_ts.contains('-') && !candidate_ts.contains('/') && !d.is_empty() {
                // If raw_ts contains only time and date column is available:
                candidate_ts = format!("{} {}", d, candidate_ts);
            }
        } else if !d.is_empty() {
            candidate_ts = if !t.is_empty() { format!("{} {}", d, t) } else { d.to_string() };
        } else if let Some(ref p) = resolved_path {
            if let Some(date_extracted) = extract_capture_date_from_file(p) {
                candidate_ts = date_extracted;
            }
        }

        // Standardize timestamp into RFC 3339 so all platforms (Windows, macOS, Linux) interpret it identically
        let ts = if !candidate_ts.is_empty() {
            if let Some(parsed_dt) = crate::db::parse_to_local_datetime(&candidate_ts) {
                parsed_dt.to_rfc3339()
            } else {
                candidate_ts
            }
        } else {
            Local::now().to_rfc3339()
        };

        let count: i64 = col_count.and_then(|i| row.get(i)).and_then(|s| s.trim().parse().ok()).unwrap_or(1);
        let sequence: usize = col_sequence.and_then(|i| row.get(i)).and_then(|s| s.trim().parse().ok()).unwrap_or(row_idx + 1);
        let comment = col_comment.and_then(|i| row.get(i)).map(|s| s.trim()).unwrap_or("").to_string();
        let in_frame: usize = col_in_frame.and_then(|i| row.get(i)).and_then(|s| s.trim().parse().ok()).unwrap_or(1);
        let sha = col_sha.and_then(|i| row.get(i)).map(|s| s.trim()).unwrap_or("").to_string();

        parsed_records.push(CsvObservationInput {
            site: site.to_string(),
            timestamp: ts,
            species,
            count,
            sequence,
            comment,
            species_in_frame: in_frame,
            filename: resolved_filename,
            batch,
            sha256: sha,
            raw_filename: Some(filename.to_string()),
            batch_path: matched_folder.map(|p| p.to_string_lossy().to_string()),
        });
    }

    if parsed_records.is_empty() {
        return Err("No valid observation rows found in the CSV file.".to_string());
    }

    let (imported_count, batch_count) = db.import_csv_observations(&parsed_records)
        .map_err(|e| format!("Database error importing CSV records: {}", e))?;

    let unique_species: std::collections::HashSet<_> = parsed_records.iter()
        .map(|r| r.species.as_str())
        .filter(|s| *s != "Unclassified")
        .collect();

    let msg = format!(
        "Successfully imported {} observation record{} across {} batch{} ({} species identified).",
        imported_count,
        if imported_count == 1 { "" } else { "s" },
        batch_count,
        if batch_count == 1 { "" } else { "es" },
        unique_species.len()
    );

    Ok(CsvImportResult {
        imported_count,
        batch_count,
        file_path: csv_path.to_string_lossy().to_string(),
        message: msg,
    })
}

pub fn detect_delimiter(content: &str) -> char {
    let mut comma_count = 0;
    let mut tab_count = 0;
    let mut semi_count = 0;

    for line in content.lines().take(5) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut in_quotes = false;
        for c in trimmed.chars() {
            if c == '"' {
                in_quotes = !in_quotes;
            } else if !in_quotes {
                match c {
                    ',' => comma_count += 1,
                    '\t' => tab_count += 1,
                    ';' => semi_count += 1,
                    _ => {}
                }
            }
        }
    }

    if tab_count > comma_count && tab_count >= semi_count {
        '\t'
    } else if semi_count > comma_count && semi_count > tab_count {
        ';'
    } else {
        ','
    }
}

pub fn parse_csv_content(content: &str) -> Vec<Vec<String>> {
    let delimiter = detect_delimiter(content);
    let mut rows = Vec::new();
    let mut current_row = Vec::new();
    let mut current_field = String::new();
    let mut in_quotes = false;
    let mut chars = content.chars().peekable();

    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    current_field.push('"');
                } else {
                    in_quotes = false;
                }
            } else {
                current_field.push(c);
            }
        } else {
            if c == '"' {
                in_quotes = true;
            } else if c == delimiter {
                current_row.push(current_field.trim().to_string());
                current_field.clear();
            } else if c == '\r' {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                current_row.push(current_field.trim().to_string());
                current_field.clear();
                if !current_row.is_empty() && (current_row.len() > 1 || !current_row[0].is_empty()) {
                    rows.push(std::mem::take(&mut current_row));
                }
            } else if c == '\n' {
                current_row.push(current_field.trim().to_string());
                current_field.clear();
                if !current_row.is_empty() && (current_row.len() > 1 || !current_row[0].is_empty()) {
                    rows.push(std::mem::take(&mut current_row));
                }
            } else {
                current_field.push(c);
            }
        }
    }
    if !current_field.is_empty() || !current_row.is_empty() {
        current_row.push(current_field.trim().to_string());
        if !current_row.is_empty() && (current_row.len() > 1 || !current_row[0].is_empty()) {
            rows.push(current_row);
        }
    }
    rows
}
