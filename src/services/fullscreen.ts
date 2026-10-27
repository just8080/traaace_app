import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriEnvironment } from './tauri-bridge';

/** Switches the app window between full screen (no title bar) and its normal size. Does nothing in a browser. */
export async function toggleFullscreen(): Promise<boolean | null> {
  if (!isTauriEnvironment()) return null;
  try {
    const win = getCurrentWindow();
    const next = !(await win.isFullscreen());
    await win.setFullscreen(next);
    return next;
  } catch (err) {
    console.error('Could not switch full screen:', err);
    return null;
  }
}
