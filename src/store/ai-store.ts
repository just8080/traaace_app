import { ipc, isTauriEnvironment, listenAiInstall, listenAiScan } from '../services/tauri-bridge';
import { clampThreshold, DEFAULT_AI_THRESHOLD } from '../services/ai';
import type {
  AiDownloadInfo, AiInstallEvent, AiInstallProgress, AiScanEvent, AiScanFile, AiStatus, AiSuggestion,
} from '../ipc-types';

export type AiPhase = 'idle' | 'running' | 'finished' | 'cancelled' | 'error';

export interface AiScanState {
  phase: AiPhase;
  total: number;
  done: number;
  failed: number;
  message: string;
}

const PERSIST_BATCH = 50;
export type AiInstallPhase = 'idle' | 'checking' | 'offer' | 'installing' | 'done' | 'removing' | 'removed' | 'error';

export interface AiInstallState {
  phase: AiInstallPhase;
  info: AiDownloadInfo | null;
  progress: AiInstallProgress | null;
  message: string;
}

const idleInstall = (): AiInstallState => ({ phase: 'idle', info: null, progress: null, message: '' });

const THRESHOLD_KEY = 'traaace_ai_threshold';
/** A folder chosen by hand in early test builds. Nothing can set it any more, so it is cleared and never used. */
const OLD_PACK_DIR_KEY = 'traaace_ai_pack_dir';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable: the choice just is not remembered
  }
}

const idleScan = (): AiScanState => ({ phase: 'idle', total: 0, done: 0, failed: 0, message: '' });

/**
 * State for the optional AI add-on: what is installed, the running scan, and the suggestions it produced.
 * Kept apart from the photo stores so a scan's per-photo progress does not redraw the classifier.
 */
class AiStore {
  status: AiStatus | null = null;
  scan: AiScanState = idleScan();
  install: AiInstallState = idleInstall();
  suggestions = new Map<string, AiSuggestion>();
  threshold = clampThreshold(Number(readStorage(THRESHOLD_KEY) ?? DEFAULT_AI_THRESHOLD));
  /** Always null now: the add-on is the downloaded one, or a test folder set with TRAAACE_AI_PACK. */
  packDir: string | null = null;

  /** What the suggestions belong to: `quick`, or `project:<batch>`. Suggestions never carry over between scopes. */
  scope: string | null = null;
  private scanScope: string | null = null;
  private pending: AiSuggestion[] = [];
  private persist: ((batch: AiSuggestion[]) => Promise<void>) | null = null;
  private listeners = new Set<() => void>();
  private unlisten: (() => void) | null = null;
  private unlistenInstall: (() => void) | null = null;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach(fn => fn());
  }

  get isRunning(): boolean {
    return this.scan.phase === 'running';
  }

  async refreshStatus(): Promise<void> {
    if (!isTauriEnvironment()) {
      this.status = null;
      return;
    }
    try {
      this.status = await ipc.aiStatus(this.packDir);
    } catch (err) {
      this.status = null;
      console.error('Failed to read AI add-on status:', err);
    }
    this.notify();
  }

  /** Forgets a finished or failed download so the dialog starts fresh. */
  resetInstall(): void {
    if (['installing', 'checking', 'removing'].includes(this.install.phase)) return;
    this.install = idleInstall();
  }

  /** Asks what would be downloaded (size, credits, licences) so the user can decide. */
  async checkDownload(): Promise<void> {
    if (this.install.phase === 'checking' || this.install.phase === 'installing') return;
    this.install = { ...idleInstall(), phase: 'checking' };
    this.notify();
    try {
      const info = await ipc.aiDownloadInfo();
      this.install = { ...idleInstall(), phase: 'offer', info };
    } catch (err) {
      this.install = { ...idleInstall(), phase: 'error', message: String(err) };
    }
    this.notify();
  }

  async startInstall(): Promise<void> {
    if (this.install.phase === 'installing') return;
    this.install = { ...this.install, phase: 'installing', progress: null, message: '' };
    this.notify();
    try {
      this.unlistenInstall ??= await listenAiInstall(event => this.handleInstallEvent(event));
      await ipc.aiInstallStart();
    } catch (err) {
      this.handleInstallEvent({ type: 'failed', message: String(err) });
    }
  }

  /** Deletes the downloaded add-on from this computer. Photos, tags and exports are not touched. */
  async removeAddOn(): Promise<void> {
    if (this.isRunning || this.install.phase === 'installing' || this.install.phase === 'removing') return;
    this.install = { ...idleInstall(), phase: 'removing' };
    this.notify();
    try {
      await ipc.aiUninstall();
      this.install = { ...idleInstall(), phase: 'removed' };
      await this.refreshStatus();
    } catch (err) {
      this.install = { ...idleInstall(), phase: 'error', message: String(err) };
    }
    this.notify();
  }

  cancelInstall(): void {
    if (this.install.phase !== 'installing') return;
    ipc.aiInstallCancel().catch(err => console.error('Failed to cancel the AI download:', err));
  }

  handleInstallEvent(event: AiInstallEvent): void {
    switch (event.type) {
      case 'progress':
        this.install = { ...this.install, phase: 'installing', progress: event };
        break;
      case 'done':
        this.install = { ...this.install, phase: 'done', progress: null };
        void this.refreshStatus();
        break;
      case 'cancelled':
        this.install = { ...this.install, phase: this.install.info ? 'offer' : 'idle', progress: null };
        break;
      case 'failed':
        this.install = { ...this.install, phase: 'error', progress: null, message: event.message };
        break;
    }
    this.notify();
  }

  setThreshold(value: number): void {
    this.threshold = clampThreshold(value);
    writeStorage(THRESHOLD_KEY, String(this.threshold));
    this.notify();
  }

  /**
   * Switches to `scope` (a different batch, say). Anything from the old scope is dropped, a scan still running for it is
   * stopped, and `load` can restore suggestions saved earlier.
   */
  async useScope(scope: string, load?: () => Promise<AiSuggestion[]>): Promise<void> {
    if (this.scope === scope) return;
    if (this.isRunning) this.cancelScan();
    this.scope = scope;
    this.pending = [];
    this.suggestions.clear();
    this.scan = idleScan();
    this.notify();
    if (!load) return;
    try {
      const saved = await load();
      if (this.scope !== scope) return;
      saved.forEach(s => this.suggestions.set(s.id, s));
      if (saved.length > 0) this.scan = { ...idleScan(), phase: 'finished', total: saved.length, done: saved.length };
    } catch (err) {
      console.error('Failed to load saved AI suggestions:', err);
    }
    this.notify();
  }

  /** `persist` receives the suggestions in batches as they arrive, so a long scan survives closing the app. */
  async startScan(
    files: AiScanFile[],
    knownSpecies: string[],
    persist: ((batch: AiSuggestion[]) => Promise<void>) | null = null
  ): Promise<void> {
    if (this.isRunning || files.length === 0) return;
    this.scanScope = this.scope;
    this.persist = persist;
    this.pending = [];
    this.suggestions.clear();
    this.scan = { phase: 'running', total: files.length, done: 0, failed: 0, message: 'Loading the AI models…' };
    this.notify();
    try {
      this.unlisten ??= await listenAiScan(event => this.handleEvent(event));
      await ipc.aiScanStart(files, knownSpecies, this.packDir);
    } catch (err) {
      this.handleEvent({ type: 'error', message: String(err) });
    }
  }

  cancelScan(): void {
    if (!this.isRunning) return;
    this.scan = { ...this.scan, message: 'Stopping…' };
    this.notify();
    ipc.aiScanCancel().catch(err => console.error('Failed to cancel the AI scan:', err));
  }

  handleEvent(event: AiScanEvent): void {
    // A scan that belongs to a scope the user has left must not touch the current one.
    if (event.type !== 'error' && this.scanScope !== this.scope) return;
    switch (event.type) {
      case 'started':
        this.scan = { ...this.scan, total: event.total, message: '' };
        break;
      case 'suggestion':
        if (this.scanScope !== this.scope) return;
        this.suggestions.set(event.suggestion.id, event.suggestion);
        this.pending.push(event.suggestion);
        if (this.pending.length >= PERSIST_BATCH) this.flush();
        this.scan = { ...this.scan, done: event.done, failed: event.failed };
        break;
      case 'failure':
        this.scan = { ...this.scan, done: event.done, failed: event.failed };
        break;
      case 'finished':
        this.flush();
        this.scan = {
          phase: event.cancelled ? 'cancelled' : 'finished',
          total: event.total,
          done: event.done,
          failed: event.failed,
          message: '',
        };
        break;
      case 'error':
        this.flush();
        this.scan = { ...this.scan, phase: 'error', message: event.message };
        break;
    }
    this.notify();
  }

  private flush(): void {
    const batch = this.pending;
    this.pending = [];
    if (batch.length === 0 || !this.persist) return;
    this.persist(batch).catch(err => console.error('Failed to save AI suggestions:', err));
  }

  /** Forgets the suggestions (a new folder, or the user starting over). */
  clear(): void {
    this.suggestions.clear();
    this.pending = [];
    this.scan = idleScan();
    this.notify();
  }
}

// Forget a folder remembered by an early test build; it would otherwise keep pointing the app at it.
writeStorage(OLD_PACK_DIR_KEY, null);

export const aiStore = new AiStore();
