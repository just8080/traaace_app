import { projectStore, type KeymapRecord } from '../store/project-store';
import { icon } from '../services/icons';
import { html, escapeHtml } from '../utils';
import { askConfirm } from '../services/tauri-bridge';
import { showToast } from '../services/ui-scale';

export class ProjectKeymap extends HTMLElement {
  private unsubscribe: (() => void) | null = null;
  private isAddingKeymap = false;
  private isAddingComment = false;

  connectedCallback(): void {
    this.unsubscribe = projectStore.subscribe(() => this.render());
    if (projectStore.keymaps.length === 0) {
      projectStore.loadKeymaps();
    }
    if (projectStore.comments.length === 0) {
      projectStore.loadComments();
    }
    this.render();
  }

  disconnectedCallback(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }

  private render(): void {
    const keymaps = [...(projectStore.keymaps || [])];
    // Sort keymaps by sort_order
    keymaps.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const comments = projectStore.comments || [];

    this.innerHTML = html`
      <div class="page-container" style="max-width: 1240px;">
        <!-- Header -->
        <div class="flex justify-between items-end">
          <div>
            <h1 style="font-size: var(--text-2xl); font-weight: 700; color: var(--color-text-main);">Species & Key Configuration</h1>
            <p class="text-muted text-sm mt-1">
              Drag and drop species to organize shortcut keys. Slots #1 – #9 map directly to number keys 1 – 9 during classification.<br>
              Add new species, or delete species / keymaps. Resetting keys will restore defaults if needed.
            </p>
          </div>
        </div>

        <!-- Quick Observation Comments Section (Top of Page) -->
        <div class="surface-card">
          <div class="flex justify-between items-center gap-2">
            <div>
              <strong class="text-md text-main inline-flex items-center gap-2">
               Quick Observation Comments
              </strong>
              <p class="text-muted text-xs mt-1">
                Preset comment options available during classification via shortcut <kbd style="font-family: var(--font-mono); font-weight: 700; background: var(--color-bg-base); padding: 1px 5px; border-radius: var(--radius-xs); border: 1px solid var(--color-border);">C</kbd>
              </p>
            </div>
            <div class="flex gap-2 items-center flex-shrink-0">
              <button class="btn-ghost btn-action btn-action-danger" id="btnResetComments">
                ${icon('refresh')} Reset Comments
              </button>
              <button class="btn-secondary btn-action" id="btnShowAddComment">
                ${icon('plus')} Add Comment Preset
              </button>
            </div>
          </div>

          ${this.isAddingComment ? `
            <div class="inner-card flex-row items-center gap-2" style="flex-direction: row; padding: var(--space-3);">
              <input type="text" id="inputNewCommentText" placeholder="Enter quick comment text..." style="flex: 1; font-size: var(--text-xs);" />
              <button class="btn-primary" id="btnSaveNewComment" style="font-size: var(--text-xs); white-space: nowrap;">Save</button>
              <button class="btn-ghost" id="btnCancelAddComment" style="font-size: var(--text-xs); white-space: nowrap;">Cancel</button>
            </div>
          ` : ''}

          <div class="flex flex-wrap gap-2">
            ${comments.length === 0 ? `
              <div style="padding: var(--space-4); text-align: center; width: 100%; color: var(--color-text-muted); font-size: var(--text-xs); background: var(--color-bg-base); border-radius: var(--radius-md); border: 1px dashed var(--color-border); display: flex; flex-direction: column; align-items: center; gap: var(--space-2);">
                <p>No observation comment presets configured.</p>
                <button class="btn-primary" id="btnRestoreDefaultCommentsEmpty" style="font-size: var(--text-xs);">
                  Restore Default Preset Comments
                </button>
              </div>
            ` : comments.map(c => {
              const text = typeof c === 'string' ? c : (c.comment || '');
              return `
                <div style="display: inline-flex; align-items: center; gap: var(--space-2); background: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 5px 10px; font-size: var(--text-xs); color: var(--color-text-main); font-weight: 500;">
                  <span style="display: inline-flex; align-items: center; gap: var(--space-1);">${icon('message')} ${text}</span>
                  <button class="btn-ghost btn-delete-comment" data-comment="${text}" title="Remove comment" style="padding: 0 4px; font-size: 11px; color: var(--color-danger); line-height: 1;">
                    ${icon('close')}
                  </button>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Species shortcut actions: same look as the comment actions above -->
        <div class="flex justify-end items-center gap-2">
          <div class="flex gap-2 items-center flex-shrink-0">
            <button class="btn-ghost btn-action btn-action-danger" id="btnResetKeymaps">
              ${icon('refresh')} Reset Keys to Defaults
            </button>
            <button class="btn-secondary btn-action" id="btnShowAddKeymap">
              ${icon('plus')} Add Keymap / Species
            </button>
          </div>
        </div>

        <!-- Add Keymap Form Card (Conditional) -->
        ${this.isAddingKeymap ? `
          <div class="surface-card" style="background: var(--color-bg-surface-raised);">
            <div class="flex justify-between items-center">
              <strong class="text-sm text-main">Add or Assign Species Shortcut</strong>
              <button class="btn-ghost" id="btnCancelAddKeymap" style="padding: 2px 6px;">${icon('close')}</button>
            </div>
            <div style="display: grid; grid-template-columns: 80px 1fr 120px auto; gap: var(--space-3); align-items: flex-end;">
              <div style="min-width: 0;">
                <label style="font-size: var(--text-xs); font-weight: 600; color: var(--color-text-muted); display: block; margin-bottom: 4px;">KEY</label>
                <input type="text" id="inputNewKey" placeholder="e.g. 1" maxlength="3" style="width: 100%; text-transform: uppercase; text-align: center; font-family: var(--font-mono); font-weight: 700;" />
              </div>
              <div style="min-width: 0;">
                <label style="font-size: var(--text-xs); font-weight: 600; color: var(--color-text-muted); display: block; margin-bottom: 4px;">SPECIES NAME</label>
                <input type="text" id="inputNewSpecies" placeholder="e.g. Feral Cat, Kiwi, Stoat..." style="width: 100%;" />
              </div>
              <div style="min-width: 0;">
                <label style="font-size: var(--text-xs); font-weight: 600; color: var(--color-text-muted); display: block; margin-bottom: 4px;">SORT PRIORITY</label>
                <input type="number" id="inputNewSort" value="${keymaps.length + 1}" min="1" style="width: 100%;" />
              </div>
              <div>
                <button class="btn-primary" id="btnSaveNewKeymap" style="height: 36px; white-space: nowrap; flex-shrink: 0;">
                  Save Shortcut
                </button>
              </div>
            </div>
          </div>
        ` : ''}

        <!-- Numbered & Draggable Species Keymaps Table -->
        <div class="surface-card" style="padding: 0; overflow: hidden;">
          <div style="padding: var(--space-3) var(--space-4); background: var(--color-bg-base); border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center;">
            <div class="flex items-center gap-2">
              <strong class="text-sm text-main">Species Shortcuts (${keymaps.length})</strong>
            </div>
          </div>

          <table class="keymap-table" style="width: 100%; border-collapse: collapse; text-align: left; font-size: var(--text-sm);">
            <thead>
              <tr style="border-bottom: 1px solid var(--color-border); background: var(--color-bg-surface); color: var(--color-text-muted); font-size: var(--text-xs);">
                <th style="padding: var(--space-2) var(--space-3); width: 44px; text-align: center;"></th>
                <th style="padding: var(--space-2) var(--space-4); width: 70px;">Rank</th>
                <th style="padding: var(--space-2) var(--space-4); width: 85px;">Key</th>
                <th style="padding: var(--space-2) var(--space-4);">Species</th>
                <th style="padding: var(--space-2) var(--space-4); width: 110px;">Type</th>
                <th style="padding: var(--space-2) var(--space-4); text-align: right; width: 150px;">Actions</th>
              </tr>
            </thead>
            <tbody id="keymapTableBody">
              <!-- Pinned Space Key (Empty) -->
              <tr style="border-bottom: 1px solid var(--color-border); background: var(--color-bg-base);">
                <td style="padding: var(--space-2) var(--space-3); text-align: center; color: var(--color-text-muted);">
                  <span style="opacity: 0.5; display: inline-flex;">${icon('lock', { size: 14 })}</span>
                </td>
                <td style="padding: var(--space-2) var(--space-4);">
                  <span class="rank-badge"><span class="rank-hash">#</span>0</span>
                </td>
                <td style="padding: var(--space-2) var(--space-4);">
                  <span class="slot-key">Space</span>
                </td>
                <td style="padding: var(--space-2) var(--space-4); font-weight: 600; color: var(--color-text-muted);">
                  Empty / No Animal
                </td>
                <td style="padding: var(--space-2) var(--space-4);">
                  <span class="badge badge-muted">Built-in</span>
                </td>
                <td style="padding: var(--space-2) var(--space-4); text-align: right; color: var(--color-text-muted); font-size: var(--text-xs);">
                  Pinned
                </td>
              </tr>

              <!-- Draggable Rows -->
              ${keymaps.map((k, index) => {
                const isQuickNine = index < 9;
                return `
                  <tr class="draggable-row" data-key="${k.keystrokes}" data-index="${index}" style="border-bottom: 1px solid var(--color-border);">
                    <td class="col-drag" style="padding: var(--space-2) var(--space-3); text-align: center;">
                      <span class="drag-handle" title="Drag to reorder species slot">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                          <circle cx="9" cy="5" r="1.5" fill="currentColor"></circle>
                          <circle cx="9" cy="12" r="1.5" fill="currentColor"></circle>
                          <circle cx="9" cy="19" r="1.5" fill="currentColor"></circle>
                          <circle cx="15" cy="5" r="1.5" fill="currentColor"></circle>
                          <circle cx="15" cy="12" r="1.5" fill="currentColor"></circle>
                          <circle cx="15" cy="19" r="1.5" fill="currentColor"></circle>
                        </svg>
                      </span>
                    </td>
                    <td style="padding: var(--space-2) var(--space-4);">
                      <span class="rank-badge ${isQuickNine ? 'quick-nine' : ''}">
                        <span class="rank-hash">#</span>${index + 1}
                      </span>
                    </td>
                    <td style="padding: var(--space-2) var(--space-4);">
                      <span class="slot-key ${isQuickNine ? 'quick-nine' : ''}">
                        ${escapeHtml(k.keystrokes)}
                      </span>
                    </td>
                    <td style="padding: var(--space-2) var(--space-4); font-weight: 600; color: var(--color-text-main);">
                      ${escapeHtml(k.species)}
                    </td>
                    <td style="padding: var(--space-2) var(--space-4);">
                      <span class="badge ${k.builtin ? 'badge-muted' : 'badge-accent'}">
                        ${k.builtin ? 'Built-in' : 'Custom'}
                      </span>
                    </td>
                    <td style="padding: var(--space-2) var(--space-4); text-align: right;">
                      <div style="display: inline-flex; align-items: center; gap: 4px;">
                        <button class="btn-ghost btn-move-up" data-key="${escapeHtml(k.keystrokes)}" title="Move up (higher priority)" style="font-size: 10px; padding: 2px 6px; border-radius: var(--radius-sm);" ${index === 0 ? 'disabled' : ''}>
                          ▲
                        </button>
                        <button class="btn-ghost btn-move-down" data-key="${escapeHtml(k.keystrokes)}" title="Move down (lower priority)" style="font-size: 10px; padding: 2px 6px; border-radius: var(--radius-sm);" ${index === keymaps.length - 1 ? 'disabled' : ''}>
                          ▼
                        </button>
                        <button class="btn-ghost btn-delete-keymap" data-key="${escapeHtml(k.keystrokes)}" data-species="${escapeHtml(k.species)}" style="font-size: var(--text-xs); padding: 2px 6px; color: var(--color-danger);" title="Delete shortcut">
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Event listeners: Add Keymap
    this.querySelector('#btnShowAddKeymap')?.addEventListener('click', () => {
      this.isAddingKeymap = true;
      this.render();
    });

    this.querySelector('#btnCancelAddKeymap')?.addEventListener('click', () => {
      this.isAddingKeymap = false;
      this.render();
    });

    this.querySelector('#btnSaveNewKeymap')?.addEventListener('click', async () => {
      const keyInput = this.querySelector<HTMLInputElement>('#inputNewKey');
      const speciesInput = this.querySelector<HTMLInputElement>('#inputNewSpecies');
      const sortInput = this.querySelector<HTMLInputElement>('#inputNewSort');

      if (!keyInput?.value.trim() || !speciesInput?.value.trim()) {
        showToast('Please provide both a keystroke and species name.');
        return;
      }

      const item: KeymapRecord = {
        keystrokes: keyInput.value.trim().toUpperCase(),
        species: speciesInput.value.trim(),
        builtin: false,
        sortOrder: parseInt(sortInput?.value || '10', 10),
        hidden: false,
        locked: false,
      };

      try {
        await projectStore.saveKeymap(item);
        this.isAddingKeymap = false;
        showToast(`Saved shortcut "${item.species}" (${item.keystrokes})`);
        this.render();
      } catch (err) {
        showToast(`Failed to save keymap: ${err}`);
      }
    });

    // Reset keymaps
    this.querySelector('#btnResetKeymaps')?.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const btn = e.currentTarget as HTMLButtonElement | null;
      if (btn) btn.disabled = true;

      const confirmed = await askConfirm(
        'Reset all keymaps to New Zealand default species presets? Custom keys will be replaced.',
        { title: 'Reset Keymaps to Defaults', kind: 'warning' }
      );

      if (confirmed) {
        try {
          await projectStore.resetKeymaps();
          showToast('Keymap shortcuts reset to defaults');
        } catch (err) {
          showToast(`Failed to reset keymaps: ${err}`);
        }
      } else if (btn) {
        btn.disabled = false;
      }
    });

    // Delete keymap (both built-in and custom)
    this.querySelectorAll('.btn-delete-keymap').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const key = btn.getAttribute('data-key');
        const species = btn.getAttribute('data-species') || key;
        if (!key) return;

        const confirmed = await askConfirm(
          `Delete species shortcut "${species}" (${key})?`,
          { title: 'Delete Shortcut', kind: 'warning' }
        );

        if (confirmed) {
          try {
            await projectStore.deleteKeymap(key);
            showToast(`Deleted shortcut "${species}" (${key})`);
          } catch (err) {
            showToast(`Failed to delete keymap: ${err}`);
          }
        }
      });
    });

    // ============================================================
    // Drag-and-Drop Reordering via Global Pointer Events
    // ============================================================
    const rows = Array.from(this.querySelectorAll<HTMLTableRowElement>('.draggable-row'));

    let activeDraggingRow: HTMLTableRowElement | null = null;
    let targetDropRow: HTMLTableRowElement | null = null;
    let dropInsertAfter = false;
    let startY = 0;
    let hasMoved = false;

    const onGlobalPointerMove = (e: PointerEvent) => {
      if (!activeDraggingRow) return;

      if (!hasMoved) {
        if (Math.abs(e.clientY - startY) > 3) {
          hasMoved = true;
          activeDraggingRow.classList.add('dragging');
          document.body.style.cursor = 'grabbing';
          document.body.style.userSelect = 'none';
        } else {
          return;
        }
      }

      e.preventDefault();

      // Clear existing drop indicators
      rows.forEach(r => r.classList.remove('drop-above', 'drop-below'));
      targetDropRow = null;

      const clientY = e.clientY;
      const validRows = rows.filter(r => r !== activeDraggingRow);
      if (validRows.length === 0) return;

      const firstRect = validRows[0].getBoundingClientRect();
      const lastRect = validRows[validRows.length - 1].getBoundingClientRect();

      if (clientY < firstRect.top + firstRect.height / 2) {
        targetDropRow = validRows[0];
        dropInsertAfter = false;
        targetDropRow.classList.add('drop-above');
        return;
      }

      if (clientY > lastRect.top + lastRect.height / 2) {
        targetDropRow = validRows[validRows.length - 1];
        dropInsertAfter = true;
        targetDropRow.classList.add('drop-below');
        return;
      }

      for (const candidate of validRows) {
        const rect = candidate.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) {
          const mid = rect.top + rect.height / 2;
          targetDropRow = candidate;
          dropInsertAfter = clientY >= mid;
          if (dropInsertAfter) {
            candidate.classList.add('drop-below');
          } else {
            candidate.classList.add('drop-above');
          }
          break;
        }
      }
    };

    const onGlobalPointerUp = async () => {
      window.removeEventListener('pointermove', onGlobalPointerMove);
      window.removeEventListener('pointerup', onGlobalPointerUp);
      window.removeEventListener('pointercancel', onGlobalPointerUp);

      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      const draggedRow = activeDraggingRow;
      const dropRow = targetDropRow;
      const isMoved = hasMoved;
      const insertAfter = dropInsertAfter;

      activeDraggingRow = null;
      targetDropRow = null;
      hasMoved = false;

      draggedRow?.classList.remove('dragging');
      rows.forEach(r => r.classList.remove('drop-above', 'drop-below'));

      if (isMoved && draggedRow && dropRow && draggedRow !== dropRow) {
        const fromKey = draggedRow.getAttribute('data-key');
        const toKey = dropRow.getAttribute('data-key');

        if (fromKey && toKey && fromKey !== toKey) {
          const curIdx = keymaps.findIndex(k => k.keystrokes === fromKey);
          let tgtIdx = keymaps.findIndex(k => k.keystrokes === toKey);

          if (curIdx !== -1 && tgtIdx !== -1) {
            const [moved] = keymaps.splice(curIdx, 1);
            tgtIdx = keymaps.findIndex(k => k.keystrokes === toKey);
            if (insertAfter) {
              keymaps.splice(tgtIdx + 1, 0, moved);
            } else {
              keymaps.splice(tgtIdx, 0, moved);
            }

            const orderedKeys = keymaps.map(k => k.keystrokes);
            try {
              await projectStore.reorderKeymaps(orderedKeys);
            } catch (err) {
              console.error('Failed to reorder keymaps:', err);
              await projectStore.loadKeymaps();
            }
          }
        }
      }
    };

    rows.forEach(row => {
      const handle = row.querySelector<HTMLElement>('.drag-handle') || row;
      const colDrag = row.querySelector<HTMLElement>('.col-drag') || row;

      const startPointerDrag = (e: PointerEvent) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest('button, input, select, a')) return;

        activeDraggingRow = row;
        targetDropRow = null;
        dropInsertAfter = false;
        startY = e.clientY;
        hasMoved = false;

        window.addEventListener('pointermove', onGlobalPointerMove, { passive: false });
        window.addEventListener('pointerup', onGlobalPointerUp);
        window.addEventListener('pointercancel', onGlobalPointerUp);
      };

      handle.addEventListener('pointerdown', startPointerDrag);
      if (colDrag !== handle) {
        colDrag.addEventListener('pointerdown', startPointerDrag);
      }
      row.addEventListener('pointerdown', startPointerDrag);
    });

    // Move Up / Move Down buttons
    this.querySelectorAll('.btn-move-up').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const key = btn.getAttribute('data-key');
        const idx = keymaps.findIndex(k => k.keystrokes === key);
        if (idx > 0) {
          const [moved] = keymaps.splice(idx, 1);
          keymaps.splice(idx - 1, 0, moved);
          const orderedKeys = keymaps.map(k => k.keystrokes);
          try {
            await projectStore.reorderKeymaps(orderedKeys);
          } catch (err) {
            console.error('Failed to move keymap up:', err);
            await projectStore.loadKeymaps();
          }
        }
      });
    });

    this.querySelectorAll('.btn-move-down').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const key = btn.getAttribute('data-key');
        const idx = keymaps.findIndex(k => k.keystrokes === key);
        if (idx !== -1 && idx < keymaps.length - 1) {
          const [moved] = keymaps.splice(idx, 1);
          keymaps.splice(idx + 1, 0, moved);
          const orderedKeys = keymaps.map(k => k.keystrokes);
          try {
            await projectStore.reorderKeymaps(orderedKeys);
          } catch (err) {
            console.error('Failed to move keymap down:', err);
            await projectStore.loadKeymaps();
          }
        }
      });
    });

    // Comments listeners
    this.querySelector('#btnShowAddComment')?.addEventListener('click', () => {
      this.isAddingComment = true;
      this.render();
    });

    this.querySelector('#btnCancelAddComment')?.addEventListener('click', () => {
      this.isAddingComment = false;
      this.render();
    });

    const commentInput = this.querySelector<HTMLInputElement>('#inputNewCommentText');
    if (commentInput) {
      setTimeout(() => commentInput.focus(), 50);
      commentInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.querySelector<HTMLButtonElement>('#btnSaveNewComment')?.click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.querySelector<HTMLButtonElement>('#btnCancelAddComment')?.click();
        }
      });
    }

    this.querySelector('#btnSaveNewComment')?.addEventListener('click', async () => {
      const input = this.querySelector<HTMLInputElement>('#inputNewCommentText');
      if (input && input.value.trim()) {
        try {
          await projectStore.addComment(input.value.trim());
          this.isAddingComment = false;
          this.render();
        } catch (err) {
          showToast(`Failed to add comment: ${err}`);
        }
      }
    });

    this.querySelector('#btnResetComments')?.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const btn = e.currentTarget as HTMLButtonElement | null;
      if (btn) btn.disabled = true;

      const confirmed = await askConfirm('Reset observation comments to default options?', {
        title: 'Reset Comments',
        kind: 'warning',
      });

      if (confirmed) {
        try {
          await projectStore.resetComments();
          showToast('Observation comments reset to defaults');
        } catch (err) {
          showToast(`Failed to reset comments: ${err}`);
        }
      } else if (btn) {
        btn.disabled = false;
      }
    });

    this.querySelector('#btnRestoreDefaultCommentsEmpty')?.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await projectStore.resetComments();
        showToast('Default observation comments restored');
      } catch (err) {
        showToast(`Failed to restore comments: ${err}`);
      }
    });

    this.querySelectorAll('.btn-delete-comment').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const text = btn.getAttribute('data-comment');
        if (!text) return;

        const confirmed = await askConfirm(`Remove comment preset "${text}"?`, {
          title: 'Delete Comment',
          kind: 'warning',
        });

        if (confirmed) {
          try {
            await projectStore.deleteComment(text);
            showToast(`Deleted comment "${text}"`);
          } catch (err) {
            showToast(`Failed to delete comment: ${err}`);
          }
        }
      });
    });
  }
}

customElements.define('project-keymap', ProjectKeymap);

declare global {
  interface HTMLElementTagNameMap {
    'project-keymap': ProjectKeymap;
  }
}
