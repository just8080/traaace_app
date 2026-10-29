/**
 * Grabs one frame of a video in the web view, for grid thumbnails when the AI add-on's video tool isn't installed.
 * Only works for formats the web view can play; the Mac's web view "plays" AVI as a black picture, which is caught here.
 */

/** Longest side of the grabbed picture, matching the photo thumbnails. */
const THUMB_SIZE = 320;
/** Videos grabbed at the same time; each one holds a video decoder while it loads. */
const MAX_AT_ONCE = 2;
/** Give up on a video that hasn't given a frame by then. */
const TIMEOUT_MS = 8000;

/** The moment to grab: a second in, or halfway through a shorter clip. */
export const frameTime = (duration: number): number =>
  Number.isFinite(duration) && duration > 0 ? Math.min(1, duration / 2) : 0;

/** True when a frame is (nearly) all black, which is what the web view gives for a video it cannot decode. */
export const isBlankFrame = (rgba: Uint8ClampedArray): boolean => {
  let brightest = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    brightest = Math.max(brightest, rgba[i], rgba[i + 1], rgba[i + 2]);
    if (brightest > 8) return false;
  }
  return true;
};

let running = 0;
const waiting: Array<() => void> = [];

/** Runs `task` once fewer than `MAX_AT_ONCE` others are running. */
export async function withinLimit<T>(task: () => Promise<T>, limit = MAX_AT_ONCE): Promise<T> {
  if (running >= limit) await new Promise<void>(resolve => waiting.push(resolve));
  running++;
  try {
    return await task();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** A JPEG of one frame of the video at `src`, or null when no frame could be read. */
export function grabVideoFrame(src: string): Promise<Blob | null> {
  return withinLimit(() => new Promise<Blob | null>(resolve => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    // Lets the canvas read the pixels; the app's asset address allows its own window
    video.crossOrigin = 'anonymous';

    let settled = false;
    const finish = (frame: Blob | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load(); // releases the decoder
      resolve(frame);
    };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);

    video.onerror = () => finish(null);
    video.onloadeddata = () => { video.currentTime = frameTime(video.duration); };
    video.onseeked = () => {
      try {
        const scale = Math.min(1, THUMB_SIZE / Math.max(video.videoWidth, video.videoHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return finish(null);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (isBlankFrame(ctx.getImageData(0, 0, canvas.width, canvas.height).data)) return finish(null);
        canvas.toBlob(blob => finish(blob), 'image/jpeg', 0.85);
      } catch {
        finish(null); // e.g. a canvas the web view won't let us read
      }
    };
    video.src = src;
  }));
}
