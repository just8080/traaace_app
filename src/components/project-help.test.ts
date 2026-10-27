import { describe, expect, it } from 'vitest';
import guide from './project-help.ts?raw';
import dbSource from '../../src-tauri/src/db.rs?raw';
import exportSource from '../../src-tauri/src/export.rs?raw';
import keymapSource from './project-keymap.ts?raw';
import batchesSource from './project-batches.ts?raw';
import quickSource from './quick-workspace.ts?raw';
import aiPanelSource from './ai-panel.ts?raw';
import aiSetupSource from './ai-setup-modal.ts?raw';

/** The guide quotes labels and lists from the app. These checks fail when the app changes and the guide does not. */
describe('the Guide matches the app', () => {
  const defaultComments = [...dbSource.matchAll(/fn reset_default_comments[\s\S]*?let defaults = \[([\s\S]*?)\];/g)][0][1]
    .split('\n')
    .map(line => line.match(/"([^"]+)"/)?.[1])
    .filter((c): c is string => Boolean(c));

  it('lists the starter comments the app really has', () => {
    expect(defaultComments.length).toBeGreaterThan(3);
    for (const comment of defaultComments) expect(guide).toContain(comment);
  });

  it('lists the spreadsheet columns the export really writes', () => {
    const headers = exportSource.match(/let headers = \[([\s\S]*?)\];/)![1].match(/"([^"]+)"/g)!.map(h => h.replace(/"/g, ''));
    expect(headers).toContain('Media Type');
    expect(guide).toContain(headers.join(', '));
  });

  it('uses the button names that are on screen', () => {
    expect(keymapSource).toContain('Add Keymap / Species');
    expect(guide).toContain('Add Keymap / Species');
    expect(keymapSource).toContain('Reset Keys to Defaults');
    expect(guide).toContain('Reset Keys to Defaults');
    expect(keymapSource).toContain('Add Comment Preset');
    expect(guide).toContain('Add Comment Preset');
    expect(batchesSource).toContain('Export Selected');
    expect(guide).toContain('Export Selected');
    expect(quickSource).toContain('Start Quick Classify');
    expect(guide).toContain('Start Quick Classify');
  });

  it('uses the AI buttons that are on screen', () => {
    for (const label of ['Set up AI…', 'Accept']) {
      expect(aiPanelSource).toContain(label);
      expect(guide).toContain(label);
    }
    expect(aiPanelSource).toContain('with AI');
    expect(guide).toContain('with AI');
    expect(aiSetupSource).toContain('Remove the add-on…');
    expect(guide).toContain('Remove the add-on…');
    expect(aiPanelSource).toContain('Intel Macs');
    expect(guide).toContain('Intel Macs');
  });

  it('names the folder labels the Projects tab shows', () => {
    for (const label of ['Unclassified', 'In Progress', 'Archived', 'Exported']) {
      expect(batchesSource).toContain(label);
      expect(guide).toContain(label);
    }
  });

  it('avoids the jargon the old guide used', () => {
    for (const word of ['SHA-256', 'hardlink', 'SQLite', 'Ecological Intelligence', 'Diel']) {
      expect(guide).not.toContain(word);
    }
  });
});
