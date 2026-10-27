import { icon } from '../../services/icons';
import { escapeHtml, formatClock, canPreviewVideo, isVideoFile } from '../../utils';

export type ViewerMediaKind = 'image' | 'video' | 'unsupported';

const MEDIA_STYLE =
  'transform-origin: center center; transition: transform 0.05s ease-out; max-width: 100%; max-height: 100%; object-fit: contain; user-select: none;';

export function viewerMediaKind(fileName: string): ViewerMediaKind {
  if (!isVideoFile(fileName)) return 'image';
  return canPreviewVideo(fileName) ? 'video' : 'unsupported';
}

/**
 * Markup for the main viewer media. The element always has id `mainViewerImg` (the zoom/pan
 * controller transforms it) and a `data-kind` so the view can tell when it has to be swapped.
 *
 * Videos are real <video> elements that load only their first frame and wait for the user to
 * press play; an <img> pointing at a video file plays it as a silent endless loop and decodes it
 * the whole time, which is slow and memory hungry.
 */
export function viewerMediaHtml(src: string, fileName: string): string {
  const kind = viewerMediaKind(fileName);

  if (kind === 'image') {
    return `<img id="mainViewerImg" data-kind="image" class="viewer-main-img" src="${escapeHtml(src)}" alt="${escapeHtml(fileName)}"
      style="${MEDIA_STYLE}" draggable="false" />`;
  }

  if (kind === 'unsupported') {
    const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    return `<div id="mainViewerImg" data-kind="unsupported" class="viewer-main-img video-unsupported">
      <span class="video-unsupported-icon">${icon('video', { size: 40 })}</span>
      <strong>${escapeHtml(fileName)}</strong>
      <span>${escapeHtml(ext)} videos can't be previewed here. You can still classify and export this file.</span>
    </div>`;
  }

  return `<video id="mainViewerImg" data-kind="video" class="viewer-main-img viewer-main-video" src="${escapeHtml(src)}#t=0.1"
      preload="metadata" muted playsinline disablepictureinpicture disableremoteplayback
      style="${MEDIA_STYLE}"></video>
    <div class="video-ui" id="videoUi">
      <button type="button" class="video-play-overlay" id="videoPlayOverlay" aria-label="Play video" title="Play / pause">
        ${icon('play', { size: 34 })}
      </button>
      <div class="video-bar">
        <button type="button" class="btn-ghost video-btn" id="videoPlayBtn" aria-label="Play / pause">${icon('play', { size: 14 })}</button>
        <span class="video-time" id="videoTime">0:00</span>
        <input type="range" class="video-scrubber" id="videoScrubber" min="0" max="1000" step="1" value="0" aria-label="Seek" />
        <span class="video-time" id="videoDuration">0:00</span>
        <button type="button" class="btn-ghost video-btn" id="videoMuteBtn" aria-label="Mute / unmute" title="Mute / unmute">${icon('volume-off', { size: 14 })}</button>
      </div>
      <div class="video-notice" id="videoNotice" hidden>This video couldn't be played. You can still classify it.</div>
    </div>`;
}

/**
 * Play/pause, seek and mute for the viewer's <video>. It never loops: it plays once and shows a
 * replay button at the end. Call `release()` before the video element or its source is replaced
 * (frees its decoder and buffers), then `bind()` once the new markup is in place.
 */
export class VideoControls {
  private video: HTMLVideoElement | null = null;
  private abort: AbortController | null = null;

  constructor(private readonly root: ParentNode) {}

  bind(): void {
    this.unbind();
    const video = this.root.querySelector<HTMLVideoElement>('video#mainViewerImg');
    const ui = this.root.querySelector<HTMLElement>('#videoUi');
    if (!video || !ui) return;

    this.video = video;
    this.abort = new AbortController();
    const { signal } = this.abort;

    const q = <T extends HTMLElement>(id: string): T | null => ui.querySelector<T>(`#${id}`);
    const overlay = q<HTMLButtonElement>('videoPlayOverlay');
    const playBtn = q<HTMLButtonElement>('videoPlayBtn');
    const muteBtn = q<HTMLButtonElement>('videoMuteBtn');
    const scrubber = q<HTMLInputElement>('videoScrubber');
    const timeEl = q<HTMLElement>('videoTime');
    const durationEl = q<HTMLElement>('videoDuration');
    const notice = q<HTMLElement>('videoNotice');
    let scrubbing = false;

    const setPlaying = (playing: boolean): void => {
      ui.classList.toggle('is-playing', playing);
      const name = playing ? 'pause' : 'play';
      if (playBtn) playBtn.innerHTML = icon(name, { size: 14 });
      if (overlay) overlay.innerHTML = icon('play', { size: 34 });
    };

    const syncProgress = (): void => {
      const duration = video.duration;
      const ratio = Number.isFinite(duration) && duration > 0 ? video.currentTime / duration : 0;
      if (timeEl) timeEl.textContent = formatClock(video.currentTime);
      if (scrubber && !scrubbing) {
        scrubber.value = String(Math.round(ratio * 1000));
        scrubber.style.setProperty('--pct', `${ratio * 100}%`);
      }
    };

    const syncMute = (): void => {
      if (muteBtn) muteBtn.innerHTML = icon(video.muted ? 'volume-off' : 'volume', { size: 14 });
    };

    const toggle = (): void => {
      if (video.ended) video.currentTime = 0;
      if (video.paused) {
        video.play().catch(() => { /* blocked or failed: the error event shows a notice */ });
      } else {
        video.pause();
      }
    };

    video.addEventListener('play', () => { ui.classList.remove('is-ended'); setPlaying(true); }, { signal });
    video.addEventListener('pause', () => setPlaying(false), { signal });
    video.addEventListener('ended', () => { ui.classList.add('is-ended'); setPlaying(false); }, { signal });
    video.addEventListener('timeupdate', syncProgress, { signal });
    video.addEventListener('loadedmetadata', () => {
      if (durationEl) durationEl.textContent = formatClock(video.duration);
      syncProgress();
    }, { signal });
    video.addEventListener('error', () => { if (notice) notice.hidden = false; }, { signal });

    // Clicking the picture toggles playback, but a drag (panning a zoomed video) must not.
    let downX = 0;
    let downY = 0;
    video.addEventListener('mousedown', (e: MouseEvent) => { downX = e.clientX; downY = e.clientY; }, { signal });
    video.addEventListener('click', (e: MouseEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) < 5) toggle();
    }, { signal });

    // Buttons give up focus afterwards so Space still reaches the species hotkeys.
    const press = (btn: HTMLButtonElement | null, action: () => void): void => {
      btn?.addEventListener('click', (e) => { e.stopPropagation(); action(); btn.blur(); }, { signal });
    };
    press(overlay, toggle);
    press(playBtn, toggle);
    press(muteBtn, () => { video.muted = !video.muted; syncMute(); });

    scrubber?.addEventListener('input', () => {
      scrubbing = true;
      const duration = video.duration;
      if (Number.isFinite(duration) && duration > 0) {
        video.currentTime = (Number(scrubber.value) / 1000) * duration;
        scrubber.style.setProperty('--pct', `${Number(scrubber.value) / 10}%`);
        if (timeEl) timeEl.textContent = formatClock(video.currentTime);
      }
    }, { signal });
    scrubber?.addEventListener('change', () => {
      scrubbing = false;
      scrubber.blur();
    }, { signal });

    setPlaying(false);
    syncMute();
  }

  /** Removes the listeners without touching the video. */
  private unbind(): void {
    this.abort?.abort();
    this.abort = null;
  }

  /** Stops playback and frees the decoder and buffers of the current video. */
  release(): void {
    this.unbind();
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
      this.video = null;
    }
  }
}
