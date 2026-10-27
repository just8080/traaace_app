/** Zoom and pan state for the single-image viewer. Looks DOM nodes up on demand because the view re-renders. */
export class ZoomPanController {
  scale = 1.0;
  private panX = 0;
  private panY = 0;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;

  constructor(private readonly root: ParentNode) {}

  setZoom(scale: number): void {
    this.scale = Math.min(Math.max(scale, 0.25), 5.0);
    this.apply();
  }

  zoomBy(factor: number): void {
    this.setZoom(this.scale * factor);
  }

  reset(): void {
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.apply();
  }

  beginDrag(e: MouseEvent): void {
    this.isDragging = true;
    this.dragStartX = e.clientX - this.panX;
    this.dragStartY = e.clientY - this.panY;
  }

  /**
   * Pan-drag tracking. Registered once per connection (not per render) and looks the
   * viewer container up on demand, because render() recreates it.
   */
  attachWindowListeners(signal: AbortSignal | undefined): void {
    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.isDragging) return;
      this.panX = e.clientX - this.dragStartX;
      this.panY = e.clientY - this.dragStartY;
      this.apply();
    }, { signal });

    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.root.querySelector('#viewerImgContainer')?.classList.remove('panning');
      }
    }, { signal });
  }

  apply(): void {
    const imgEl = this.root.querySelector<HTMLImageElement>('#mainViewerImg');
    const container = this.root.querySelector<HTMLElement>('#viewerImgContainer');
    const display = this.root.querySelector<HTMLElement>('#viewerZoomPercent');

    if (display) {
      display.textContent = `${Math.round(this.scale * 100)}%`;
    }

    if (imgEl) {
      imgEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    }

    if (container) {
      if (this.scale > 1.05) {
        container.classList.add('zoomed');
      } else {
        container.classList.remove('zoomed');
      }
    }
  }
}
