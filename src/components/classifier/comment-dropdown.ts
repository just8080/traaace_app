import { icon } from '../../services/icons';
import { html, escapeHtml } from '../../utils';

export interface CommentDropdownHost {
  /** Comment currently stored on the active photo. */
  getCurrentComment(): string;
  getPresets(): string[];
  save(comment: string): void;
}

/** Preset-comment dropdown in the sidebar: option rendering, keyboard highlight and selection. */
export class CommentDropdown {
  isOpen = false;
  private highlightIndex = -1;

  constructor(private readonly root: ParentNode, private readonly host: CommentDropdownHost) {}

  open(): void {
    this.isOpen = true;
    const menu = this.root.querySelector<HTMLElement>('#commentMenuDropdown');
    const input = this.root.querySelector<HTMLInputElement>('#inputSidebarComment');

    if (menu) {
      menu.style.display = 'flex';
      this.renderOptions();
    }

    if (input) {
      input.focus();
      input.select();
    }
  }

  close(): void {
    this.isOpen = false;
    this.highlightIndex = -1;
    const menu = this.root.querySelector<HTMLElement>('#commentMenuDropdown');
    if (menu) {
      menu.style.display = 'none';
    }
  }

  /** Saves a comment, closes the menu and releases input focus so hotkeys work again. */
  private commit(comment: string): void {
    this.host.save(comment);
    this.close();
    this.root.querySelector<HTMLInputElement>('#inputSidebarComment')?.blur();
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  renderOptions(filter = ''): void {
    const list = this.root.querySelector<HTMLElement>('#commentMenuDropdown');
    if (!list) return;

    const currentComment = this.host.getCurrentComment().trim();
    const presets = this.host.getPresets();

    const q = filter.trim().toLowerCase();
    const filteredPresets = q ? presets.filter(p => p.toLowerCase().includes(q)) : presets;
    const allOptions = q ? filteredPresets : ['(None - Clear comment)', ...filteredPresets];

    if (allOptions.length === 0) {
      list.innerHTML = html`
        <div style="padding: 8px 10px; font-size: 11px; color: var(--color-text-muted); font-style: italic;">
          No matching presets (press Enter to save custom)
        </div>
      `;
      return;
    }

    list.innerHTML = allOptions.map((opt, idx) => {
      const isClear = opt.startsWith('(None');
      const val = isClear ? '' : opt;
      const isSelected = val === currentComment;
      const isHighlighted = idx === this.highlightIndex;

      return html`
        <div class="comment-option-item ${isSelected ? 'selected' : ''} ${isHighlighted ? 'highlighted' : ''}"
          data-value="${escapeHtml(val)}" data-idx="${idx}">
          <span>${escapeHtml(opt)}</span>
          ${isSelected ? `<span style="color: var(--color-brand); display: inline-flex;">${icon('check')}</span>` : ''}
        </div>
      `;
    }).join('');

    list.querySelectorAll('.comment-option-item').forEach(el => {
      el.addEventListener('click', () => {
        this.commit(el.getAttribute('data-value') || '');
      });
    });
  }

  navigate(direction: number): void {
    const items = this.root.querySelectorAll<HTMLElement>('.comment-option-item');
    if (items.length === 0) return;

    this.highlightIndex += direction;
    if (this.highlightIndex < 0) this.highlightIndex = items.length - 1;
    if (this.highlightIndex >= items.length) this.highlightIndex = 0;

    items.forEach((item, idx) => {
      if (idx === this.highlightIndex) {
        item.classList.add('highlighted');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('highlighted');
      }
    });
  }

  applyHighlighted(): void {
    const input = this.root.querySelector<HTMLInputElement>('#inputSidebarComment');
    if (!input) return;

    const presets = this.host.getPresets();
    const q = input.value.trim().toLowerCase();
    const filtered = q ? presets.filter(p => p.toLowerCase().includes(q)) : presets;
    const allOptions = q ? filtered : ['', ...filtered];

    this.commit(
      this.highlightIndex >= 0 && this.highlightIndex < allOptions.length
        ? allOptions[this.highlightIndex]
        : input.value.trim(),
    );
  }
}
