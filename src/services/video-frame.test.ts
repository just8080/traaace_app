import { describe, expect, it } from 'vitest';
import { frameTime, isBlankFrame, withinLimit } from './video-frame';

describe('video frame grabbing', () => {
  it('grabs a second in, or halfway through a short clip', () => {
    expect(frameTime(30)).toBe(1);
    expect(frameTime(1)).toBe(0.5);
    expect(frameTime(NaN)).toBe(0);
    expect(frameTime(Infinity)).toBe(0);
  });

  it('treats an all-black frame as unreadable, but not a dark night shot', () => {
    expect(isBlankFrame(new Uint8ClampedArray([0, 0, 0, 255, 3, 2, 1, 255]))).toBe(true);
    expect(isBlankFrame(new Uint8ClampedArray([0, 0, 0, 255, 30, 30, 30, 255]))).toBe(false);
  });

  it('runs no more than the limit at once', async () => {
    let now = 0;
    let most = 0;
    const task = () => withinLimit(async () => {
      most = Math.max(most, ++now);
      await new Promise(r => setTimeout(r, 5));
      now--;
    }, 2);
    await Promise.all([task(), task(), task(), task(), task()]);
    expect(most).toBe(2);
  });
});
