import { ipc, isTauriEnvironment } from '../services/tauri-bridge';

export const MAX_ADVANCE_DELAY_MS = 3000;

/** How long auto-advance waits after a tag before moving to the next photo (0 = immediately). */
let advanceDelayMs = 0;

export function getAdvanceDelay(): number {
  return advanceDelayMs;
}

export function clampAdvanceDelay(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.min(Math.max(Math.round(ms), 0), MAX_ADVANCE_DELAY_MS);
}

/** Sets the delay; `persist` writes it to the app settings (skip while the slider is still being dragged). */
export function setAdvanceDelay(ms: number, persist = true): void {
  advanceDelayMs = clampAdvanceDelay(ms);
  if (persist && isTauriEnvironment()) {
    ipc.saveSettings({ autoAdvanceDelay: advanceDelayMs }).catch(err => {
      console.error('Failed to save autoAdvanceDelay setting:', err);
    });
  }
}

if (isTauriEnvironment()) {
  ipc.getSettings()
    .then(settings => { advanceDelayMs = clampAdvanceDelay(settings.autoAdvanceDelay ?? 0); })
    .catch(err => console.error('Failed to load autoAdvanceDelay setting:', err));
}

/**
 * Holds one pending "move to the next photo" action. Further edits to the same photo (another tag,
 * count or comment) call `touch()` to restart the wait so the user is not moved on mid-edit.
 */
export class DelayedAdvance {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private action: (() => void) | null = null;
  private ms = 0;

  get pending(): boolean {
    return this.timer !== null;
  }

  schedule(action: () => void, ms: number): void {
    this.cancel();
    this.action = action;
    this.ms = ms;
    this.arm();
  }

  /** Restarts the wait if an advance is pending; does nothing otherwise. */
  touch(): void {
    if (this.timer !== null && this.action) {
      clearTimeout(this.timer);
      this.arm();
    }
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.action = null;
  }

  private arm(): void {
    this.timer = setTimeout(() => {
      const action = this.action;
      this.timer = null;
      this.action = null;
      action?.();
    }, this.ms);
  }
}
