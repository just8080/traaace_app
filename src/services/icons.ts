import boltSvg from '../assets/icons/tabler-bolt.svg?raw';
import boxSeamSvg from '../assets/icons/tabler-box-seam.svg?raw';
import calendarSvg from '../assets/icons/tabler-calendar.svg?raw';
import chartSvg from '../assets/icons/tabler-chart-bar-popular.svg?raw';
import checkSvg from '../assets/icons/tabler-check.svg?raw';
import clipboardSvg from '../assets/icons/tabler-clipboard-text.svg?raw';
import folderOpenSvg from '../assets/icons/tabler-folder-open.svg?raw';
import helpSvg from '../assets/icons/tabler-help.svg?raw';
import keyboardSvg from '../assets/icons/tabler-keyboard.svg?raw';
import labelImportantSvg from '../assets/icons/tabler-label-important.svg?raw';
import lockSvg from '../assets/icons/tabler-lock.svg?raw';
import messageSvg from '../assets/icons/tabler-message.svg?raw';
import moonSvg from '../assets/icons/tabler-moon.svg?raw';
import pawSvg from '../assets/icons/tabler-paw.svg?raw';
import pencilSvg from '../assets/icons/tabler-pencil.svg?raw';
import photoSvg from '../assets/icons/tabler-photo.svg?raw';
import playerPauseSvg from '../assets/icons/tabler-player-pause.svg?raw';
import playerPlaySvg from '../assets/icons/tabler-player-play.svg?raw';
import plusSvg from '../assets/icons/tabler-plus.svg?raw';
import refreshSvg from '../assets/icons/tabler-refresh.svg?raw';
import settingsSvg from '../assets/icons/tabler-settings.svg?raw';
import sunSvg from '../assets/icons/tabler-sun.svg?raw';
import tableExportSvg from '../assets/icons/tabler-table-export.svg?raw';
import tableImportSvg from '../assets/icons/tabler-table-import.svg?raw';
import trashSvg from '../assets/icons/tabler-trash.svg?raw';
import videoSvg from '../assets/icons/tabler-video.svg?raw';
import volumeOffSvg from '../assets/icons/tabler-volume-off.svg?raw';
import volumeSvg from '../assets/icons/tabler-volume.svg?raw';
import xSvg from '../assets/icons/tabler-x.svg?raw';

const ICON_MAP: Record<string, string> = {
  // Bolt / Quick
  'bolt': boltSvg,
  'tabler-bolt': boltSvg,
  'quick': boltSvg,
  'lightning': boltSvg,

  // Box Seam / Batches / Packages
  'box': boxSeamSvg,
  'box-seam': boxSeamSvg,
  'tabler-box-seam': boxSeamSvg,
  'package': boxSeamSvg,
  'batches': boxSeamSvg,
  'backup': boxSeamSvg,

  // Calendar
  'calendar': calendarSvg,
  'tabler-calendar': calendarSvg,
  'date': calendarSvg,

  // Chart / Analytics / Excel
  'chart': chartSvg,
  'tabler-chart-bar-popular': chartSvg,
  'insights': chartSvg,
  'analytics': chartSvg,
  'bar-chart': chartSvg,

  // Clipboard / Manifest / Reports
  'clipboard': clipboardSvg,
  'tabler-clipboard-text': clipboardSvg,
  'manifest': clipboardSvg,
  'doc': clipboardSvg,
  'file-text': clipboardSvg,

  // Folder
  'folder': folderOpenSvg,
  'folder-open': folderOpenSvg,
  'tabler-folder-open': folderOpenSvg,
  'library': folderOpenSvg,

  // Help
  'help': helpSvg,
  'tabler-help': helpSvg,
  'question': helpSvg,

  // Keyboard
  'keyboard': keyboardSvg,
  'tabler-keyboard': keyboardSvg,
  'shortcuts': keyboardSvg,

  // Labels & Tags
  'label-important': labelImportantSvg,
  'tabler-label-important': labelImportantSvg,
  'keymap': labelImportantSvg,
  'tag': labelImportantSvg,
  'label': labelImportantSvg,

  // Lock
  'lock': lockSvg,
  'tabler-lock': lockSvg,

  // Message / Comments
  'message': messageSvg,
  'tabler-message': messageSvg,
  'comment': messageSvg,
  'notes': messageSvg,

  // Theme Moon / Sun
  'moon': moonSvg,
  'tabler-moon': moonSvg,
  'dark': moonSvg,

  'sun': sunSvg,
  'tabler-sun': sunSvg,
  'light': sunSvg,

  // Paw
  'paw': pawSvg,
  'tabler-paw': pawSvg,
  'animal': pawSvg,
  'species': pawSvg,

  // Video playback
  'play': playerPlaySvg,
  'tabler-player-play': playerPlaySvg,
  'pause': playerPauseSvg,
  'tabler-player-pause': playerPauseSvg,
  'volume': volumeSvg,
  'tabler-volume': volumeSvg,
  'volume-off': volumeOffSvg,
  'tabler-volume-off': volumeOffSvg,
  'video': videoSvg,
  'tabler-video': videoSvg,

  // Pencil / Edit
  'pencil': pencilSvg,
  'tabler-pencil': pencilSvg,
  'edit': pencilSvg,

  // Photo
  'photo': photoSvg,
  'tabler-photo': photoSvg,
  'image': photoSvg,

  // Refresh
  'refresh': refreshSvg,
  'tabler-refresh': refreshSvg,
  'rescan': refreshSvg,
  'sync': refreshSvg,

  // Settings
  'settings': settingsSvg,
  'tabler-settings': settingsSvg,
  'gear': settingsSvg,

  // Table Export / Import
  'export': tableExportSvg,
  'table-export': tableExportSvg,
  'tabler-table-export': tableExportSvg,

  'import': tableImportSvg,
  'table-import': tableImportSvg,
  'tabler-table-import': tableImportSvg,

  // Trash
  'trash': trashSvg,
  'tabler-trash': trashSvg,
  'delete': trashSvg,

  // Check (from tabler-check.svg)
  'check': checkSvg,
  'tabler-check': checkSvg,
  'success': checkSvg,

  // Plus (from tabler-plus.svg)
  'plus': plusSvg,
  'tabler-plus': plusSvg,

  // Close / X (from tabler-x.svg)
  'close': xSvg,
  'tabler-x': xSvg,
  'x': xSvg,
};

export type IconName = keyof typeof ICON_MAP;

export interface IconOptions {
  size?: number | string;
  className?: string;
  style?: string;
}

export function getIconSvg(name: string, options: IconOptions = {}): string {
  const rawSvg = ICON_MAP[name];
  if (!rawSvg) {
    console.warn(`[Icon] Unknown icon name: "${name}"`);
    return '';
  }

  const { size, className, style } = options;
  const classes = ['app-icon', className].filter(Boolean).join(' ');
  const styles: string[] = [];

  if (size) {
    const sizeVal = typeof size === 'number' ? `${size}px` : size;
    styles.push(`width: ${sizeVal}; height: ${sizeVal}; font-size: ${sizeVal};`);
  }
  if (style) {
    styles.push(style);
  }

  const styleAttr = styles.length > 0 ? ` style="${styles.join(' ')}"` : '';
  const classAttr = classes ? ` class="${classes}"` : '';

  // Inject class and style into the outer <svg>
  return rawSvg.replace('<svg', `<svg${classAttr}${styleAttr}`);
}

/**
 * Convenience helper to render an icon string for template literals.
 * Example: `${icon('paw')}` or `${icon('folder', { size: 18 })}`
 */
export function icon(name: string, options: IconOptions = {}): string {
  return getIconSvg(name, options);
}

/**
 * Custom web component: <ui-icon name="paw"></ui-icon>
 */
export class UiIcon extends HTMLElement {
  static get observedAttributes() {
    return ['name', 'size', 'class'];
  }

  connectedCallback(): void {
    this.render();
  }

  attributeChangedCallback(): void {
    this.render();
  }

  private render(): void {
    const name = this.getAttribute('name') || '';
    const size = this.getAttribute('size') || undefined;
    if (name) {
      this.innerHTML = getIconSvg(name, { size });
    }
  }
}

if (!customElements.get('ui-icon')) {
  customElements.define('ui-icon', UiIcon);
}

declare global {
  interface HTMLElementTagNameMap {
    'ui-icon': UiIcon;
  }
}
