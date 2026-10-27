import { getThumbnailSrc } from '../../services/tauri-bridge';

/** Lazy thumbnail loading for the grid, with an IntersectionObserver that recycles off-screen bitmaps. */
export class GridThumbnails {
  private cache: Map<string, string> = new Map();
  private observer: IntersectionObserver | null = null;

  getCached(path: string): string {
    return this.cache.get(path) || '';
  }

  observe(root: ParentNode): void {
    this.dispose();

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
              } else if (fullPath) {
                getThumbnailSrc(fullPath).then(src => {
                  if (src) {
                    this.cache.set(fullPath, src);
                    img.src = src;
                  }
                }).catch(() => { });
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

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}
