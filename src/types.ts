export type WorkspaceMode = 'quick' | 'project';

export interface MediaItem {
  id: string;
  path: string;
  filename: string;
  timestamp: string; // ISO format or formatted date
  species?: string;
  confidence?: 'high' | 'medium' | 'low';
  comment?: string;
  count?: number;
  isClassified: boolean;
  fileSizeBytes?: number;
  site?: string;
}

export interface HotkeySlot {
  key: string; // '1' - '9', '0', 'Space', etc.
  species: string;
  color?: string;
}

export interface ExportConfig {
  destinationPath: string;
  exportXlsx: boolean;
  exportCsv: boolean;
  exportTxt: boolean;
  exportJson: boolean;
  imageAction: 'none' | 'copy' | 'move';
  organizeBySpecies: boolean;
  site?: string;
  folderName?: string;
}

export interface ExportSummary {
  totalFiles: number;
  classifiedFiles: number;
  speciesCounts: Record<string, number>;
  unclassifiedCount: number;
}

export interface DateOffsetParams {
  newDate: string; // ISO string
  applyToAllRemaining: boolean;
}
