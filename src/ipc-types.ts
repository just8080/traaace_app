/**
 * Types for data crossing the Tauri IPC boundary.
 *
 * These mirror the serde-serialized Rust structs, all of which use camelCase on the wire:
 *   - classifier/mod.rs   (AppSettings, UpdateSettings, BatchSummary, MediaItem, ...)
 *   - classifier/analytics.rs, classifier/importer.rs
 *   - models.rs           (ScannedMediaItem, QuickExport*, ExportResult)
 *   - db.rs               (KeymapItem)
 *
 * When a Rust struct changes, change the matching type here. Components should reach the
 * backend through `ipc` in services/tauri-bridge.ts rather than calling `invoke` directly.
 */

export interface AppSettings {
  workingFolder: string;
  exportFolder: string;
  keyboardDelay: number;
  autoAdvance: boolean;
  /** Milliseconds auto-advance waits after a tag; 0 advances immediately. */
  autoAdvanceDelay: number;
  theme: string;
  contrast: string;
  uiScale: number;
  samplePath?: string;
  appDir?: string;
}

/** Any subset of settings; omitted keys are left unchanged by the backend. */
export type UpdateSettings = Partial<Omit<AppSettings, 'appDir' | 'samplePath'>> & {
  samplePath?: string;
  appDir?: string;
};

export interface BatchSummary {
  name: string;
  path: string;
  site: string;
  totalImages: number;
  classifiedCount: number;
  exportedCount: number;
  /** 'ready' | 'inprogress' | 'archived' | 'exported' */
  status: string;
  mediaAvailable: boolean;
}

export interface Classification {
  species: string;
  count: number;
  comment: string;
  sha256?: string | null;
  speciesInFrame?: number | null;
}

export interface MediaItem {
  fileName: string;
  fullPath: string;
  isExported: boolean;
  isVideo: boolean;
  classifications: Classification[];
  timestamp?: string | null;
}

export interface BatchMediaResponse {
  batchName: string;
  siteName: string;
  batchDir: string;
  items: MediaItem[];
}

/** Keymap row. `builtin`, `hidden` and `locked` are booleans (stored as 0/1 SQLite integers). */
export interface KeymapRecord {
  keystrokes: string;
  species: string;
  builtin: boolean;
  sortOrder: number;
  hidden: boolean;
  locked: boolean;
}

export interface ObservationRecord {
  id: string;
  timestamp: string;
  dateStr: string;
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
  hour: number;
  site: string;
  batch: string;
  species: string;
  count: number;
  comment: string;
  filename: string;
  source: string;
}

export interface AnalyticsResponse {
  observations: ObservationRecord[];
  isSample: boolean;
}

export interface BackupInfo {
  filePath: string;
  batchCount: number;
  classificationCount: number;
  speciesCount: number;
  timestamp: string;
  message: string;
}

export interface CsvImportResult {
  importedCount: number;
  batchCount: number;
  filePath: string;
  message: string;
}

export interface ExportResult {
  exportedFileCount: number;
  totalRecords: number;
  csvPath: string;
  xlsxPath: string;
  jsonPath: string;
  txtPath?: string;
  imagesPath?: string;
  merged: boolean;
  batchRecords: number;
}

/** Options shared by the batch and combined-batch export commands. */
export interface ExportOptions {
  /** 'full' | 'data_only' */
  exportType?: string;
  destinationPath?: string;
  mergeData?: boolean;
  exportCsv?: boolean;
  exportXlsx?: boolean;
  exportJson?: boolean;
  exportTxt?: boolean;
  /** 'none' | 'species_folders' | ... (see batch-export-modal) */
  imageStructure?: string;
}

export interface ScannedMediaItem {
  id: string;
  path: string;
  filename: string;
  timestamp: string;
  fileSizeBytes: number;
}

export interface QuickExportRecord {
  filename: string;
  path: string;
  species: string;
  timestamp: string;
  comment?: string | null;
  confidence?: string | null;
  site?: string | null;
  count?: number | null;
  batch?: string | null;
  sha256?: string | null;
}

export interface QuickExportRequest {
  records: QuickExportRecord[];
  destinationPath: string;
  exportXlsx: boolean;
  exportCsv: boolean;
  exportTxt: boolean;
  exportJson: boolean;
  /** 'none' | 'copy' | 'move' */
  imageAction: string;
  organizeBySpecies: boolean;
}

export interface QuickExportResult {
  success: boolean;
  filesExported: number;
  destination: string;
  summary: string;
}

export interface ImageThumbnailItem {
  originalPath: string;
  thumbPath: string;
}

// ---- Optional AI add-on (src-tauri/src/ai_commands.rs, ai/scan.rs) ----

export interface AiStatus {
  /** This build of the app can run the models at all. */
  compiled: boolean;
  installed: boolean;
  /** Why the add-on cannot be used, when it cannot. */
  problem: string | null;
  packDir: string | null;
  /** Where the downloader installs the add-on. */
  installDir: string;
  /** The add-on in use is the one TRAAACE downloaded (so the app can remove it), not a folder chosen by hand. */
  managed: boolean;
  /** The installed add-on's version, when it came from the downloader. */
  version: string | null;
  platform: string;
  credits: string[];
  licenseNote: string;
  /** The add-on has the video tool (FFmpeg), so videos can be scanned too. */
  videoTool: boolean;
}

export interface AiScanFile {
  id: string;
  path: string;
}

export interface AiSuggestion {
  id: string;
  /** Best three species guesses as display names with scores, best first. */
  alternatives: [string, number][];
  /** Confidence of the best detector box, or -1 when the detector found nothing. */
  detectorConfidence: number;
  /** Animal boxes the detector is reasonably sure of. */
  animals: number;
}

export type AiScanEvent =
  | { type: 'started'; total: number }
  | { type: 'suggestion'; suggestion: AiSuggestion; done: number; failed: number }
  | { type: 'failure'; id: string; error: string; done: number; failed: number }
  | { type: 'finished'; total: number; done: number; failed: number; cancelled: boolean }
  | { type: 'error'; message: string };

/** One photo's saved AI suggestion (Project mode keeps these in the database). `data` is the suggestion as JSON. */
export interface AiSuggestionRow {
  fileName: string;
  data: string;
}

/** One file's tags, for saving many photos at once. */
export interface FileClassifications {
  fileName: string;
  classifications: Classification[];
}

/** What would be downloaded, shown before the user agrees. */
export interface AiDownloadInfo {
  version: string;
  title: string;
  modelName: string;
  downloadBytes: number;
  unpackedBytes: number;
  credits: string[];
  licenses: string[];
  requiresAcceptance: boolean;
}

export interface AiInstallProgress {
  stage: 'downloading' | 'installing';
  /** Plain-language name of the file being fetched. */
  file: string;
  fileIndex: number;
  fileCount: number;
  bytesDone: number;
  bytesTotal: number;
}

export type AiInstallEvent =
  | ({ type: 'progress' } & AiInstallProgress)
  | { type: 'done'; dir: string }
  | { type: 'cancelled' }
  | { type: 'failed'; message: string };
