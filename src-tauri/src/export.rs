use crate::classifier::{AppSettings, ClassifierService, EXPORTED_PREFIX};
use crate::db::Database;
use crate::models::{ExportRecord, ExportResult, QuickExportRequest, QuickExportResult};
use chrono::{DateTime, Local};
use rust_xlsxwriter::{Color, Format, FormatBorder, Workbook};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

/// "Video" for video files, otherwise "Photo" (the export's Media Type column).
pub fn media_type_for(file_name: &str) -> &'static str {
    if crate::classifier::ClassifierService::is_video(file_name) {
        "Video"
    } else {
        "Photo"
    }
}

pub fn sanitize_folder_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            _ => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "Unknown".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn escape_csv(val: &str) -> String {
    if val.contains(',') || val.contains('"') || val.contains('\n') || val.contains('\r') {
        format!("\"{}\"", val.replace('"', "\"\""))
    } else {
        val.to_string()
    }
}

pub fn write_csv_records<P: AsRef<Path>>(path: P, records: &[ExportRecord]) -> Result<(), String> {
    use std::io::Write;
    let mut file = fs::File::create(path).map_err(|e| e.to_string())?;
    file.write_all(b"\xEF\xBB\xBF").map_err(|e| e.to_string())?;
    writeln!(file, "folder,file,media_type,site_name,date,time,species,animal_count,comment").map_err(|e| e.to_string())?;
    for r in records {
        writeln!(
            file,
            "{},{},{},{},{},{},{},{},{}",
            escape_csv(&r.batch),
            escape_csv(&r.filename),
            escape_csv(&r.media_type),
            escape_csv(&r.site),
            escape_csv(&r.date),
            escape_csv(&r.time),
            escape_csv(&r.species),
            r.animal_count,
            escape_csv(&r.comment),
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn write_json_records<P: AsRef<Path>>(path: P, records: &[ExportRecord]) -> Result<(), String> {
    let json_str = serde_json::to_string_pretty(records).map_err(|e| e.to_string())?;
    fs::write(path, json_str).map_err(|e| e.to_string())
}

pub fn write_txt_records<P: AsRef<Path>>(path: P, records: &[ExportRecord]) -> Result<(), String> {
    use std::io::Write;
    let mut file = fs::File::create(path).map_err(|e| e.to_string())?;
    writeln!(file, "=========================================================================================").map_err(|e| e.to_string())?;
    writeln!(file, "TRAAACE Observation Export Manifest").map_err(|e| e.to_string())?;
    writeln!(file, "Generated: {}", Local::now().format("%Y-%m-%d %H:%M:%S")).map_err(|e| e.to_string())?;
    writeln!(file, "Total Records: {}", records.len()).map_err(|e| e.to_string())?;
    writeln!(file, "=========================================================================================\n").map_err(|e| e.to_string())?;

    let mut counts: HashMap<String, usize> = HashMap::new();
    for r in records {
        let sp = if r.species.trim().is_empty() { "Unclassified" } else { &r.species };
        *counts.entry(sp.to_string()).or_insert(0) += 1;
    }
    writeln!(file, "SPECIES BREAKDOWN:").map_err(|e| e.to_string())?;
    writeln!(file, "{:-<55}", "").map_err(|e| e.to_string())?;
    let mut sorted_counts: Vec<_> = counts.into_iter().collect();
    sorted_counts.sort_by(|a, b| b.1.cmp(&a.1));
    for (sp, cnt) in sorted_counts {
        writeln!(file, "  • {:<30} : {:>5} observations", sp, cnt).map_err(|e| e.to_string())?;
    }
    writeln!(file, "{:-<55}\n", "").map_err(|e| e.to_string())?;

    writeln!(file, "OBSERVATIONS:").map_err(|e| e.to_string())?;
    writeln!(file, "{:-<120}", "").map_err(|e| e.to_string())?;
    writeln!(file, "{:<18} {:<28} {:<7} {:<16} {:<12} {:<10} {:<18} {:<6} {}", "FOLDER", "FILE", "MEDIA", "SITE NAME", "DATE", "TIME", "SPECIES", "COUNT", "COMMENT").map_err(|e| e.to_string())?;
    writeln!(file, "{:-<120}", "").map_err(|e| e.to_string())?;
    for r in records {
        writeln!(file, "{:<18} {:<28} {:<7} {:<16} {:<12} {:<10} {:<18} {:<6} {}", r.batch, r.filename, r.media_type, r.site, r.date, r.time, r.species, r.animal_count, r.comment).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn write_xlsx_records<P: AsRef<Path>>(path: P, records: &[ExportRecord]) -> Result<(), String> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    let _ = worksheet.set_name("Classifications");

    let header_format = Format::new()
        .set_bold()
        .set_font_color(Color::RGB(0xFFFFFF))
        .set_background_color(Color::RGB(0x2D5A43))
        .set_border(FormatBorder::Thin)
        .set_border_color(Color::RGB(0xCCCCCC));

    let cell_format = Format::new()
        .set_border(FormatBorder::Thin)
        .set_border_color(Color::RGB(0xE0E0E0));

    let num_format = Format::new()
        .set_border(FormatBorder::Thin)
        .set_border_color(Color::RGB(0xE0E0E0));

    let headers = [
        "Folder",
        "File",
        "Media Type",
        "Site Name",
        "Date",
        "Time",
        "Species",
        "Animal Count",
        "Comment",
    ];

    for (col, header) in headers.iter().enumerate() {
        worksheet.write_string_with_format(0, col as u16, *header, &header_format)
            .map_err(|e| e.to_string())?;
    }

    for (row_idx, r) in records.iter().enumerate() {
        let row = (row_idx + 1) as u32;
        worksheet.write_string_with_format(row, 0, &r.batch, &cell_format).map_err(|e| e.to_string())?;
        worksheet.write_string_with_format(row, 1, &r.filename, &cell_format).map_err(|e| e.to_string())?;
        worksheet.write_string_with_format(row, 2, &r.media_type, &cell_format).map_err(|e| e.to_string())?;
        worksheet.write_string_with_format(row, 3, &r.site, &cell_format).map_err(|e| e.to_string())?;
        worksheet.write_string_with_format(row, 4, &r.date, &cell_format).map_err(|e| e.to_string())?;
        worksheet.write_string_with_format(row, 5, &r.time, &cell_format).map_err(|e| e.to_string())?;
        worksheet.write_string_with_format(row, 6, &r.species, &cell_format).map_err(|e| e.to_string())?;
        worksheet.write_number_with_format(row, 7, r.animal_count as f64, &num_format).map_err(|e| e.to_string())?;
        worksheet.write_string_with_format(row, 8, &r.comment, &cell_format).map_err(|e| e.to_string())?;
    }

    let _ = worksheet.set_column_width(0, 20);
    let _ = worksheet.set_column_width(1, 28);
    let _ = worksheet.set_column_width(2, 13);
    let _ = worksheet.set_column_width(3, 18);
    let _ = worksheet.set_column_width(4, 14);
    let _ = worksheet.set_column_width(5, 12);
    let _ = worksheet.set_column_width(6, 22);
    let _ = worksheet.set_column_width(7, 14);
    let _ = worksheet.set_column_width(8, 30);

    workbook.save(path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn copy_classified_image_with_collision_handling(
    src_path: &Path,
    species_dir: &Path,
    batch_name: &str,
    file_name: &str,
) {
    let _ = fs::create_dir_all(species_dir);
    let dest_file = species_dir.join(file_name);

    if !dest_file.exists() || dest_file == src_path {
        let _ = fs::copy(src_path, dest_file);
        return;
    }

    let is_same_size = fs::metadata(&dest_file)
        .and_then(|m_dest| fs::metadata(src_path).map(|m_src| m_dest.len() == m_src.len()))
        .unwrap_or(false);

    if is_same_size {
        let _ = fs::copy(src_path, dest_file);
        return;
    }

    let clean_bn = batch_name.replace('/', "-").replace('\\', "-");
    let collision_dest = species_dir.join(format!("{}_{}", clean_bn, file_name));
    let _ = fs::copy(src_path, collision_dest);
}

pub fn export_combined_batches_with_full_options(
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
    if batch_names.is_empty() {
        return Err("No batches selected for export.".to_string());
    }

    let is_data_only = export_type.map(|t| t == "data_only").unwrap_or(false)
        || image_structure.map(|s| s == "none").unwrap_or(false);

    let export_root = if let Some(dest) = destination_path {
        let trimmed = dest.trim();
        if !trimmed.is_empty() {
            PathBuf::from(trimmed)
        } else {
            PathBuf::from(&settings.export_folder)
        }
    } else {
        PathBuf::from(&settings.export_folder)
    };

    if !export_root.exists() {
        fs::create_dir_all(&export_root).map_err(|e| e.to_string())?;
    }

    let images_root = export_root.join("Images");
    if !is_data_only {
        fs::create_dir_all(&images_root).map_err(|e| e.to_string())?;
    }

    let mut all_records = Vec::new();
    let mut total_exported_files = 0;

    for batch_name in batch_names {
        if let Ok(Some(db_batch)) = db.get_batch(batch_name) {
            let batch_dir = PathBuf::from(&db_batch.path);
            let media_available = batch_dir.exists();

            if !is_data_only && !media_available {
                return Err(format!(
                    "Cannot export full package with images for batch '{}' because original image folder is offline or deleted. Please choose 'Data Only (CSV, Excel, JSON)' export.",
                    batch_name
                ));
            }

            if let Ok(classifications_map) = db.get_classifications_map_for_batch(batch_name) {
                if !classifications_map.is_empty() {
                    for (file_name, items) in &classifications_map {
                        let full_media_path = batch_dir.join(file_name);
                        let (ts, date_str, time_str) = if let Ok(meta) = fs::metadata(&full_media_path) {
                            if let Ok(mtime) = meta.modified() {
                                let dt: DateTime<Local> = mtime.into();
                                (
                                    dt.format("%Y-%m-%d %H:%M:%S").to_string(),
                                    dt.format("%Y-%m-%d").to_string(),
                                    dt.format("%H:%M:%S").to_string(),
                                )
                            } else {
                                let now = Local::now();
                                (
                                    now.format("%Y-%m-%d %H:%M:%S").to_string(),
                                    now.format("%Y-%m-%d").to_string(),
                                    now.format("%H:%M:%S").to_string(),
                                )
                            }
                        } else {
                            let now = Local::now();
                            (
                                now.format("%Y-%m-%d %H:%M:%S").to_string(),
                                now.format("%Y-%m-%d").to_string(),
                                now.format("%H:%M:%S").to_string(),
                            )
                        };

                        let mut copied_species = HashSet::new();

                        for (seq, item) in items.iter().enumerate() {
                            all_records.push(ExportRecord {
                                site: db_batch.site.clone(),
                                timestamp: ts.clone(),
                                date: date_str.clone(),
                                time: time_str.clone(),
                                species: item.species.clone(),
                                animal_count: item.count,
                                sequence: seq,
                                comment: item.comment.clone(),
                                species_in_frame: items.len(),
                                filename: file_name.clone(),
                                media_type: media_type_for(&file_name).to_string(),
                                batch: batch_name.to_string(),
                                sha256: item.sha256.clone().unwrap_or_default(),
                            });

                            if !is_data_only && media_available && full_media_path.exists() {
                                let clean_species = sanitize_folder_name(&item.species);
                                if copied_species.insert(clean_species.clone()) {
                                    let target_dir = if image_structure == Some("original_folders") || image_structure == Some("as_imported") {
                                        images_root.join(sanitize_folder_name(batch_name))
                                    } else {
                                        images_root.join(&clean_species)
                                    };
                                    copy_classified_image_with_collision_handling(
                                        &full_media_path,
                                        &target_dir,
                                        batch_name,
                                        file_name,
                                    );
                                }
                            }
                        }

                        let _ = db.mark_media_exported(batch_name, &file_name);
                        total_exported_files += 1;
                    }
                }
            }
        } else if !settings.working_folder.trim().is_empty() {
            let working_dir = Path::new(&settings.working_folder);
            let batch_dir = working_dir.join(batch_name);
            if batch_dir.exists() {
                let site_name = ClassifierService::read_site_name(&batch_dir, batch_name);
                let mut batch_records = Vec::new();

                if let Ok(entries) = fs::read_dir(&batch_dir) {
                    for entry in entries.flatten() {
                        let file_name = entry.file_name().to_string_lossy().to_string();
                        if ClassifierService::is_valid_media(&file_name) && !file_name.starts_with(EXPORTED_PREFIX) {
                            let stem = Path::new(&file_name).file_stem().unwrap_or_default().to_string_lossy();
                            let meta_src = batch_dir.join(format!("{}.txt", stem));

                            if meta_src.exists() {
                                if let Ok(meta_content) = fs::read_to_string(&meta_src) {
                                    let lines: Vec<&str> = meta_content.lines().filter(|l| !l.trim().is_empty()).collect();
                                    let (ts, date_str, time_str) = if let Ok(meta) = entry.metadata() {
                                        if let Ok(mtime) = meta.modified() {
                                            let dt: DateTime<Local> = mtime.into();
                                            (dt.format("%Y-%m-%d %H:%M:%S").to_string(), dt.format("%Y-%m-%d").to_string(), dt.format("%H:%M:%S").to_string())
                                        } else {
                                            let now = Local::now();
                                            (now.format("%Y-%m-%d %H:%M:%S").to_string(), now.format("%Y-%m-%d").to_string(), now.format("%H:%M:%S").to_string())
                                        }
                                    } else {
                                        let now = Local::now();
                                        (now.format("%Y-%m-%d %H:%M:%S").to_string(), now.format("%Y-%m-%d").to_string(), now.format("%H:%M:%S").to_string())
                                    };

                                    let mut copied_species = HashSet::new();

                                    for (seq, line) in lines.iter().enumerate() {
                                        let parts: Vec<&str> = line.split('\t').collect();
                                        let species = parts.get(0).unwrap_or(&"Unknown").trim().to_string();
                                        let count = parts.get(1).unwrap_or(&"1").trim().parse().unwrap_or(1);
                                        let comment = parts.get(2).map(|c| c.trim().to_string()).unwrap_or_default();
                                        let sha = parts.get(3).map(|s| s.trim().to_string()).unwrap_or_default();

                                        let rec = ExportRecord {
                                            site: site_name.clone(),
                                            timestamp: ts.clone(),
                                            date: date_str.clone(),
                                            time: time_str.clone(),
                                            species: species.clone(),
                                            animal_count: count,
                                            sequence: seq,
                                            comment,
                                            species_in_frame: lines.len(),
                                            filename: file_name.clone(),
                                            media_type: media_type_for(&file_name).to_string(),
                                            batch: batch_name.to_string(),
                                            sha256: sha,
                                        };
                                        batch_records.push(rec);

                                        if !is_data_only {
                                            let clean_species = sanitize_folder_name(&species);
                                            if copied_species.insert(clean_species.clone()) && entry.path().exists() {
                                                let species_dir = images_root.join(&clean_species);
                                                copy_classified_image_with_collision_handling(&entry.path(), &species_dir, batch_name, &file_name);
                                            }
                                        }
                                    }

                                    if !is_data_only {
                                        let new_media_name = batch_dir.join(format!("{}{}", EXPORTED_PREFIX, file_name));
                                        let new_meta_name = batch_dir.join(format!("{}.txt", format!("{}{}", EXPORTED_PREFIX, stem)));
                                        let _ = fs::rename(entry.path(), new_media_name);
                                        if meta_src.exists() {
                                            let _ = fs::rename(meta_src, new_meta_name);
                                        }
                                    }

                                    total_exported_files += 1;
                                }
                            }
                        }
                    }

                    all_records.extend(batch_records);
                }
            }
        }
    }

    if all_records.is_empty() {
        return Err("No classified files found in the selected batch(es) to export. Classify at least one image/video first.".to_string());
    }

    let is_preset_destination = destination_path
        .map(|dest| dest.trim().is_empty() || dest.trim() == settings.export_folder.trim())
        .unwrap_or(true);
    let should_merge = merge_data.unwrap_or(is_preset_destination);

    let (batch_csv, batch_xlsx, batch_json, batch_txt, total_records, batch_records, is_merged) = if should_merge {
        let master_json = export_root.join("traaace_export.json");
        let mut master_records: Vec<ExportRecord> = Vec::new();

        if master_json.exists() {
            if let Ok(content) = fs::read_to_string(&master_json) {
                if let Ok(records) = serde_json::from_str::<Vec<ExportRecord>>(&content) {
                    master_records = records;
                }
            }
        }

        for new_rec in &all_records {
            master_records.retain(|existing| {
                !(existing.batch == new_rec.batch
                    && existing.filename == new_rec.filename
                    && existing.sequence == new_rec.sequence)
            });
        }

        let current_batch_records_count = all_records.len();
        master_records.extend(all_records);

        master_records.sort_by(|a, b| {
            a.timestamp
                .cmp(&b.timestamp)
                .then_with(|| a.batch.cmp(&b.batch))
                .then_with(|| a.filename.cmp(&b.filename))
                .then_with(|| a.sequence.cmp(&b.sequence))
        });

        let do_csv = export_csv.unwrap_or(true);
        let do_xlsx = export_xlsx.unwrap_or(true);
        let do_json = export_json.unwrap_or(true);
        let do_txt = export_txt.unwrap_or(false);

        let master_csv = export_root.join("traaace_export.csv");
        let master_xlsx = export_root.join("traaace_export.xlsx");
        let master_json = export_root.join("traaace_export.json");
        let master_txt = export_root.join("traaace_export.txt");

        if do_csv {
            write_csv_records(&master_csv, &master_records)?;
        }
        if do_xlsx {
            write_xlsx_records(&master_xlsx, &master_records)?;
        }
        if do_json {
            write_json_records(&master_json, &master_records)?;
        }
        if do_txt {
            write_txt_records(&master_txt, &master_records)?;
        }

        (
            master_csv,
            master_xlsx,
            master_json,
            if do_txt { Some(master_txt) } else { None },
            master_records.len(),
            current_batch_records_count,
            true,
        )
    } else {
        let export_filename = if batch_names.len() == 1 {
            batch_names[0].replace('/', "-").replace('\\', "-")
        } else {
            let now = Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
            format!("Combined_Export_{}", now)
        };

        let do_csv = export_csv.unwrap_or(true);
        let do_xlsx = export_xlsx.unwrap_or(true);
        let do_json = export_json.unwrap_or(true);
        let do_txt = export_txt.unwrap_or(false);

        let batch_csv = export_root.join(format!("{}.csv", export_filename));
        let batch_xlsx = export_root.join(format!("{}.xlsx", export_filename));
        let batch_json = export_root.join(format!("{}.json", export_filename));
        let batch_txt = export_root.join(format!("{}.txt", export_filename));

        if do_csv {
            write_csv_records(&batch_csv, &all_records)?;
        }
        if do_xlsx {
            write_xlsx_records(&batch_xlsx, &all_records)?;
        }
        if do_json {
            write_json_records(&batch_json, &all_records)?;
        }
        if do_txt {
            write_txt_records(&batch_txt, &all_records)?;
        }

        let record_count = all_records.len();
        (batch_csv, batch_xlsx, batch_json, if do_txt { Some(batch_txt) } else { None }, record_count, record_count, false)
    };

    Ok(ExportResult {
        exported_file_count: total_exported_files,
        total_records,
        csv_path: batch_csv.to_string_lossy().to_string(),
        xlsx_path: batch_xlsx.to_string_lossy().to_string(),
        json_path: batch_json.to_string_lossy().to_string(),
        txt_path: batch_txt.map(|p| p.to_string_lossy().to_string()),
        images_path: if !is_data_only {
            Some(images_root.to_string_lossy().to_string())
        } else {
            None
        },
        merged: is_merged,
        batch_records,
    })
}

pub fn execute_quick_export(req: QuickExportRequest) -> Result<QuickExportResult, String> {
    let dest_dir = Path::new(&req.destination_path);
    if !dest_dir.exists() {
        fs::create_dir_all(dest_dir).map_err(|e| format!("Failed to create destination folder: {}", e))?;
    }

    let timestamp_str = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let base_name = format!("traaace_export_{}", timestamp_str);

    let export_records: Vec<ExportRecord> = req
        .records
        .iter()
        .map(|r| {
            let site = r.site.as_deref().unwrap_or("Default").trim();
            let site = if site.is_empty() { "Default".to_string() } else { site.to_string() };
            let batch = r.batch.as_deref().unwrap_or(&site).trim();
            let batch = if batch.is_empty() { site.clone() } else { batch.to_string() };

            let (ts, date_str, time_str) = if let Some(local) = crate::db::parse_to_local_datetime(&r.timestamp) {
                (
                    local.format("%Y-%m-%d %H:%M:%S").to_string(),
                    local.format("%Y-%m-%d").to_string(),
                    local.format("%H:%M:%S").to_string(),
                )
            } else {
                (r.timestamp.clone(), "".to_string(), "".to_string())
            };

            ExportRecord {
                site,
                timestamp: ts,
                date: date_str,
                time: time_str,
                species: r.species.clone(),
                animal_count: r.count.unwrap_or(1),
                sequence: 0,
                comment: r.comment.clone().unwrap_or_default(),
                species_in_frame: 1,
                filename: r.filename.clone(),
                media_type: media_type_for(&r.filename).to_string(),
                batch,
                sha256: r.sha256.clone().unwrap_or_default(),
            }
        })
        .collect();

    if req.export_xlsx {
        let xlsx_path = dest_dir.join(format!("{}.xlsx", base_name));
        write_xlsx_records(&xlsx_path, &export_records)?;
    }

    if req.export_csv {
        let csv_path = dest_dir.join(format!("{}.csv", base_name));
        write_csv_records(&csv_path, &export_records)?;
    }

    if req.export_txt {
        let txt_path = dest_dir.join(format!("{}.txt", base_name));
        write_txt_records(&txt_path, &export_records)?;
    }

    if req.export_json {
        let json_path = dest_dir.join(format!("{}.json", base_name));
        write_json_records(&json_path, &export_records)?;
    }

    let mut files_processed = 0;
    if req.image_action == "copy" || req.image_action == "move" {
        for record in &req.records {
            let src_file = Path::new(&record.path);
            if !src_file.exists() {
                continue;
            }

            let target_folder: PathBuf = if req.organize_by_species {
                let safe_species = if record.species.trim().is_empty() {
                    "Unclassified".to_string()
                } else {
                    sanitize_folder_name(&record.species)
                };
                dest_dir.join("images").join(safe_species)
            } else {
                dest_dir.join("images")
            };

            fs::create_dir_all(&target_folder).map_err(|e| format!("Failed to create image folder: {}", e))?;

            if req.image_action == "move" {
                let dest_file = target_folder.join(&record.filename);
                if let Err(_e) = fs::rename(src_file, &dest_file) {
                    fs::copy(src_file, &dest_file).map_err(|err| format!("Failed to move file {}: {}", record.filename, err))?;
                    let _ = fs::remove_file(src_file);
                }
            } else {
                copy_classified_image_with_collision_handling(
                    src_file,
                    &target_folder,
                    record.batch.as_deref().unwrap_or("Quick"),
                    &record.filename,
                );
            }
            files_processed += 1;
        }
    }

    let mut counts: HashMap<String, usize> = HashMap::new();
    for r in &export_records {
        let sp = if r.species.trim().is_empty() { "Unclassified" } else { &r.species };
        *counts.entry(sp.to_string()).or_insert(0) += 1;
    }

    let summary_items: Vec<String> = counts.iter().map(|(k, v)| format!("{}: {}", k, v)).collect();
    let summary_str = format!("{} total items ({}).", req.records.len(), summary_items.join(", "));

    Ok(QuickExportResult {
        success: true,
        files_exported: if req.image_action != "none" { files_processed } else { req.records.len() },
        destination: req.destination_path,
        summary: summary_str,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::QuickExportRecord;

    #[test]
    fn test_media_type_follows_the_extension() {
        for video in ["a.mp4", "A.MP4", "b.mov", "c.avi", "dir/d.Mov"] {
            assert_eq!(media_type_for(video), "Video", "{video}");
        }
        for photo in ["a.jpg", "b.JPEG", "c.png", "d", "mp4", "e.mp4.jpg"] {
            assert_eq!(media_type_for(photo), "Photo", "{photo}");
        }
    }

    #[test]
    fn test_quick_export_produces_identical_format_to_batch() {
        let temp_dir = std::env::temp_dir().join(format!("traaace_quick_export_test_{}", Local::now().timestamp_nanos_opt().unwrap_or(12345)));
        let export_dir = temp_dir.join("export");
        fs::create_dir_all(&export_dir).unwrap();

        let req = QuickExportRequest {
            records: vec![
                QuickExportRecord {
                    filename: "photo_001.jpg".to_string(),
                    path: "/fake/path/photo_001.jpg".to_string(),
                    species: "Possum".to_string(),
                    timestamp: "2026-10-17T13:42:41+13:00".to_string(),
                    comment: Some("False trigger".to_string()),
                    confidence: Some("high".to_string()),
                    site: Some("site_ENA".to_string()),
                    count: Some(2),
                    batch: Some("site_ENA".to_string()),
                    sha256: None,
                },
                QuickExportRecord {
                    filename: "photo_002.jpg".to_string(),
                    path: "/fake/path/photo_002.jpg".to_string(),
                    species: "Fantail".to_string(),
                    timestamp: "2026-10-17 14:00:00".to_string(),
                    comment: None,
                    confidence: None,
                    site: Some("site_ENA".to_string()),
                    count: Some(1),
                    batch: Some("site_ENA".to_string()),
                    sha256: None,
                },
                QuickExportRecord {
                    filename: "clip_003.MP4".to_string(),
                    path: "/fake/path/clip_003.MP4".to_string(),
                    species: "Stoat".to_string(),
                    timestamp: "2026-10-17 14:05:00".to_string(),
                    comment: None,
                    confidence: None,
                    site: Some("site_ENA".to_string()),
                    count: Some(1),
                    batch: Some("site_ENA".to_string()),
                    sha256: None,
                },
            ],
            destination_path: export_dir.to_string_lossy().to_string(),
            export_xlsx: true,
            export_csv: true,
            export_txt: true,
            export_json: true,
            image_action: "none".to_string(),
            organize_by_species: false,
        };

        let result = execute_quick_export(req).expect("Quick export should succeed");
        assert!(result.success);
        assert_eq!(result.files_exported, 3);

        let mut csv_found = false;
        let mut txt_found = false;
        let mut json_found = false;
        let mut xlsx_found = false;

        for entry in fs::read_dir(&export_dir).unwrap().flatten() {
            let path = entry.path();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            match ext {
                "csv" => {
                    csv_found = true;
                    let content = fs::read_to_string(&path).unwrap();
                    assert!(content.contains("folder,file,media_type,site_name,date,time,species,animal_count,comment"));
                    // Media Type sits right after File and follows the extension.
                    assert!(content.contains("site_ENA,photo_001.jpg,Photo,site_ENA,"));
                    assert!(content.contains("site_ENA,clip_003.MP4,Video,site_ENA,"));
                    assert!(content.contains("site_ENA"));
                    assert!(content.contains("Possum"));
                    assert!(content.contains("photo_001.jpg"));
                    assert!(content.contains("False trigger"));
                }
                "txt" => {
                    txt_found = true;
                    let content = fs::read_to_string(&path).unwrap();
                    assert!(content.contains("SPECIES BREAKDOWN:"));
                    assert!(content.contains("OBSERVATIONS:"));
                    assert!(content.contains("MEDIA"));
                    assert!(content.contains("Possum"));
                }
                "json" => {
                    json_found = true;
                    let content = fs::read_to_string(&path).unwrap();
                    let parsed: Vec<ExportRecord> = serde_json::from_str(&content).unwrap();
                    assert_eq!(parsed.len(), 3);
                    assert_eq!(parsed[0].media_type, "Photo");
                    assert_eq!(parsed[2].media_type, "Video");
                    assert!(content.contains("\"mediaType\": \"Video\""));
                    assert_eq!(parsed[0].species, "Possum");
                    assert_eq!(parsed[0].animal_count, 2);
                    assert_eq!(parsed[0].sequence, 0);
                    assert_eq!(parsed[0].species_in_frame, 1);
                }
                "xlsx" => {
                    xlsx_found = true;
                    // An .xlsx is a zip; the header and values live in the shared strings table.
                    let mut zip = zip::ZipArchive::new(fs::File::open(&path).unwrap()).unwrap();
                    let mut strings = String::new();
                    std::io::Read::read_to_string(&mut zip.by_name("xl/sharedStrings.xml").unwrap(), &mut strings).unwrap();
                    assert!(strings.contains("Media Type"));
                    assert!(strings.contains("Video") && strings.contains("Photo"));
                    // Header order: File is immediately followed by Media Type, then Site Name.
                    let file_at = strings.find(">File<").unwrap();
                    let media_at = strings.find(">Media Type<").unwrap();
                    let site_at = strings.find(">Site Name<").unwrap();
                    assert!(file_at < media_at && media_at < site_at);
                }
                _ => {}
            }
        }

        assert!(csv_found);
        assert!(txt_found);
        assert!(json_found);
        assert!(xlsx_found);

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
