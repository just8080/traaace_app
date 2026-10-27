import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardController, type KeyboardHost } from './keyboard';
import type { CommentDropdown } from './comment-dropdown';

type KeyInit = { key: string; code?: string; target?: object; metaKey?: boolean };

const KEYMAPS = [
  { keystrokes: 'P', species: 'Possum' },
  { keystrokes: 'PG', species: 'Pig' },
  { keystrokes: 'T', species: 'Tui' },
  { keystrokes: 'TU', species: 'Turkey' },
  { keystrokes: 'R', species: 'Rabbit' },
  { keystrokes: 'C', species: 'Cat' },
];

function setup(keymaps = KEYMAPS) {
  let handler: (e: KeyboardEvent) => void = () => {};
  vi.stubGlobal('window', { addEventListener: (_: string, fn: typeof handler) => { handler = fn; } });
  const doc = { activeElement: null as null | { id: string; blur: () => void } };
  vi.stubGlobal('document', doc);

  const host = {
    hasItems: vi.fn(() => true),
    getKeymaps: vi.fn(() => keymaps),
    getCurrentComment: vi.fn(() => 'note'),
    classify: vi.fn(),
    nextPhoto: vi.fn(),
    prevPhoto: vi.fn(),
    stepAnimalCount: vi.fn(),
    toggleViewMode: vi.fn(),
    focusCustomSpecies: vi.fn(),
  } satisfies KeyboardHost;
  const dropdown = {
    isOpen: false,
    open: vi.fn(),
    close: vi.fn(),
    navigate: vi.fn(),
    applyHighlighted: vi.fn(),
  };
  const indicator = { textContent: '', style: { display: 'none' } };
  const root = { querySelector: () => indicator };

  const kb = new KeyboardController(root as unknown as ParentNode, host, dropdown as unknown as CommentDropdown);
  kb.attach(undefined);

  const press = (init: KeyInit) => {
    const preventDefault = vi.fn();
    handler({ code: '', metaKey: false, ctrlKey: false, altKey: false, target: { tagName: 'BODY' }, ...init, preventDefault } as unknown as KeyboardEvent);
    return preventDefault;
  };
  return { kb, host, dropdown, indicator, doc, press };
}

describe('KeyboardController', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('classifies an unambiguous single key immediately', () => {
    const { host, press } = setup();
    press({ key: 'r' });
    expect(host.classify).toHaveBeenCalledWith('Rabbit');
  });

  it('completes a two-key sequence', () => {
    const { host, press, indicator } = setup();
    press({ key: 'p' });
    // 'P' is both Possum and a prefix of 'PG', so it waits
    expect(host.classify).not.toHaveBeenCalled();
    expect(indicator.textContent).toBe('Key: P...');
    press({ key: 'g' });
    expect(host.classify).toHaveBeenCalledWith('Pig');
    expect(indicator.style.display).toBe('none');
  });

  it('commits the exact match after the timeout when no second key arrives', () => {
    const { host, press } = setup();
    press({ key: 'p' });
    vi.advanceTimersByTime(399);
    expect(host.classify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(host.classify).toHaveBeenCalledWith('Possum');
  });

  it('flushes a pending exact match before navigating', () => {
    const { host, press } = setup();
    press({ key: 'p' });
    press({ key: 'ArrowRight' });
    expect(host.classify).toHaveBeenCalledWith('Possum');
    expect(host.nextPhoto).toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(host.classify).toHaveBeenCalledTimes(1);
  });

  it('restarts matching when the buffered combination fails', () => {
    const { host, press } = setup();
    press({ key: 'p' });
    press({ key: 'r' }); // 'PR' matches nothing; 'R' is Rabbit
    expect(host.classify).toHaveBeenCalledWith('Rabbit');
  });

  it('escape clears a pending sequence without classifying', () => {
    const { host, press, indicator } = setup();
    press({ key: 'p' });
    press({ key: 'Escape' });
    vi.advanceTimersByTime(1000);
    expect(host.classify).not.toHaveBeenCalled();
    expect(indicator.style.display).toBe('none');
  });

  it('G toggles the view and C opens comments when no species uses them', () => {
    const { host, dropdown, press } = setup([{ keystrokes: 'R', species: 'Rabbit' }]);
    press({ key: 'g' });
    expect(host.toggleViewMode).toHaveBeenCalledTimes(1);
    press({ key: 'c' });
    expect(dropdown.open).toHaveBeenCalledTimes(1);
  });

  it('C falls back to the comment dropdown after the delay when it prefixes a species', () => {
    const { host, dropdown, press } = setup([{ keystrokes: 'CT', species: 'Cattle' }]);
    press({ key: 'c' });
    expect(dropdown.open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(450);
    expect(dropdown.open).toHaveBeenCalledTimes(1);
    expect(host.classify).not.toHaveBeenCalled();
  });

  it('space classifies Empty with the current comment and count 1', () => {
    const { host, press } = setup();
    press({ key: ' ', code: 'Space' });
    expect(host.classify).toHaveBeenCalledWith('Empty', 'note', 1);
  });

  it('digit keys map to keymap slots', () => {
    const { host, press } = setup();
    press({ key: '2', code: 'Digit2' });
    expect(host.classify).toHaveBeenCalledWith('Pig');
  });

  it('ignores keys while typing in an input or with modifiers held', () => {
    const { host, press } = setup();
    press({ key: 'r', target: { tagName: 'INPUT' } });
    press({ key: 'r', metaKey: true });
    expect(host.classify).not.toHaveBeenCalled();
  });

  it('routes keys to the comment dropdown while the comment input is focused', () => {
    const { dropdown, host, doc, press } = setup();
    doc.activeElement = { id: 'inputSidebarComment', blur: vi.fn() };
    press({ key: 'ArrowDown', target: { tagName: 'INPUT' } });
    press({ key: 'Enter', target: { tagName: 'INPUT' } });
    expect(dropdown.navigate).toHaveBeenCalledWith(1);
    expect(dropdown.applyHighlighted).toHaveBeenCalled();
    expect(host.nextPhoto).not.toHaveBeenCalled();
  });
});
