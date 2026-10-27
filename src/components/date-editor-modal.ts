import { BaseModal } from './base-modal';
import { quickStore } from '../store/quick-store';
import { projectStore } from '../store/project-store';
import { icon } from '../services/icons';
import { html, escapeHtml } from '../utils';

export interface EditableDateItem {
  id?: string;
  filename?: string;
  fileName?: string;
  timestamp?: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const WEEKDAY_NAMES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export class DateEditorModal extends BaseModal {
  private item: EditableDateItem | null = null;
  private mode: 'quick' | 'project' = 'quick';
  private selectedDate: Date = new Date();
  private viewYear: number = new Date().getFullYear();
  private viewMonth: number = new Date().getMonth();
  private shiftRemaining = true;

  public open(item: EditableDateItem, mode: 'quick' | 'project' = 'quick'): void {
    this.item = item;
    this.mode = mode;
    this.shiftRemaining = true;

    const timestampStr = item.timestamp || new Date().toISOString();
    const parsed = new Date(timestampStr);
    this.selectedDate = isNaN(parsed.getTime()) ? new Date() : new Date(parsed.getTime());
    this.viewYear = this.selectedDate.getFullYear();
    this.viewMonth = this.selectedDate.getMonth();

    super.open();
  }

  protected override onClose(): void {
    this.item = null;
  }

  private pad(n: number): string {
    return n.toString().padStart(2, '0');
  }

  private formatFullPreview(d: Date): string {
    const y = d.getFullYear();
    const m = this.pad(d.getMonth() + 1);
    const day = this.pad(d.getDate());
    const h = this.pad(d.getHours());
    const min = this.pad(d.getMinutes());
    const s = this.pad(d.getSeconds());

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weekday = days[d.getDay()];
    const monthShort = MONTH_NAMES[d.getMonth()].slice(0, 3);

    return `${y}-${m}-${day} ${h}:${min}:${s} (${weekday}, ${d.getDate()} ${monthShort} ${y})`;
  }

  protected render(): void {
    if (!this.item || !this.isOpen) {
      this.innerHTML = '';
      return;
    }

    const displayName = this.item.fileName || this.item.filename || 'current photo';
    const now = new Date();

    // Calendar grid calculations (Monday as day 0)
    const firstDayIndex = (new Date(this.viewYear, this.viewMonth, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(this.viewYear, this.viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(this.viewYear, this.viewMonth, 0).getDate();

    const totalCells = firstDayIndex + daysInMonth > 35 ? 42 : 35;

    // Years dropdown range around current view year
    const currentYear = now.getFullYear();
    const minYear = Math.min(2010, this.viewYear - 5);
    const maxYear = Math.max(currentYear + 5, this.viewYear + 5);
    const yearOptions: number[] = [];
    for (let y = minYear; y <= maxYear; y++) {
      yearOptions.push(y);
    }

    const hours = this.selectedDate.getHours();
    const minutes = this.selectedDate.getMinutes();

    // Generate calendar day cells
    const dayCells: string[] = [];
    for (let i = 0; i < totalCells; i++) {
      let cellYear = this.viewYear;
      let cellMonth = this.viewMonth;
      let cellDate = 1;
      let isOtherMonth = false;

      if (i < firstDayIndex) {
        // Prev month days
        cellDate = daysInPrevMonth - (firstDayIndex - 1 - i);
        cellMonth = this.viewMonth - 1;
        if (cellMonth < 0) {
          cellMonth = 11;
          cellYear--;
        }
        isOtherMonth = true;
      } else if (i >= firstDayIndex + daysInMonth) {
        // Next month days
        cellDate = i - (firstDayIndex + daysInMonth) + 1;
        cellMonth = this.viewMonth + 1;
        if (cellMonth > 11) {
          cellMonth = 0;
          cellYear++;
        }
        isOtherMonth = true;
      } else {
        // Current month days
        cellDate = i - firstDayIndex + 1;
      }

      const isToday =
        cellYear === now.getFullYear() &&
        cellMonth === now.getMonth() &&
        cellDate === now.getDate();

      const isSelected =
        cellYear === this.selectedDate.getFullYear() &&
        cellMonth === this.selectedDate.getMonth() &&
        cellDate === this.selectedDate.getDate();

      const classes = [
        'calendar-day-btn',
        isOtherMonth ? 'is-other-month' : '',
        isToday ? 'is-today' : '',
        isSelected ? 'is-selected' : '',
      ].filter(Boolean).join(' ');

      dayCells.push(html`
        <button
          type="button"
          class="${classes}"
          data-year="${cellYear}"
          data-month="${cellMonth}"
          data-date="${cellDate}"
          title="${cellDate} ${MONTH_NAMES[cellMonth]} ${cellYear}"
        >
          ${cellDate}
        </button>
      `);
    }

    this.innerHTML = html`
      <div class="modal-backdrop">
        <div class="modal-dialog date-editor-dialog" role="dialog" aria-modal="true" aria-label="Change Photo Date and Time" style="max-width: 500px;">
          <div class="modal-header">
            <span class="inline-flex items-center gap-2 font-semibold">
              ${icon('calendar')} Change Photo Date / Time
            </span>
            <button type="button" class="btn-ghost btn-sm" id="btnCloseDateModal" aria-label="Close dialog">
              ${icon('close')}
            </button>
          </div>

          <div class="modal-body" style="gap: var(--space-3);">
            <p class="text-muted text-xs">
              Correct the recorded timestamp for <strong class="text-main">${escapeHtml(displayName)}</strong>.
            </p>

            <!-- Large Interactive Calendar Card -->
            <div class="date-picker-card">
              <!-- Calendar Navigation Header -->
              <div class="calendar-nav-bar">
                <button type="button" class="btn-ghost btn-sm" id="btnPrevMonth" title="Previous month">
                  ${icon('chevron-left')}
                </button>

                <div class="flex items-center gap-2">
                  <select id="selectMonth" class="calendar-month-select">
                    ${MONTH_NAMES.map((name, idx) => html`
                      <option value="${idx}" ${idx === this.viewMonth ? 'selected' : ''}>${name}</option>
                    `).join('')}
                  </select>

                  <select id="selectYear" class="calendar-year-select">
                    ${yearOptions.map(y => html`
                      <option value="${y}" ${y === this.viewYear ? 'selected' : ''}>${y}</option>
                    `).join('')}
                  </select>

                  <button type="button" class="btn-secondary btn-sm" id="btnToday" style="padding: 2px 8px; font-size: 11px;">
                    Today
                  </button>
                </div>

                <button type="button" class="btn-ghost btn-sm" id="btnNextMonth" title="Next month">
                  ${icon('chevron-right')}
                </button>
              </div>

              <!-- Weekday Headers -->
              <div class="calendar-grid">
                ${WEEKDAY_NAMES.map(d => html`
                  <div class="calendar-weekday-header">${d}</div>
                `).join('')}
              </div>

              <!-- Day Cells -->
              <div class="calendar-grid" id="calendarDaysGrid">
                ${dayCells.join('')}
              </div>
            </div>

            <!-- Time Control Card -->
            <div class="time-picker-row">
              <div class="flex items-center gap-2">
                <span class="text-xs font-semibold text-muted flex items-center gap-1">
                  ${icon('clock')} Time:
                </span>
                <div class="time-inputs-group">
                  <input
                    type="number"
                    id="inputHour"
                    min="0"
                    max="23"
                    value="${this.pad(hours)}"
                    class="time-num-input"
                    title="Hour (00–23)"
                  />
                  <span>:</span>
                  <input
                    type="number"
                    id="inputMinute"
                    min="0"
                    max="59"
                    value="${this.pad(minutes)}"
                    class="time-num-input"
                    title="Minute (00–59)"
                  />
                </div>
              </div>

              <!-- Quick Time Adjustments -->
              <div class="flex items-center gap-1">
                <button type="button" class="btn-secondary btn-sm" id="btnSubHour" title="Subtract 1 hour" style="padding: 2px 7px; font-size: 11px;">
                  -1h
                </button>
                <button type="button" class="btn-secondary btn-sm" id="btnAddHour" title="Add 1 hour" style="padding: 2px 7px; font-size: 11px;">
                  +1h
                </button>
                <button type="button" class="btn-secondary btn-sm" id="btnSubDay" title="Subtract 1 day" style="padding: 2px 7px; font-size: 11px;">
                  -1d
                </button>
                <button type="button" class="btn-secondary btn-sm" id="btnAddDay" title="Add 1 day" style="padding: 2px 7px; font-size: 11px;">
                  +1d
                </button>
              </div>
            </div>

            <!-- Formatted Timestamp Preview -->
            <div class="inner-card flex flex-col gap-1" style="padding: var(--space-2) var(--space-3); background: var(--color-bg-base);">
              <span class="text-xs text-muted font-semibold">SELECTED TIMESTAMP</span>
              <div class="font-mono text-xs font-semibold text-accent" id="timestampReadout">
                ${this.formatFullPreview(this.selectedDate)}
              </div>
            </div>

            <!-- Shift Subsequent Photos Checkbox -->
            <label class="flex items-start gap-2 cursor-pointer mt-1">
              <input type="checkbox" id="chkShiftRemaining" ${this.shiftRemaining ? 'checked' : ''} style="margin-top: 3px;" />
              <div class="text-xs">
                <strong class="text-main">Shift all subsequent photos by the same offset</strong>
                <p class="text-muted mt-1" style="line-height: 1.4;">
                  Ideal if the camera trap's clock was wrong, lagged, or reset.
                </p>
              </div>
            </label>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn-secondary" id="btnCancelDate">Cancel</button>
            <button type="button" class="btn-primary" id="btnSaveDate">Apply Timestamp</button>
          </div>
        </div>
      </div>
    `;

    // Bind event handlers
    this.bindEvents();
  }

  private bindEvents(): void {
    this.querySelector('#btnCloseDateModal')?.addEventListener('click', () => this.close());
    this.querySelector('#btnCancelDate')?.addEventListener('click', () => this.close());

    // Month Navigation Buttons
    this.querySelector('#btnPrevMonth')?.addEventListener('click', () => {
      this.viewMonth--;
      if (this.viewMonth < 0) {
        this.viewMonth = 11;
        this.viewYear--;
      }
      this.render();
    });

    this.querySelector('#btnNextMonth')?.addEventListener('click', () => {
      this.viewMonth++;
      if (this.viewMonth > 11) {
        this.viewMonth = 0;
        this.viewYear++;
      }
      this.render();
    });

    // Month & Year Select Dropdowns
    this.querySelector('#selectMonth')?.addEventListener('change', (e) => {
      this.viewMonth = parseInt((e.target as HTMLSelectElement).value, 10);
      this.render();
    });

    this.querySelector('#selectYear')?.addEventListener('change', (e) => {
      this.viewYear = parseInt((e.target as HTMLSelectElement).value, 10);
      this.render();
    });

    // Jump to Today
    this.querySelector('#btnToday')?.addEventListener('click', () => {
      const now = new Date();
      this.selectedDate.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());
      this.viewYear = now.getFullYear();
      this.viewMonth = now.getMonth();
      this.render();
    });

    // Calendar Day Clicking
    this.querySelectorAll<HTMLButtonElement>('.calendar-day-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const y = parseInt(btn.dataset.year || '', 10);
        const m = parseInt(btn.dataset.month || '', 10);
        const d = parseInt(btn.dataset.date || '', 10);

        if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
          this.selectedDate.setFullYear(y, m, d);
          this.viewYear = y;
          this.viewMonth = m;
          this.render();
        }
      });
    });

    // Time Hours and Minutes Inputs
    const updateTimeFromInputs = () => {
      const hInput = this.querySelector<HTMLInputElement>('#inputHour');
      const mInput = this.querySelector<HTMLInputElement>('#inputMinute');
      let h = parseInt(hInput?.value || '0', 10);
      let m = parseInt(mInput?.value || '0', 10);

      if (isNaN(h) || h < 0) h = 0;
      if (h > 23) h = 23;
      if (isNaN(m) || m < 0) m = 0;
      if (m > 59) m = 59;

      this.selectedDate.setHours(h, m);
      const readout = this.querySelector('#timestampReadout');
      if (readout) readout.textContent = this.formatFullPreview(this.selectedDate);
    };

    this.querySelector('#inputHour')?.addEventListener('change', updateTimeFromInputs);
    this.querySelector('#inputMinute')?.addEventListener('change', updateTimeFromInputs);

    // Quick Time Adjustments
    this.querySelector('#btnAddHour')?.addEventListener('click', () => {
      this.selectedDate = new Date(this.selectedDate.getTime() + 3600000);
      this.viewYear = this.selectedDate.getFullYear();
      this.viewMonth = this.selectedDate.getMonth();
      this.render();
    });

    this.querySelector('#btnSubHour')?.addEventListener('click', () => {
      this.selectedDate = new Date(this.selectedDate.getTime() - 3600000);
      this.viewYear = this.selectedDate.getFullYear();
      this.viewMonth = this.selectedDate.getMonth();
      this.render();
    });

    this.querySelector('#btnAddDay')?.addEventListener('click', () => {
      this.selectedDate = new Date(this.selectedDate.getTime() + 86400000);
      this.viewYear = this.selectedDate.getFullYear();
      this.viewMonth = this.selectedDate.getMonth();
      this.render();
    });

    this.querySelector('#btnSubDay')?.addEventListener('click', () => {
      this.selectedDate = new Date(this.selectedDate.getTime() - 86400000);
      this.viewYear = this.selectedDate.getFullYear();
      this.viewMonth = this.selectedDate.getMonth();
      this.render();
    });

    // Checkbox state
    this.querySelector('#chkShiftRemaining')?.addEventListener('change', (e) => {
      this.shiftRemaining = (e.target as HTMLInputElement).checked;
    });

    // Save
    this.querySelector('#btnSaveDate')?.addEventListener('click', () => {
      if (!this.item) return;

      const iso = this.selectedDate.toISOString();
      const shift = this.shiftRemaining;

      if (this.mode === 'project') {
        const fn = this.item.fileName || this.item.filename || '';
        projectStore.updateItemDate(fn, iso, shift);
      } else {
        const id = this.item.id || this.item.filename || '';
        quickStore.updateItemDate(id, iso, shift);
      }
      this.close();
    });
  }
}

customElements.define('date-editor-modal', DateEditorModal);

declare global {
  interface HTMLElementTagNameMap {
    'date-editor-modal': DateEditorModal;
  }
}
