import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clampAdvanceDelay, DelayedAdvance, MAX_ADVANCE_DELAY_MS } from './advance-delay';

describe('clampAdvanceDelay', () => {
  it('keeps values inside 0..max and rounds', () => {
    expect(clampAdvanceDelay(-5)).toBe(0);
    expect(clampAdvanceDelay(1234.6)).toBe(1235);
    expect(clampAdvanceDelay(999999)).toBe(MAX_ADVANCE_DELAY_MS);
    expect(clampAdvanceDelay(NaN)).toBe(0);
  });
});

describe('DelayedAdvance', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('runs the action after the delay', () => {
    const d = new DelayedAdvance();
    const fn = vi.fn();
    d.schedule(fn, 500);
    expect(d.pending).toBe(true);
    vi.advanceTimersByTime(499);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(d.pending).toBe(false);
  });

  it('touch restarts the wait while pending and is a no-op otherwise', () => {
    const d = new DelayedAdvance();
    const fn = vi.fn();
    d.touch();
    expect(d.pending).toBe(false);
    d.schedule(fn, 500);
    vi.advanceTimersByTime(400);
    d.touch();
    vi.advanceTimersByTime(400);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('scheduling again replaces the earlier action and cancel stops it', () => {
    const d = new DelayedAdvance();
    const first = vi.fn();
    const second = vi.fn();
    d.schedule(first, 500);
    d.schedule(second, 500);
    vi.advanceTimersByTime(500);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    d.schedule(first, 500);
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
  });
});
