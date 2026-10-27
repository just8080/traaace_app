import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { confirm as tauriConfirm } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { MediaItem, ExportConfig } from '../types';
import type * as Ipc from '../ipc-types';
import { isVideoFile } from '../utils';

export { convertFileSrc };

/**
 * Typed wrappers for every Rust command the frontend calls. This is the only module that
 * should import `invoke`. Argument objects use camelCase (Tauri maps them to the Rust
 * snake_case parameter names); payload types live in ../ipc-types.
 *
 * These throw outside the Tauri runtime. Callers that support browser mode should guard
 * with `isTauriEnvironment()`.
 */
export const ipc = {
  // Settings
  getSettings: () => invoke<Ipc.AppSettings>('get_settings'),
  saveSettings: (settings: Ipc.UpdateSettings) => invoke<Ipc.AppSettings>('save_settings', { settings }),
  getDevMode: () => invoke<boolean>('get_dev_mode'),
  getAppDataPath: () => invoke<string>('get_app_data_path'),
  openAppDataFolder: () => invoke<void>('open_app_data_folder'),

  // Batches
  getBatches: () => invoke<Ipc.BatchSummary[]>('get_batches'),
  getBatchMedia: (batchName: string) => invoke<Ipc.BatchMediaResponse>('get_batch_media', { batchName }),
  deleteBatch: (batchName: string) => invoke<boolean>('delete_batch', { batchName }),
  deleteBatchLocalImages: (batchName: string) => invoke<boolean>('delete_batch_local_images', { batchName }),
  updateBatchSite: (batchName: string, newSite: string) =>
    invoke<boolean>('update_batch_site', { batchName, newSite }),
  saveClassification: (batchName: string, fileName: string, classifications: Ipc.Classification[]) =>
    invoke<number>('save_classification', { batchName, fileName, classifications }),
  saveClassificationsBulk: (batchName: string, files: Ipc.FileClassifications[]) =>
    invoke<number>('save_classifications_bulk', { batchName, files }),
  saveAiSuggestions: (batchName: string, rows: Ipc.AiSuggestionRow[]) =>
    invoke<number>('save_ai_suggestions', { batchName, rows }),
  getAiSuggestions: (batchName: string) => invoke<Ipc.AiSuggestionRow[]>('get_ai_suggestions', { batchName }),
  clearAiSuggestions: (batchName: string) => invoke<void>('clear_ai_suggestions', { batchName }),
  updateFileTimestamp: (fullPath: string, newTimestamp: string) =>
    invoke<boolean>('update_file_timestamp', { fullPath, newTimestamp }),

  // Export
  exportBatch: (batchName: string, options: Ipc.ExportOptions) =>
    invoke<Ipc.ExportResult>('export_batch', { batchName, ...options }),
  exportCombinedBatches: (batchNames: string[], options: Ipc.ExportOptions) =>
    invoke<Ipc.ExportResult>('export_combined_batches', { batchNames, ...options }),
  exportAnalyticsCsv: (csvContent: string, filename: string, destinationPath?: string) =>
    invoke<string>('export_analytics_csv', { csvContent, filename, destinationPath }),

  // Optional AI add-on
  aiStatus: (packDir?: string | null) => invoke<Ipc.AiStatus>('ai_status', { packDir: packDir ?? null }),
  aiScanStart: (files: Ipc.AiScanFile[], knownSpecies: string[], packDir?: string | null) =>
    invoke<void>('ai_scan_start', { files, knownSpecies, packDir: packDir ?? null }),
  aiScanCancel: () => invoke<void>('ai_scan_cancel'),
  aiDownloadInfo: () => invoke<Ipc.AiDownloadInfo>('ai_download_info'),
  aiInstallStart: () => invoke<void>('ai_install_start'),
  aiInstallCancel: () => invoke<void>('ai_install_cancel'),
  aiUninstall: () => invoke<void>('ai_uninstall'),

  // Keymap & comments
  getAllKeymap: () => invoke<Ipc.KeymapRecord[]>('get_all_keymap'),
  saveKeymapItem: (item: Ipc.KeymapRecord) => invoke<Ipc.KeymapRecord[]>('save_keymap_item', { item }),
  deleteKeymapItem: (keystrokes: string) => invoke<Ipc.KeymapRecord[]>('delete_keymap_item', { keystrokes }),
  reorderKeymap: (keys: string[]) => invoke<Ipc.KeymapRecord[]>('reorder_keymap', { keys }),
  resetDefaultKeymaps: () => invoke<Ipc.KeymapRecord[]>('reset_default_keymaps'),
  getComments: () => invoke<string[]>('get_comments'),
  addComment: (comment: string) => invoke<string[]>('add_comment', { comment }),
  deleteComment: (comment: string) => invoke<string[]>('delete_comment', { comment }),
  resetDefaultComments: () => invoke<string[]>('reset_default_comments'),

  // Analytics, backup & CSV
  getAnalyticsData: () => invoke<Ipc.AnalyticsResponse>('get_analytics_data'),
  importAnalyticsCsv: (filePath: string) => invoke<Ipc.CsvImportResult>('import_analytics_csv', { filePath }),
  backupAppData: (destinationPath: string) => invoke<Ipc.BackupInfo>('backup_app_data', { destinationPath }),
  restoreAppData: (sourcePath: string) => invoke<Ipc.BackupInfo>('restore_app_data', { sourcePath }),

  // Native dialogs
  selectSaveBackupPath: (defaultName?: string) =>
    invoke<string | null>('select_save_backup_path', { defaultName }),
  selectBackupFile: () => invoke<string | null>('select_backup_file'),
  selectCsvFile: () => invoke<string | null>('select_csv_file'),
  selectSaveCsvPath: (defaultName?: string) => invoke<string | null>('select_save_csv_path', { defaultName }),

  // Window
  startDrag: () => invoke<void>('start_drag'),
};

export const isTauriEnvironment = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

export async function selectFolderDialog(title = 'Select Camera Trap Folder', defaultPath?: string): Promise<string | null> {
  if (isTauriEnvironment()) {
    try {
      const res = await invoke<string | null>('select_folder', { title, defaultPath });
      return res;
    } catch (err) {
      console.error('selectFolderDialog error:', err);
      return null;
    }
  }
  return prompt('Enter folder path for testing:');
}

export async function scanFolderMedia(folderPath: string, recursive = true): Promise<MediaItem[]> {
  if (isTauriEnvironment()) {
    const rawItems = await invoke<Ipc.ScannedMediaItem[]>('scan_folder', { path: folderPath, recursive });

    // Pre-generate 300px thumbnails asynchronously across all CPU cores with Rayon
    generateThumbnailsBackground(rawItems.map(i => i.path));

    return rawItems.map(item => ({
      id: item.id,
      path: item.path,
      filename: item.filename,
      timestamp: item.timestamp,
      isClassified: false,
      fileSizeBytes: item.fileSizeBytes,
    }));
  }

  // Browser demo fallback
  return Array.from({ length: 12 }, (_, i) => {
    const id = `demo_${i + 1}`;
    const filename = `RCNX${(1000 + i)}.JPG`;
    return {
      id,
      path: `/demo/${filename}`,
      filename,
      timestamp: new Date(Date.now() - (12 - i) * 60000).toISOString(),
      isClassified: i < 3,
      species: i < 3 ? (i === 0 ? 'Possum' : i === 1 ? 'Stoat' : 'Empty') : undefined,
      confidence: 'high',
      fileSizeBytes: 2450000,
    };
  });
}

export async function getThumbnailSrc(filePath: string): Promise<string> {
  if (isTauriEnvironment() && filePath) {
    try {
      const thumbPath = await invoke<string>('get_or_create_thumbnail', { path: filePath });
      if (thumbPath) {
        return convertFileSrc(thumbPath);
      }
    } catch (err) {
      console.warn('get_or_create_thumbnail error, falling back:', err);
    }
    return convertFileSrc(filePath);
  }
  return readMediaDataUri(filePath);
}

export function generateThumbnailsBackground(paths: string[]): void {
  if (isTauriEnvironment() && paths.length > 0) {
    invoke<Ipc.ImageThumbnailItem[]>('generate_thumbnails', { paths }).catch(err => {
      console.warn('generate_thumbnails background error:', err);
    });
  }
}

export async function readMediaDataUri(filePath: string): Promise<string> {
  if (isTauriEnvironment() && filePath) {
    // Linux's web view cannot play video from the asset address, so the app serves it from a local web server there.
    // The command answers null on the computers that do not need it.
    if (isVideoFile(filePath)) {
      try {
        const url = await invoke<string | null>('media_url', { path: filePath });
        if (url) return url;
      } catch (err) {
        console.warn('media_url error, falling back to the asset address:', err);
      }
    }
    try {
      const assetUrl = convertFileSrc(filePath);
      if (assetUrl) return assetUrl;
    } catch (err) {
      console.warn('convertFileSrc error, falling back to read_media_file:', err);
    }
    return await invoke<string>('read_media_file', { path: filePath });
  }
  // Browser fallback image SVG placeholder
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
    <rect width="800" height="500" fill="#181b1f"/>
    <text x="50%" y="45%" text-anchor="middle" fill="#9da7b3" font-size="24" font-family="system-ui">
      ${filePath.split('/').pop()}
    </text>
    <text x="50%" y="55%" text-anchor="middle" fill="#636e7b" font-size="14" font-family="system-ui">
      Demo Preview Image
    </text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export async function executeQuickExport(
  items: MediaItem[],
  config: ExportConfig
): Promise<{ success: boolean; summary: string; destination: string; filesExported: number }> {
  if (isTauriEnvironment()) {
    const site = config.site || 'Default';
    const folder = config.folderName || 'Quick_Session';
    const records = items.map(item => ({
      filename: item.filename,
      path: item.path,
      species: item.species || '',
      timestamp: item.timestamp,
      comment: item.comment,
      confidence: item.confidence,
      site: item.site || site,
      count: item.count || 1,
      batch: folder,
    }));

    const request: Ipc.QuickExportRequest = {
      records,
      destinationPath: config.destinationPath,
      exportXlsx: config.exportXlsx,
      exportCsv: config.exportCsv,
      exportTxt: config.exportTxt,
      exportJson: config.exportJson,
      imageAction: config.imageAction,
      organizeBySpecies: config.organizeBySpecies,
    };
    return await invoke<Ipc.QuickExportResult>('export_quick_session', { request });
  }

  return {
    success: true,
    summary: `${items.length} items exported to ${config.destinationPath} (Simulated).`,
    destination: config.destinationPath,
    filesExported: items.length,
  };
}

export async function askConfirm(
  message: string,
  options?: { title?: string; kind?: 'info' | 'warning' | 'error' }
): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      return await tauriConfirm(message, {
        title: options?.title || 'Confirm Action',
        kind: options?.kind || 'warning',
      });
    } catch (err) {
      console.warn('tauriConfirm error, fallback to window.confirm:', err);
    }
  }
  return window.confirm(message);
}

export type FileDropPayload = {
  type: 'enter' | 'over' | 'drop' | 'leave';
  paths?: string[];
  position?: { x: number; y: number };
};

export async function listenFileDrop(handler: (payload: FileDropPayload) => void): Promise<(() => void) | null> {
  if (isTauriEnvironment()) {
    try {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      const webview = getCurrentWebview();
      const unlisten = await webview.onDragDropEvent((event) => {
        handler(event.payload as FileDropPayload);
      });
      return unlisten;
    } catch (err) {
      console.warn('Failed to register onDragDropEvent listener:', err);
    }
  }
  return null;
}

/** Opens a web link in the system browser (a new tab when running in a plain browser). */
export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      await openUrl(url);
      return;
    } catch (err) {
      console.warn('openUrl failed, falling back to window.open:', err);
    }
  }
  window.open(url, '_blank', 'noopener');
}

export async function openPath(path: string): Promise<void> {
  if (isTauriEnvironment()) {
    return await invoke('open_path', { path });
  } else {
    console.log('Simulated openPath:', path);
  }
}


/** Progress events from a running AI scan. Returns a function that stops listening, or null outside Tauri. */
export async function listenAiScan(handler: (event: Ipc.AiScanEvent) => void): Promise<(() => void) | null> {
  if (!isTauriEnvironment()) return null;
  return listen<Ipc.AiScanEvent>('ai-scan', e => handler(e.payload));
}

/** Progress events from the AI add-on download. Returns a function that stops listening, or null outside Tauri. */
export async function listenAiInstall(handler: (event: Ipc.AiInstallEvent) => void): Promise<(() => void) | null> {
  if (!isTauriEnvironment()) return null;
  return listen<Ipc.AiInstallEvent>('ai-install', e => handler(e.payload));
}
