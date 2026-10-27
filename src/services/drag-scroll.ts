/** Mouse events already claimed by an inner scroller, so an outer one does not also scroll. */
const claimed = new WeakSet<Event>();

export interface DragScrollOptions {
  /** Fade the edges that have hidden content (styled by `.drag-scroll-fade`). */
  fade?: boolean;
}

/**
 * Lets a horizontally overflowing element be scrolled by dragging it with the mouse (or the wheel),
 * for bars whose scrollbar is hidden. A drag that ends over a button does not click it.
 * Returns a function that removes every listener.
 */
export function enableDragScroll(el: HTMLElement, options: DragScrollOptions = {}): () => void {
  const abort = new AbortController();
  const { signal } = abort;
  let startX = 0;
  let startScroll = 0;
  let pressed = false;
  let moved = false;

  const overflows = (): boolean => el.scrollWidth > el.clientWidth + 1;

  const updateHints = (): void => {
    const max = el.scrollWidth - el.clientWidth;
    el.classList.toggle('can-scroll', max > 1);
    if (options.fade) {
      el.classList.toggle('fade-left', el.scrollLeft > 1);
      el.classList.toggle('fade-right', el.scrollLeft < max - 1);
    }
  };

  el.classList.add('drag-scroll');
  if (options.fade) el.classList.add('drag-scroll-fade');
  el.addEventListener('scroll', updateHints, { passive: true, signal });
  const resizeObserver = new ResizeObserver(updateHints);
  resizeObserver.observe(el);
  updateHints();

  el.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0 || claimed.has(e) || !overflows()) return;
    claimed.add(e);
    pressed = true;
    moved = false;
    startX = e.clientX;
    startScroll = el.scrollLeft;
  }, { signal });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!pressed) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) > 4) {
      moved = true;
      el.classList.add('is-dragging');
    }
    if (moved) el.scrollLeft = startScroll - dx;
  }, { signal });

  window.addEventListener('mouseup', () => {
    pressed = false;
    el.classList.remove('is-dragging');
  }, { signal });

  // A drag that ends over a button must not also click it.
  el.addEventListener('click', (e: MouseEvent) => {
    if (moved) {
      e.preventDefault();
      e.stopPropagation();
      moved = false;
    }
  }, { capture: true, signal });

  // A plain mouse wheel scrolls sideways; trackpad swipes already do.
  el.addEventListener('wheel', (e: WheelEvent) => {
    if (!overflows() || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY;
  }, { passive: false, signal });

  return () => {
    abort.abort();
    resizeObserver.disconnect();
    el.classList.remove('drag-scroll', 'drag-scroll-fade', 'can-scroll', 'fade-left', 'fade-right', 'is-dragging');
  };
}
