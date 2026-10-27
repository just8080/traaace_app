import { currentMonitor, getCurrentWindow, PhysicalSize, type Window } from '@tauri-apps/api/window';
import { isTauriEnvironment } from './tauri-bridge';

let revealed = false;

/** Share of the screen a window that is too big gets shrunk to. */
const FIT_SHARE = 0.95;

/**
 * Shrinks the window to fit the screen when it is bigger than the usable area (the default size on a small laptop, or a
 * size remembered from a bigger monitor) and centres it. A window that fits, or is maximized, is left alone.
 */
async function fitToScreen(win: Window): Promise<void> {
  const monitor = await currentMonitor();
  if (!monitor || (await win.isMaximized())) return;
  const area = monitor.workArea.size;
  const [outer, inner] = await Promise.all([win.outerSize(), win.innerSize()]);
  if (outer.width <= area.width && outer.height <= area.height) return;
  // setSize sets the inner size, so leave room for the title bar and borders.
  const frameW = outer.width - inner.width;
  const frameH = outer.height - inner.height;
  const width = Math.min(inner.width, Math.floor(area.width * FIT_SHARE) - frameW);
  const height = Math.min(inner.height, Math.floor(area.height * FIT_SHARE) - frameH);
  await win.setSize(new PhysicalSize(width, height));
  await win.center();
}

/**
 * Shows the window once the first screen has been drawn. The window starts hidden (tauri.conf.json), so the user never
 * sees a blank window, the fonts loading or the theme and zoom being applied. Safe to call more than once; only the
 * first call does anything. The Rust side shows the window anyway if this never runs.
 */
export async function revealWindow(): Promise<void> {
  if (revealed) return;
  revealed = true;

  // Wait for the bundled fonts (they are local, so this is quick), but never longer than a second.
  await Promise.race([document.fonts?.ready, new Promise(resolve => setTimeout(resolve, 1000))]);
  // Two frames: the first lays the page out, the second has painted it. A hidden window may not draw frames at all
  // (macOS pauses them), so don't wait more than a tenth of a second for them.
  const twoFrames = new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await Promise.race([twoFrames, new Promise(resolve => setTimeout(resolve, 100))]);

  document.documentElement.classList.add('app-revealed');
  if (!isTauriEnvironment()) return;
  try {
    const win = getCurrentWindow();
    // Size, position and maximized state were already restored while hidden (the window-state plugin in lib.rs).
    await fitToScreen(win);
    await win.show();
    await win.setFocus();
  } catch (err) {
    console.warn('Could not show the window (the app will show it after a few seconds):', err);
  }
}
