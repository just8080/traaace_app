/**
 * BaseModal
 * Reusable abstract base class for all modal dialogs in TRAAACE.
 * Encapsulates Escape key dismissals, backdrop click-to-close,
 * lifecycle event cleanup, and accessibility attributes.
 */
export abstract class BaseModal extends HTMLElement {
  protected isOpen = false;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private backdropClickHandler: ((e: MouseEvent) => void) | null = null;

  /**
   * Subclasses can override to prevent Escape / backdrop closing
   * while an async action (e.g. exporting or deleting) is in progress.
   */
  protected canDismiss(): boolean {
    return true;
  }

  /**
   * Called when modal opens. Subclasses can override for setup.
   */
  protected onOpen(): void {}

  /**
   * Called when modal closes. Subclasses can override for teardown.
   */
  protected onClose(): void {}

  /**
   * Subclasses must implement their own render routine.
   */
  protected abstract render(): void;

  public open(..._args: unknown[]): void {
    this.isOpen = true;
    this.setupListeners();
    this.onOpen();
    this.render();
  }

  public close(): void {
    if (!this.canDismiss() && this.isOpen) return;
    this.isOpen = false;
    this.cleanupListeners();
    this.onClose();
    this.innerHTML = '';
  }

  protected setupListeners(): void {
    this.cleanupListeners();

    // 1. Escape key dismissal
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.canDismiss()) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    };
    window.addEventListener('keydown', this.keydownHandler);

    // 2. Backdrop click-to-close (clicking outside the dialog)
    this.backdropClickHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target && target.classList.contains('modal-backdrop') && this.canDismiss()) {
        this.close();
      }
    };
    this.addEventListener('click', this.backdropClickHandler);
  }

  protected cleanupListeners(): void {
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    if (this.backdropClickHandler) {
      this.removeEventListener('click', this.backdropClickHandler);
      this.backdropClickHandler = null;
    }
  }

  disconnectedCallback(): void {
    this.cleanupListeners();
  }
}
