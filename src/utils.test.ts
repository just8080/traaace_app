import { describe, it, expect } from 'vitest';
import { html, escapeHtml, css, isVideoFile, canPreviewVideo, formatClock } from './utils';

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;'
    );
  });

  it('returns an empty string for null and undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('stringifies non-string values, keeping 0 and false', () => {
    expect(escapeHtml(0)).toBe('0');
    expect(escapeHtml(false)).toBe('false');
  });

  it('does not double-escape plain text', () => {
    expect(escapeHtml('Red fox 12')).toBe('Red fox 12');
  });
});

describe('html', () => {
  it('interpolates values', () => {
    expect(html`<b>${'x'}</b>`).toBe('<b>x</b>');
  });

  it('renders null, undefined and false as empty strings', () => {
    expect(html`a${null}b${undefined}c${false}d`).toBe('abcd');
  });

  it('joins arrays without commas', () => {
    expect(html`<ul>${['<li>1</li>', '<li>2</li>']}</ul>`).toBe('<ul><li>1</li><li>2</li></ul>');
  });

  it('does not escape interpolations (callers must use escapeHtml)', () => {
    expect(html`${'<i>'}`).toBe('<i>');
    expect(html`${escapeHtml('<i>')}`).toBe('&lt;i&gt;');
  });
});

describe('css', () => {
  it('interpolates values into the template', () => {
    expect(css`a{width:${10}px}`).toBe('a{width:10px}');
  });
});

describe('video helpers', () => {
  it('detects video files by extension, case-insensitively', () => {
    expect(isVideoFile('clip.mp4')).toBe(true);
    expect(isVideoFile('CLIP.MOV')).toBe(true);
    expect(isVideoFile('old.avi')).toBe(true);
    expect(isVideoFile('photo.jpg')).toBe(false);
    expect(isVideoFile('mp4')).toBe(false);
    expect(isVideoFile('')).toBe(false);
  });

  it('flags containers the webview cannot preview', () => {
    expect(canPreviewVideo('clip.mp4')).toBe(true);
    expect(canPreviewVideo('clip.mov')).toBe(true);
    expect(canPreviewVideo('old.AVI')).toBe(false);
    expect(canPreviewVideo('x.mkv')).toBe(false);
  });

  it('formats playback time as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9.9)).toBe('0:09');
    expect(formatClock(75)).toBe('1:15');
    expect(formatClock(NaN)).toBe('0:00');
    expect(formatClock(-3)).toBe('0:00');
  });
});

