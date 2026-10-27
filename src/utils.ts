/**
 * Tagged template helper for HTML templates.
 *
 * Allows VS Code extensions (such as bierner.lit-html) to provide:
 * - Full HTML syntax highlighting in TypeScript files
 * - HTML tag and attribute IntelliSense
 * - Tag auto-closing and renaming
 * - Clean Prettier / formatter support
 *
 * Safely interpolates expressions:
 * - Arrays are concatenated without commas (e.g. mapping lists of items)
 * - Falsy values (false, null, undefined) render empty strings rather than "false" / "null"
 */
export const html = (strings: TemplateStringsArray, ...values: unknown[]): string => {
  let result = strings[0];
  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    if (val !== null && val !== undefined && val !== false) {
      result += Array.isArray(val) ? val.join('') : String(val);
    }
    result += strings[i + 1];
  }
  return result;
};

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes a value for safe use in HTML text content and quoted attribute values.
 *
 * `html` does NOT escape interpolations, so any user-controlled value (batch,
 * site, species, comment, file and folder names) must be wrapped in this before
 * being interpolated into a template. null / undefined become an empty string.
 */
export const escapeHtml = (value: unknown): string =>
  value === null || value === undefined
    ? ''
    : String(value).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);

/**
 * Tagged template helper for CSS blocks.
 * Enables CSS syntax highlighting and auto-completion inside template literals.
 */
export const css = (strings: TemplateStringsArray, ...values: unknown[]): string =>
  String.raw({ raw: strings }, ...values);

const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'avi', 'mkv', 'wmv'];
/** Containers the webview cannot decode (no <video> preview), even though the files are valid. */
const UNPREVIEWABLE_VIDEO_EXTENSIONS = ['avi', 'mkv', 'wmv'];

const fileExtension = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
};

/** True for video files, judged by extension. */
export const isVideoFile = (name: string): boolean => VIDEO_EXTENSIONS.includes(fileExtension(name));

/** False for video formats the webview cannot play (they can still be classified and exported). */
export const canPreviewVideo = (name: string): boolean => !UNPREVIEWABLE_VIDEO_EXTENSIONS.includes(fileExtension(name));

/** Formats a playback time as m:ss. */
export const formatClock = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

