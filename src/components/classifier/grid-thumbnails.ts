import { getThumbnailSrc, getVideoThumbnailSrc } from '../../services/tauri-bridge';

/** Lazy thumbnail loading for the grid, with an IntersectionObserver that recycles off-screen bitmaps. */
export class GridThumbnails {
  private cache: Map<string, string> = new Map();
  private loading = new Set<string>();
  private root: ParentNode | null = null;
  private observer: IntersectionObserver | null = null;

  getCached(path: string): string {
    return this.cache.get(path) || '';
  }

  observe(root: ParentNode): void {
    this.dispose();
    this.root = root;

    // Only keep decoded bitmaps in RAM when near the visible viewport
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const img = entry.target as HTMLImageElement;
          const fullPath = img.getAttribute('data-path');
          if (entry.isIntersecting) {
            if (!img.src || img.src === window.location.href || img.src.endsWith('/')) {
              const cached = fullPath ? this.cache.get(fullPath) : null;
              if (cached) {
                img.src = cached;
              } else if (fullPath && !this.cache.has(fullPath) && !this.loading.has(fullPath)) {
                const isVideo = img.hasAttribute('data-video');
                this.loading.add(fullPath);
                (isVideo ? getVideoThumbnailSrc : getThumbnailSrc)(fullPath).then(src => {
                  // A video with no readable frame is remembered as '' so it isn't tried again on every scroll
                  if (src || isVideo) this.cache.set(fullPath, src);
                  if (src) this.show(img, fullPath, src);
                }).catch(() => { }).finally(() => this.loading.delete(fullPath));
              }
            }
          } else {
            // Unload off-screen image from memory so WebKit frees decoded bitmaps immediately
            img.removeAttribute('src');
          }
        }
      },
      { rootMargin: '300px 0px' }
    );

    root.querySelectorAll<HTMLImageElement>('.grid-card-thumb').forEach(img => {
      this.observer?.observe(img);
    });
  }

  /** The grid may have been redrawn while a thumbnail loaded, leaving `img` detached; fill in its replacement. */
  private show(img: HTMLImageElement, path: string, src: string): void {
    const target = img.isConnected
      ? img
      : Array.from(this.root?.querySelectorAll<HTMLImageElement>('.grid-card-thumb') ?? []).find(i => i.getAttribute('data-path') === path);
    if (target) target.src = src;
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}
