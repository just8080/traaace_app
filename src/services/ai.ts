import type { AiSuggestion } from '../ipc-types';

/** Same defaults as the Rust side (ai/mod.rs): the classifier's 0.5 is not final, so the reviewer can change it. */
export const DEFAULT_AI_THRESHOLD = 0.5;
export const DETECTOR_EMPTY_THRESHOLD = 0.15;
export const AI_EMPTY_SPECIES = 'Empty';

export type AiReview =
  | { kind: 'species'; species: string; score: number; count: number }
  | { kind: 'unknown'; species: null; score: number; count: number }
  | { kind: 'empty'; species: null; score: 0; count: number };

/**
 * Decides what a suggestion means at a given confidence threshold: a species when the classifier is sure enough,
 * "unknown" when the detector saw an animal but the classifier is not, "empty" when neither is.
 */
export function reviewSuggestion(s: AiSuggestion, threshold: number): AiReview {
  const [best, score] = s.alternatives[0] ?? [null, 0];
  if (best && score >= threshold) return { kind: 'species', species: best, score, count: Math.max(s.animals, 1) };
  if (s.detectorConfidence > DETECTOR_EMPTY_THRESHOLD) return { kind: 'unknown', species: null, score, count: s.animals };
  return { kind: 'empty', species: null, score: 0, count: 0 };
}

/** What to tag the photo with when the suggestion is accepted, or null when there is nothing to accept (unknown). */
export function acceptedTag(review: AiReview): { species: string; count: number } | null {
  if (review.kind === 'species') return { species: review.species, count: review.count };
  if (review.kind === 'empty') return { species: AI_EMPTY_SPECIES, count: 1 };
  return null;
}

export function confidenceLevel(score: number): 'high' | 'medium' | 'low' {
  return score >= 0.8 ? 'high' : score >= 0.5 ? 'medium' : 'low';
}

export function formatPercent(score: number): string {
  return `${Math.round(score * 100)}%`;
}

const PHOTO = /\.(jpe?g|png|webp)$/i;
/** The video types the AI's video tool reads (the same list as the Rust side's `video::is_video`). */
const VIDEO = /\.(mp4|mov|avi|mkv)$/i;

export function isAiPhoto(fileName: string): boolean {
  return PHOTO.test(fileName);
}

export function isAiVideo(fileName: string): boolean {
  return VIDEO.test(fileName);
}

/** Photos always; videos only when the add-on has the video tool. */
export function isAiScannable(fileName: string, videos = false): boolean {
  return isAiPhoto(fileName) || (videos && isAiVideo(fileName));
}

export function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AI_THRESHOLD;
  return Math.min(Math.max(Math.round(value * 100) / 100, 0.05), 0.95);
}

/** "511 MB", "1.2 GB": sizes the way people say them. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 MB';
  const mb = bytes / 1048576;
  if (mb >= 1000) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  return `${Math.max(mb, 0.1).toFixed(1)} MB`;
}

export function percentDone(done: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
}

/** The line shown while the add-on downloads. */
export function installStatusText(p: { stage: string; file: string; fileIndex: number; fileCount: number }): string {
  if (p.stage === 'installing') return 'Finishing up…';
  return `Downloading ${p.file} (${p.fileIndex} of ${p.fileCount})`;
}
