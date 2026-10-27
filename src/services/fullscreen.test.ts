import { describe, expect, it } from 'vitest';
import { toggleFullscreen } from './fullscreen';

describe('toggleFullscreen', () => {
  it('does nothing outside the desktop app', async () => {
    expect(await toggleFullscreen()).toBeNull();
  });
});
