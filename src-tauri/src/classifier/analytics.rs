use super::{AppSettings, ClassifierService, EXPORTED_PREFIX};
use crate::db::Database;
use chrono::{Datelike, Local, Timelike};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ObservationRecord {
    pub id: String,
    pub timestamp: String,
    #[serde(rename = "dateStr")]
    pub date_str: String,
    pub year: i32,
    pub month: u32,
    pub day: u32,
    #[serde(rename = "dayOfWeek")]
    pub day_of_week: u32,
    pub hour: u32,
    pub site: String,
    pub batch: String,
    pub species: String,
    pub count: i64,
    pub comment: String,
    pub filename: String,
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AnalyticsResponse {
    pub observations: Vec<ObservationRecord>,
    #[serde(rename = "isSample")]
    pub is_sample: bool,
}

pub fn get_analytics_data(
    _service: &ClassifierService,
    db: &Database,
    settings: &AppSettings,
) -> AnalyticsResponse {
    let mut observations = Vec::new();
    let mut seen_ids = HashSet::new();

    // 1. Database-backed observations
    if let Ok(db_obs) = db.get_all_observations() {
        for o in db_obs {
            if !seen_ids.contains(&o.id) {
                seen_ids.insert(o.id.clone());
                observations.push(o);
            }
        }
    }

    // 2. Legacy disk-based observations (working folder)
    if !settings.working_folder.trim().is_empty() {
        let working_dir = Path::new(&settings.working_folder);
        if working_dir.exists() {
            if let Ok(batch_entries) = fs::read_dir(working_dir) {
                for b in batch_entries.flatten() {
                    if b.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                        let batch_name = b.file_name().to_string_lossy().to_string();
                        let batch_path = b.path();
                        let site = ClassifierService::read_site_name(&batch_path, &batch_name);

                        if let Ok(files) = fs::read_dir(&batch_path) {
                            for f in files.flatten() {
                                let name = f.file_name().to_string_lossy().to_string();
                                if ClassifierService::is_valid_media(&name) {
                                    let stem = Path::new(&name)
                                        .file_stem()
                                        .unwrap_or_default()
                                        .to_string_lossy();
                                    let stripped =
                                        stem.strip_prefix(EXPORTED_PREFIX).unwrap_or(&stem);
                                    let meta_candidates = [
                                        batch_path.join(format!("{}.txt", stem)),
                                        batch_path.join(format!("{}.txt", stripped)),
                                    ];

                                    if let Some(meta_path) =
                                        meta_candidates.iter().find(|p| p.exists())
                                    {
                                        if let Ok(content) = fs::read_to_string(meta_path) {
                                            let now = ClassifierService::extract_capture_date_from_file(&f.path())
                                                .as_deref()
                                                .and_then(crate::db::parse_to_local_datetime)
                                                .unwrap_or_else(Local::now);
                                            for line in content.lines() {
                                                let parts: Vec<&str> = line.split('\t').collect();
                                                if parts.len() >= 2 {
                                                    let sp = parts[0].trim().to_string();
                                                    let cnt: i64 =
                                                        parts[1].trim().parse().unwrap_or(1);
                                                    let comment = parts
                                                        .get(2)
                                                        .map(|c| c.trim().to_string())
                                                        .unwrap_or_default();
                                                    let id =
                                                        format!("{}_{}_{}", batch_name, name, sp);

                                                    if !seen_ids.contains(&id) {
                                                        seen_ids.insert(id.clone());
                                                        observations.push(ObservationRecord {
                                                            id,
                                                            timestamp: now.to_rfc3339(),
                                                            date_str: now
                                                                .format("%Y-%m-%d")
                                                                .to_string(),
                                                            year: now.year(),
                                                            month: now.month(),
                                                            day: now.day(),
                                                            day_of_week: now
                                                                .weekday()
                                                                .num_days_from_sunday(),
                                                            hour: now.hour(),
                                                            site: site.clone(),
                                                            batch: batch_name.clone(),
                                                            species: sp,
                                                            count: cnt,
                                                            comment,
                                                            filename: name.clone(),
                                                            source: "working".to_string(),
                                                        });
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    AnalyticsResponse {
        observations,
        is_sample: false,
    }
}
