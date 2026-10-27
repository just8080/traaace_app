import type { CommentDropdown } from './comment-dropdown';

export interface Keymap {
  keystrokes: string;
  species: string;
}

export interface KeyboardHost {
  hasItems(): boolean;
  getKeymaps(): Keymap[];
  /** Comment currently typed in the sidebar (or stored on the active photo). */
  getCurrentComment(): string;
  classify(species: string, comment?: string, count?: number): void;
  nextPhoto(): void;
  prevPhoto(): void;
  stepAnimalCount(delta: number): void;
  toggleViewMode(): void;
  focusCustomSpecies(): void;
}

/**
 * Window-level hotkeys for the classifier: navigation, count stepper, Empty, and the species
 * keymap including multi-keystroke sequences (e.g. 'P' for Possum vs 'PG' for Pig).
 * `root` is used to find the key-buffer indicator, which render() recreates.
 */
export class KeyboardController {
  private keyBuffer = '';
  private keyBufferTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingExactMatchSpecies: string | null = null;

  constructor(
    private readonly root: ParentNode,
    private readonly host: KeyboardHost,
    private readonly commentDropdown: CommentDropdown,
  ) {}

  attach(signal: AbortSignal | undefined): void {
    window.addEventListener('keydown', (e: KeyboardEvent) => this.handleKeydown(e), { signal });
  }

  /** Drops any partially typed sequence and any pending exact match. */
  clear(): void {
    if (this.keyBufferTimer) {
      clearTimeout(this.keyBufferTimer);
      this.keyBufferTimer = null;
    }
    this.keyBuffer = '';
    this.pendingExactMatchSpecies = null;
    this.updateIndicator();
  }

  /** Commits an exact match that was waiting to see if a longer sequence would follow. */
  private flushPendingExactMatch(): void {
    if (this.keyBufferTimer) {
      clearTimeout(this.keyBufferTimer);
      this.keyBufferTimer = null;
    }
    if (this.pendingExactMatchSpecies) {
      const sp = this.pendingExactMatchSpecies;
      this.clear();
      this.host.classify(sp);
    } else {
      this.clear();
    }
  }

  private updateIndicator(): void {
    const el = this.root.querySelector<HTMLElement>('#keyBufferIndicator');
    if (!el) return;
    if (this.keyBuffer) {
      el.textContent = `Key: ${this.keyBuffer}...`;
      el.style.display = 'inline-flex';
    } else {
      el.style.display = 'none';
      el.textContent = '';
    }
  }

  /**
   * Starts buffering `candidate` as the prefix of a longer sequence. If no second key arrives,
   * 'C' and 'G' fall back to their system actions (comments / grid toggle); anything else just expires.
   */
  private bufferPrefix(candidate: string): void {
    if (this.keyBufferTimer) clearTimeout(this.keyBufferTimer);
    this.keyBuffer = candidate;
    this.pendingExactMatchSpecies = null;
    this.updateIndicator();

    if (candidate === 'C') {
      this.keyBufferTimer = setTimeout(() => {
        this.clear();
        this.commentDropdown.open();
      }, 450);
    } else if (candidate === 'G') {
      this.keyBufferTimer = setTimeout(() => {
        this.clear();
        this.host.toggleViewMode();
      }, 450);
    } else {
      this.keyBufferTimer = setTimeout(() => {
        this.clear();
      }, 700);
    }
  }

  private handleKeydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    // Handle dropdown navigation inside sidebar comment input
    if (document.activeElement?.id === 'inputSidebarComment') {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.commentDropdown.close();
        (document.activeElement as HTMLElement)?.blur();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.commentDropdown.navigate(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.commentDropdown.navigate(-1);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        this.commentDropdown.applyHighlighted();
        return;
      }
      return; // Allow typing
    }

    if (isInputFocused) {
      return;
    }

    if (!this.host.hasItems()) return;

    // Ignore shortcuts when system modifier keys are held
    if (e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }

    // Escape: cancel pending key sequence or close dropdown
    if (e.key === 'Escape') {
      if (this.keyBuffer) {
        e.preventDefault();
        this.clear();
        return;
      }
      if (this.commentDropdown.isOpen) {
        e.preventDefault();
        this.commentDropdown.close();
        return;
      }
      return;
    }

    // Navigation: Arrows
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      this.flushPendingExactMatch();
      this.host.nextPhoto();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.flushPendingExactMatch();
      this.host.prevPhoto();
      return;
    }

    // Animal Count Stepper +/- Keys
    if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
      e.preventDefault();
      this.flushPendingExactMatch();
      this.host.stepAnimalCount(1);
      return;
    }
    if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
      e.preventDefault();
      this.flushPendingExactMatch();
      this.host.stepAnimalCount(-1);
      return;
    }

    // Space key or 0 / Numpad0 for Empty
    if (e.code === 'Space' || e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') {
      e.preventDefault();
      this.flushPendingExactMatch();
      this.host.classify('Empty', this.host.getCurrentComment(), 1);
      return;
    }

    // Type species shortcut: /
    if (e.key === '/') {
      e.preventDefault();
      this.flushPendingExactMatch();
      this.host.focusCustomSpecies();
      return;
    }

    // Dedicated Slot 1-9 via Number Row (Digit1-Digit9) or Numpad (Numpad1-Numpad9)
    if ((e.code && /^Numpad[1-9]$/.test(e.code)) || (e.code && /^Digit[1-9]$/.test(e.code))) {
      const slotIdx = parseInt((e.code || '').replace(/^(Numpad|Digit)/, ''), 10) - 1;
      this.flushPendingExactMatch();
      const keymaps = this.host.getKeymaps();
      if (slotIdx >= 0 && slotIdx < keymaps.length && slotIdx < 9) {
        e.preventDefault();
        this.host.classify(keymaps[slotIdx].species);
        return;
      }
    }

    // Character handling (Single-key or Multi-keystroke sequence matching)
    if (e.key.length === 1) {
      this.handleCharacter(e, e.key.toUpperCase());
    }
  }

  private handleCharacter(e: KeyboardEvent, char: string): void {
    const keymaps = this.host.getKeymaps();
    const candidate = this.keyBuffer + char;

    const exactMatch = keymaps.find(k => k.keystrokes.toUpperCase() === candidate);
    const hasPrefixMatch = keymaps.some(
      k => k.keystrokes.toUpperCase().startsWith(candidate) && k.keystrokes.length > candidate.length
    );

    if (hasPrefixMatch && !exactMatch) {
      // In the middle of typing a multi-key sequence (e.g. 'P' when 'PG' exists, or 'T' when 'TU' exists)
      e.preventDefault();
      this.bufferPrefix(candidate);
      return;
    }

    if (exactMatch && !hasPrefixMatch) {
      // Completed unambiguous shortcut (e.g. 'PG' for Pig, or 'TU' for Tui)
      e.preventDefault();
      const targetSpecies = exactMatch.species;
      this.clear();
      this.host.classify(targetSpecies);
      return;
    }

    if (exactMatch && hasPrefixMatch) {
      // Both exact match and longer prefix exist (e.g. 'P' for Possum vs 'PG' for Pig)
      e.preventDefault();
      if (this.keyBufferTimer) clearTimeout(this.keyBufferTimer);
      this.keyBuffer = candidate;
      this.pendingExactMatchSpecies = exactMatch.species;
      this.updateIndicator();

      this.keyBufferTimer = setTimeout(() => {
        if (this.pendingExactMatchSpecies) {
          const sp = this.pendingExactMatchSpecies;
          this.clear();
          this.host.classify(sp);
        } else {
          this.clear();
        }
      }, 400);
      return;
    }

    // Neither exact nor prefix match with the accumulated buffer
    if (this.keyBuffer.length > 0) {
      // Buffer combination didn't match anything. Clear and re-evaluate this char as start of new sequence.
      this.clear();
      const singleExact = keymaps.find(k => k.keystrokes.toUpperCase() === char);
      const singlePrefix = keymaps.some(
        k => k.keystrokes.toUpperCase().startsWith(char) && k.keystrokes.length > char.length
      );

      if (singlePrefix && !singleExact) {
        e.preventDefault();
        this.bufferPrefix(char);
        return;
      }

      if (singleExact) {
        e.preventDefault();
        const sp = singleExact.species;
        this.clear();
        this.host.classify(sp);
        return;
      }
    }

    // Standalone system keys if no species shortcut consumed them:
    if (char === 'G') {
      e.preventDefault();
      this.host.toggleViewMode();
      return;
    }

    if (char === 'C') {
      e.preventDefault();
      this.commentDropdown.open();
      return;
    }

    // Numeric key 1-9 fallback
    if (/^[1-9]$/.test(char)) {
      const slot = parseInt(char, 10) - 1;
      if (slot < keymaps.length && slot < 9) {
        e.preventDefault();
        this.host.classify(keymaps[slot].species);
      }
    }
  }
}
