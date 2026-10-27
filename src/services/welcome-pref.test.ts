import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShowWelcomeOnStartup, setShowWelcomeOnStartup } from './welcome-pref';

describe('welcome-pref', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows the welcome screen by default', () => {
    expect(getShowWelcomeOnStartup()).toBe(true);
  });

  it('remembers turning it off and back on', () => {
    setShowWelcomeOnStartup(false);
    expect(getShowWelcomeOnStartup()).toBe(false);
    setShowWelcomeOnStartup(true);
    expect(getShowWelcomeOnStartup()).toBe(true);
  });

  it('keeps the existing storage key so earlier dismissals still apply', () => {
    localStorage.setItem('traaace_welcome_dismissed', 'true');
    expect(getShowWelcomeOnStartup()).toBe(false);
  });

  it('defaults to showing when storage throws', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); } });
    expect(getShowWelcomeOnStartup()).toBe(true);
  });
});
