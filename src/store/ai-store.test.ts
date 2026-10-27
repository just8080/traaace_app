import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiSuggestion } from '../ipc-types';
import { aiStore } from './ai-store';

const suggestion = (id: string): AiSuggestion => ({ id, alternatives: [['Kea', 0.9]], detectorConfidence: 0.9, animals: 1 });

describe('aiStore', () => {
  beforeEach(() => aiStore.clear());

  it('collects suggestions and progress from scan events', () => {
    let notified = 0;
    const off = aiStore.subscribe(() => notified++);
    aiStore.handleEvent({ type: 'started', total: 3 });
    aiStore.handleEvent({ type: 'suggestion', suggestion: suggestion('a'), done: 1, failed: 0 });
    aiStore.handleEvent({ type: 'failure', id: 'b', error: 'bad', done: 1, failed: 1 });
    expect(aiStore.suggestions.get('a')?.alternatives[0][0]).toBe('Kea');
    expect(aiStore.scan).toMatchObject({ total: 3, done: 1, failed: 1 });
    expect(notified).toBe(3);
    off();
  });

  it('records how a scan ended', () => {
    aiStore.handleEvent({ type: 'finished', total: 3, done: 2, failed: 1, cancelled: false });
    expect(aiStore.scan).toMatchObject({ phase: 'finished', done: 2, failed: 1 });
    aiStore.handleEvent({ type: 'finished', total: 3, done: 1, failed: 0, cancelled: true });
    expect(aiStore.scan.phase).toBe('cancelled');
    aiStore.handleEvent({ type: 'error', message: 'no models' });
    expect(aiStore.scan).toMatchObject({ phase: 'error', message: 'no models' });
  });

  it('forgets everything on clear', () => {
    aiStore.handleEvent({ type: 'suggestion', suggestion: suggestion('a'), done: 1, failed: 0 });
    aiStore.clear();
    expect(aiStore.suggestions.size).toBe(0);
    expect(aiStore.scan.phase).toBe('idle');
  });

  it('keeps the threshold in range', () => {
    aiStore.setThreshold(5);
    expect(aiStore.threshold).toBe(0.95);
    aiStore.setThreshold(0.6);
    expect(aiStore.threshold).toBe(0.6);
  });
});

describe('aiStore scopes and saving', () => {
  const sug = (id: string): AiSuggestion => ({ id, alternatives: [['Kea', 0.9]], detectorConfidence: 0.9, animals: 1 });

  beforeEach(async () => {
    aiStore.clear();
    aiStore.scope = null;
  });

  it('restores saved suggestions when a scope is opened, and drops them when it changes', async () => {
    await aiStore.useScope('project:a', async () => [sug('a1'), sug('a2')]);
    expect(aiStore.suggestions.size).toBe(2);
    expect(aiStore.scan.phase).toBe('finished');
    await aiStore.useScope('project:b', async () => []);
    expect(aiStore.suggestions.size).toBe(0);
    expect(aiStore.scan.phase).toBe('idle');
  });

  it('does nothing when the scope is unchanged', async () => {
    await aiStore.useScope('project:a', async () => [sug('a1')]);
    let loads = 0;
    await aiStore.useScope('project:a', async () => { loads++; return []; });
    expect(loads).toBe(0);
    expect(aiStore.suggestions.size).toBe(1);
  });

  it('ignores a late load for a scope the user already left', async () => {
    let finish: (v: AiSuggestion[]) => void = () => {};
    const slow = aiStore.useScope('project:a', () => new Promise(res => { finish = res; }));
    await aiStore.useScope('project:b', async () => []);
    finish([sug('a1')]);
    await slow;
    expect(aiStore.suggestions.size).toBe(0);
  });

  it('saves suggestions in batches while a scan runs and flushes the rest at the end', async () => {
    const saved: number[] = [];
    await aiStore.useScope('project:a');
    // The scan is started directly so no Tauri call is made.
    (aiStore as unknown as { scanScope: string | null; persist: unknown }).scanScope = 'project:a';
    (aiStore as unknown as { persist: (b: AiSuggestion[]) => Promise<void> }).persist = async b => { saved.push(b.length); };
    for (let i = 0; i < 120; i++) {
      aiStore.handleEvent({ type: 'suggestion', suggestion: sug(`f${i}`), done: i + 1, failed: 0 });
    }
    aiStore.handleEvent({ type: 'finished', total: 120, done: 120, failed: 0, cancelled: false });
    expect(saved).toEqual([50, 50, 20]);
  });

  it('ignores events from a scan that belongs to another scope', async () => {
    await aiStore.useScope('project:a');
    (aiStore as unknown as { scanScope: string | null }).scanScope = 'project:old';
    aiStore.handleEvent({ type: 'suggestion', suggestion: sug('x'), done: 1, failed: 0 });
    aiStore.handleEvent({ type: 'finished', total: 1, done: 1, failed: 0, cancelled: false });
    expect(aiStore.suggestions.size).toBe(0);
    expect(aiStore.scan.phase).toBe('idle');
  });
});

describe('aiStore install events', () => {
  beforeEach(() => {
    aiStore.install = { phase: 'installing', info: null, progress: null, message: '' };
  });

  it('follows progress to completion', () => {
    aiStore.handleInstallEvent({ type: 'progress', stage: 'downloading', file: 'Animal detector', fileIndex: 2, fileCount: 5, bytesDone: 10, bytesTotal: 100 });
    expect(aiStore.install.progress?.file).toBe('Animal detector');
    aiStore.handleInstallEvent({ type: 'done', dir: '/x' });
    expect(aiStore.install).toMatchObject({ phase: 'done', progress: null });
  });

  it('shows the friendly message when it fails', () => {
    aiStore.handleInstallEvent({ type: 'failed', message: 'Could not reach the download server.' });
    expect(aiStore.install).toMatchObject({ phase: 'error', message: 'Could not reach the download server.' });
  });

  it('returns to the offer when the user cancels', () => {
    aiStore.install = { phase: 'installing', info: { version: '1.0.0' } as never, progress: null, message: '' };
    aiStore.handleInstallEvent({ type: 'cancelled' });
    expect(aiStore.install.phase).toBe('offer');
  });
});

describe('aiStore removing the add-on', () => {
  it('reports a failure instead of pretending it worked (no desktop app to ask here)', async () => {
    aiStore.install = { phase: 'idle', info: null, progress: null, message: '' };
    await aiStore.removeAddOn();
    expect(aiStore.install.phase).toBe('error');
    expect(aiStore.install.message).not.toBe('');
  });

  it('will not start while a download is running', async () => {
    aiStore.install = { phase: 'installing', info: null, progress: null, message: '' };
    await aiStore.removeAddOn();
    expect(aiStore.install.phase).toBe('installing');
  });
});

describe('a folder remembered by an early test build', () => {
  it('is forgotten and never used', async () => {
    const saved = new Map<string, string>([['traaace_ai_pack_dir', 'C:\\Users\\you\\Documents\\old-pack']]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => saved.get(k) ?? null,
      setItem: (k: string, v: string) => void saved.set(k, v),
      removeItem: (k: string) => void saved.delete(k),
    });
    vi.resetModules();
    const { aiStore: fresh } = await import('./ai-store');
    expect(fresh.packDir).toBeNull();
    expect(saved.has('traaace_ai_pack_dir')).toBe(false);
    vi.unstubAllGlobals();
  });
});
