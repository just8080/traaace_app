use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedMediaItem {
    pub id: String,
    pub path: String,
    pub filename: String,
    pub timestamp: String,
    pub file_size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickExportRecord {
    pub filename: String,
    pub path: String,
    pub species: String,
    pub timestamp: String,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default)]
    pub confidence: Option<String>,
    #[serde(default)]
    pub site: Option<String>,
    #[serde(default)]
    pub count: Option<i64>,
    #[serde(default)]
    pub batch: Option<String>,
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickExportRequest {
    pub records: Vec<QuickExportRecord>,
    pub destination_path: String,
    pub export_xlsx: bool,
    pub export_csv: bool,
    pub export_txt: bool,
    pub export_json: bool,
    pub image_action: String, // "none" | "copy" | "move"
    pub organize_by_species: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickExportResult {
    pub success: bool,
    pub files_exported: usize,
    pub destination: String,
    pub summary: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExportRecord {
    pub site: String,
    pub timestamp: String,
    pub date: String,
    pub time: String,
    pub species: String,
    #[serde(rename = "animalCount")]
    pub animal_count: i64,
    pub sequence: usize,
    pub comment: String,
    #[serde(rename = "speciesInFrame")]
    pub species_in_frame: usize,
    pub filename: String,
    /// "Photo" or "Video", worked out from the file extension.
    #[serde(rename = "mediaType")]
    pub media_type: String,
    pub batch: String,
    pub sha256: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExportResult {
    #[serde(rename = "exportedFileCount")]
    pub exported_file_count: usize,
    #[serde(rename = "totalRecords")]
    pub total_records: usize,
    #[serde(rename = "csvPath")]
    pub csv_path: String,
    #[serde(rename = "xlsxPath")]
    pub xlsx_path: String,
    #[serde(rename = "jsonPath")]
    pub json_path: String,
    #[serde(rename = "txtPath", skip_serializing_if = "Option::is_none")]
    pub txt_path: Option<String>,
    #[serde(rename = "imagesPath", skip_serializing_if = "Option::is_none")]
    pub images_path: Option<String>,
    #[serde(rename = "merged", default)]
    pub merged: bool,
    #[serde(rename = "batchRecords", default)]
    pub batch_records: usize,
}

