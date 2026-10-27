const STORAGE_KEY = 'traaace_classifier_sidebar_width';
export const DEFAULT_SIDEBAR_WIDTH = 290;
const MIN_SIDEBAR_WIDTH = 260;
const MAX_SIDEBAR_WIDTH = 640;

/** Drag-to-resize for the classifier's right sidebar. The width is remembered between sessions. */
export class SidebarResizer {
  private width = DEFAULT_SIDEBAR_WIDTH;
  private dragStartX = 0;
  private dragStartWidth = 0;
  private isDragging = false;
  private keyObserver: ResizeObserver | null = null;

  constructor(private readonly root: ParentNode) {
    try {
      const saved = parseInt(localStorage.getItem(STORAGE_KEY) || '', 10);
      if (Number.isFinite(saved)) this.width = this.clamp(saved);
    } catch {
      // storage unavailable: keep the default width
    }
  }

  get currentWidth(): number {
    return this.width;
  }

  beginDrag(e: MouseEvent): void {
    e.preventDefault();
    this.isDragging = true;
    this.dragStartX = e.clientX;
    this.dragStartWidth = this.width;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    this.handle()?.classList.add('is-dragging');
  }

  /**
   * Makes the grip as tall as one quick key button, so the two look like a matching pair. Call after each render
   * (the sidebar is recreated then) and whenever the width changes, since narrower text can make the button taller.
   */
  sizeGrip(): void {
    const handle = this.handle();
    const key = this.root.querySelector<HTMLElement>('#classifierSidebar .palette-btn');
    this.keyObserver?.disconnect();
    if (!handle || !key) return;
    const apply = () => handle.style.setProperty('--grip-height', `${key.offsetHeight}px`);
    apply();
    void document.fonts?.ready.then(apply); // the first measure can come before the fonts have loaded
    // The button's height settles later (fonts loading, a species name wrapping), so keep following it.
    if (typeof ResizeObserver !== 'undefined') {
      this.keyObserver = new ResizeObserver(apply);
      this.keyObserver.observe(key);
    }
  }

  /** Arrow keys resize the panel from the keyboard; Left makes it wider, like dragging left. */
  handleKey(e: KeyboardEvent): void {
    const step = e.shiftKey ? 60 : 20;
    if (e.key === 'ArrowLeft') this.setWidth(this.width + step);
    else if (e.key === 'ArrowRight') this.setWidth(this.width - step);
    else if (e.key === 'Home') this.setWidth(MAX_SIDEBAR_WIDTH);
    else if (e.key === 'End') this.setWidth(MIN_SIDEBAR_WIDTH);
    else return;
    e.preventDefault();
    this.persist();
  }

  reset(): void {
    this.setWidth(DEFAULT_SIDEBAR_WIDTH);
    this.persist();
  }

  /** Registered once per connection; looks the sidebar up on demand because render() recreates it. */
  attachWindowListeners(signal: AbortSignal | undefined): void {
    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.isDragging) return;
      // The sidebar is on the right, so dragging left makes it wider.
      this.setWidth(this.dragStartWidth + (this.dragStartX - e.clientX));
    }, { signal });

    window.addEventListener('mouseup', () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      this.handle()?.classList.remove('is-dragging');
      this.persist();
    }, { signal });
  }

  private handle(): HTMLElement | null {
    return this.root.querySelector<HTMLElement>('#sidebarResizeHandle');
  }

  private setWidth(px: number): void {
    this.width = this.clamp(px);
    const el = this.root.querySelector<HTMLElement>('#classifierSidebar');
    if (el) el.style.width = `${this.width}px`;
    this.sizeGrip();
  }

  /** Keeps the sidebar between its minimum and maximum, and never more than 60% of the window. */
  private clamp(px: number): number {
    const max = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(window.innerWidth * 0.6)));
    return Math.min(Math.max(Math.round(px), MIN_SIDEBAR_WIDTH), max);
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, String(this.width));
    } catch {
      // storage unavailable: width just won't be remembered
    }
  }
}
