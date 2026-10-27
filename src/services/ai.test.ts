import { describe, expect, it } from 'vitest';
import type { AiSuggestion } from '../ipc-types';
import {
  acceptedTag, clampThreshold, confidenceLevel, DEFAULT_AI_THRESHOLD, formatBytes, formatPercent, installStatusText, isAiScannable,
  percentDone, reviewSuggestion,
} from './ai';

const suggestion = (score: number, detector = 0.9, animals = 1): AiSuggestion => ({
  id: 'a',
  alternatives: [['Kererū', score], ['Tūī', 0.2], ['Kea', 0.1]],
  detectorConfidence: detector,
  animals,
});

describe('reviewSuggestion', () => {
  it('names the species when the classifier clears the threshold', () => {
    expect(reviewSuggestion(suggestion(0.93, 0.9, 2), 0.5)).toEqual({ kind: 'species', species: 'Kererū', score: 0.93, count: 2 });
  });

  it('counts at least one animal for a named species', () => {
    expect(reviewSuggestion(suggestion(0.93, 0.9, 0), 0.5)).toMatchObject({ kind: 'species', count: 1 });
  });

  it('is unknown when an animal was seen but the classifier is unsure', () => {
    expect(reviewSuggestion(suggestion(0.4, 0.9, 2), 0.5)).toEqual({ kind: 'unknown', species: null, score: 0.4, count: 2 });
  });

  it('is empty when neither model is convinced', () => {
    expect(reviewSuggestion(suggestion(0.1, 0.05, 0), 0.5)).toEqual({ kind: 'empty', species: null, score: 0, count: 0 });
    expect(reviewSuggestion(suggestion(0.1, -1, 0), 0.5).kind).toBe('empty');
  });

  it('follows the threshold without a rescan', () => {
    const s = suggestion(0.6);
    expect(reviewSuggestion(s, 0.5).kind).toBe('species');
    expect(reviewSuggestion(s, 0.7).kind).toBe('unknown');
  });

  it('copes with no alternatives', () => {
    expect(reviewSuggestion({ id: 'a', alternatives: [], detectorConfidence: -1, animals: 0 }, 0.5).kind).toBe('empty');
  });
});

describe('acceptedTag', () => {
  it('tags species with the estimated count, empty photos as Empty, and refuses unknown', () => {
    expect(acceptedTag(reviewSuggestion(suggestion(0.9, 0.9, 3), 0.5))).toEqual({ species: 'Kererū', count: 3 });
    expect(acceptedTag(reviewSuggestion(suggestion(0.1, 0, 0), 0.5))).toEqual({ species: 'Empty', count: 1 });
    expect(acceptedTag(reviewSuggestion(suggestion(0.3, 0.9, 1), 0.5))).toBeNull();
  });
});

describe('helpers', () => {
  it('grades confidence', () => {
    expect([0.95, 0.8, 0.6, 0.5, 0.2].map(confidenceLevel)).toEqual(['high', 'high', 'medium', 'medium', 'low']);
  });

  it('formats percentages', () => {
    expect(formatPercent(0.934)).toBe('93%');
    expect(formatPercent(1)).toBe('100%');
  });

  it('scans photos only', () => {
    expect(['a.JPG', 'b.jpeg', 'c.png', 'd.webp'].every(f => isAiScannable(f))).toBe(true);
    expect(['a.mp4', 'b.mov', 'c.csv', 'jpg'].some(f => isAiScannable(f))).toBe(false);
    // With the video tool, videos are scanned too (but still not other files).
    expect(['a.mp4', 'b.MOV', 'c.avi', 'd.mkv'].every(f => isAiScannable(f, true))).toBe(true);
    expect(['c.csv', 'e.txt'].some(f => isAiScannable(f, true))).toBe(false);
  });

  it('keeps the threshold in a usable range', () => {
    expect(clampThreshold(0)).toBe(0.05);
    expect(clampThreshold(2)).toBe(0.95);
    expect(clampThreshold(0.555)).toBe(0.56);
    expect(clampThreshold(NaN)).toBe(DEFAULT_AI_THRESHOLD);
  });
});

describe('install wording', () => {
  it('formats sizes the way people say them', () => {
    expect(formatBytes(536_870_912)).toBe('512 MB');
    expect(formatBytes(5 * 1048576)).toBe('5.0 MB');
    expect(formatBytes(1_288_490_189)).toBe('1.2 GB');
    expect(formatBytes(0)).toBe('0.1 MB');
    expect(formatBytes(NaN)).toBe('0 MB');
  });

  it('works out a percentage without going past 100', () => {
    expect(percentDone(50, 200)).toBe(25);
    expect(percentDone(300, 200)).toBe(100);
    expect(percentDone(5, 0)).toBe(0);
  });

  it('says what is happening', () => {
    expect(installStatusText({ stage: 'downloading', file: 'Animal detector', fileIndex: 2, fileCount: 5 })).toBe('Downloading Animal detector (2 of 5)');
    expect(installStatusText({ stage: 'installing', file: '', fileIndex: 5, fileCount: 5 })).toBe('Finishing up…');
  });
});
