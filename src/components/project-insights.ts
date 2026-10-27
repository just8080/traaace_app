import { showValueLabel } from '../services/chart-labels';
import { showToast } from '../services/ui-scale';
import { ipc } from '../services/tauri-bridge';
import { icon } from '../services/icons';
import { html, escapeHtml, isVideoFile } from '../utils';

const SPECIES_PALETTE = [
  '#10B981', // Day Emerald Green
  '#6366F1', // Night Indigo
  '#F59E0B', // Dawn Warm Amber
  '#F43F5E', // Dusk Rose Coral
  '#06B6D4', // Vibrant Cyan / Sky
  '#8B5CF6', // Vivid Violet / Purple
  '#EAB308', // Sun Gold
  '#EC4899', // Bright Pink
  '#14B8A6', // Ocean Teal
  '#3B82F6', // Clear Royal Blue
  '#84CC16', // Fresh Lime
  '#64748B'  // Neutral Slate
];

interface ObservationRecord {
  id: string;
  timestamp: string;
  dateStr?: string;
  year?: number;
  month?: number;
  day?: number;
  dayOfWeek?: number;
  hour?: number;
  site: string;
  batch?: string;
  species: string;
  count: number;
  comment?: string;
  filename?: string;
  source?: string;
}

export class ProjectInsights extends HTMLElement {
  private observations: ObservationRecord[] = [];
  private period: 'week' | 'month' | 'year' | 'all' | 'custom' = 'all';
  /** Custom range as local YYYY-MM-DD strings; filled from the data when Custom is first chosen. */
  private customStart = '';
  private customEnd = '';
  private referenceDate = new Date();
  private siteFilter = 'ALL';
  private batchFilter = 'ALL';
  private speciesFilter = 'ALL';
  private mediaFilter: 'ALL' | 'photo' | 'video' = 'ALL';
  private metric: 'animals' | 'frames' = 'animals';
  private searchQuery = '';
  private speciesColors: Record<string, string> = {};
  private tooltipEl: HTMLDivElement | null = null;

  connectedCallback(): void {
    this.loadData();
  }

  disconnectedCallback(): void {
    if (this.tooltipEl && this.tooltipEl.parentNode) {
      this.tooltipEl.parentNode.removeChild(this.tooltipEl);
      this.tooltipEl = null;
    }
  }

  private async loadData(): Promise<void> {
    try {
      const res = await ipc.getAnalyticsData();
      this.observations = res?.observations || [];
      this.render();
    } catch (err) {
      console.error('Failed to load analytics data:', err);
    }
  }

  private assignSpeciesColor(speciesName: string): string {
    if (!this.speciesColors[speciesName]) {
      const idx = Object.keys(this.speciesColors).length % SPECIES_PALETTE.length;
      this.speciesColors[speciesName] = SPECIES_PALETTE[idx];
    }
    return this.speciesColors[speciesName];
  }

  private getTooltipElement(): HTMLDivElement {
    if (!this.tooltipEl) {
      this.tooltipEl = document.createElement('div');
      this.tooltipEl.className = 'chart-tooltip';
      document.body.appendChild(this.tooltipEl);
    }
    return this.tooltipEl;
  }

  private showTooltip(e: MouseEvent, title: string, rows: Array<{ label: string; value: string | number; color?: string }>): void {
    const tip = this.getTooltipElement();
    tip.style.background = 'var(--color-bg-surface, #ffffff)';
    tip.style.backgroundColor = 'var(--color-bg-surface, #ffffff)';
    tip.style.backdropFilter = 'none';
    (tip.style as any).webkitBackdropFilter = 'none';
    tip.style.padding = '12px 16px';
    tip.style.border = '1px solid var(--color-border-strong, #afb8c1)';
    tip.style.borderRadius = 'var(--radius-md, 8px)';
    tip.style.boxShadow = '0 10px 25px -3px rgba(0, 0, 0, 0.22), 0 4px 6px -2px rgba(0, 0, 0, 0.12)';

    let html = `<div class="tooltip-title">${this.escape(title)}</div>`;
    rows.forEach(r => {
      html += `
        <div class="tooltip-row">
          <span>${this.escape(r.label)}</span>
          <span class="tooltip-row-val" ${r.color ? `style="color: ${r.color};"` : ''}>${this.escape(String(r.value))}</span>
        </div>
      `;
    });
    tip.innerHTML = html;
    tip.style.left = `${e.clientX + 10}px`;
    tip.style.top = `${e.clientY + 10}px`;
    tip.classList.add('visible');
  }

  private hideTooltip(): void {
    if (this.tooltipEl) {
      this.tooltipEl.classList.remove('visible');
    }
  }

  private escape(str: string): string {
    return escapeHtml(str);
  }

  private formatLocalDate(d: Date): string {
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${yr}-${mo}-${day}`;
  }

  private formatDisplayTimestamp(ts: string): string {
    if (!ts) return '—';
    const d = new Date(ts);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString();
    }
    return ts;
  }

  private mediaType(item: ObservationRecord): 'photo' | 'video' {
    return isVideoFile(item.filename || '') ? 'video' : 'photo';
  }

  private mediaLabel(item: ObservationRecord): string {
    return this.mediaType(item) === 'video' ? 'Video' : 'Photo';
  }

  /** Observations inside the chosen period that also match the site, project, species and media filters. */
  private applyFilters(config: { filterFn: (item: ObservationRecord) => boolean }): ObservationRecord[] {
    return this.observations.filter(item => {
      if (!config.filterFn(item)) return false;
      if (this.siteFilter !== 'ALL' && item.site !== this.siteFilter) return false;
      if (this.batchFilter !== 'ALL' && item.batch !== this.batchFilter) return false;
      if (this.speciesFilter !== 'ALL' && item.species !== this.speciesFilter) return false;
      if (this.mediaFilter !== 'ALL' && this.mediaType(item) !== this.mediaFilter) return false;
      return true;
    });
  }

  private shiftPeriod(delta: number): void {
    const d = new Date(this.referenceDate);
    if (this.period === 'week') {
      d.setDate(d.getDate() + delta * 7);
    } else if (this.period === 'month') {
      d.setMonth(d.getMonth() + delta);
    } else if (this.period === 'year') {
      d.setFullYear(d.getFullYear() + delta);
    }
    this.referenceDate = d;
    this.render();
  }

  private parseLocalDate(ymd: string): Date {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }

  private observationDate(item: ObservationRecord): string {
    return item.dateStr || item.timestamp.slice(0, 10);
  }

  /** Earliest and latest observation dates, or null when there is no data. */
  private dataDateRange(): { min: string; max: string } | null {
    let min = '';
    let max = '';
    for (const o of this.observations) {
      const ds = this.observationDate(o);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) continue;
      if (!min || ds < min) min = ds;
      if (!max || ds > max) max = ds;
    }
    return min ? { min, max } : null;
  }

  /** Defaults the custom range to the span of the data (or the last 30 days when there is none). */
  private setFullCustomRange(): void {
    const range = this.dataDateRange();
    if (range) {
      this.customStart = range.min;
      this.customEnd = range.max;
    } else {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 29);
      this.customStart = this.formatLocalDate(start);
      this.customEnd = this.formatLocalDate(end);
    }
  }

  private getCustomConfig() {
    if (!this.customStart || !this.customEnd) this.setFullCustomRange();
    let startStr = this.customStart;
    let endStr = this.customEnd;
    if (startStr > endStr) [startStr, endStr] = [endStr, startStr];

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fullMonthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const start = this.parseLocalDate(startStr);
    const end = this.parseLocalDate(endStr);
    const fmt = (d: Date) => `${monthNames[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    const inRange = (a: string, b: string) => (item: ObservationRecord) => {
      const ds = this.observationDate(item);
      return ds >= a && ds <= b;
    };

    const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    const monthSpan = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1;
    const buckets: any[] = [];
    let granularity: string;

    if (days <= 31) {
      granularity = 'Daily';
      for (let i = 0; i < days; i++) {
        const b = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const key = this.formatLocalDate(b);
        buckets.push({ key, label: `${b.getDate()}`, sublabel: fmt(b), matchFn: (item: ObservationRecord) => this.observationDate(item) === key });
      }
    } else if (days <= 140) {
      granularity = 'Weekly';
      for (let offset = 0; offset < days; offset += 7) {
        const bStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
        const bEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + Math.min(offset + 6, days - 1));
        buckets.push({
          key: this.formatLocalDate(bStart),
          label: `${monthNames[bStart.getMonth()]} ${bStart.getDate()}`,
          sublabel: `${fmt(bStart)} – ${fmt(bEnd)}`,
          matchFn: inRange(this.formatLocalDate(bStart), this.formatLocalDate(bEnd))
        });
      }
    } else if (monthSpan <= 60) {
      granularity = 'Monthly';
      const crossesYears = start.getFullYear() !== end.getFullYear();
      for (let i = 0; i < monthSpan; i++) {
        const b = new Date(start.getFullYear(), start.getMonth() + i, 1);
        const prefix = `${b.getFullYear()}-${String(b.getMonth() + 1).padStart(2, '0')}`;
        buckets.push({
          key: prefix,
          label: crossesYears ? `${monthNames[b.getMonth()]} ${String(b.getFullYear()).slice(2)}` : monthNames[b.getMonth()],
          sublabel: `${fullMonthNames[b.getMonth()]} ${b.getFullYear()}`,
          matchFn: (item: ObservationRecord) => this.observationDate(item).slice(0, 7) === prefix
        });
      }
    } else {
      granularity = 'Yearly';
      for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
        buckets.push({ key: `${y}`, label: `${y}`, sublabel: `Year ${y}`, matchFn: (item: ObservationRecord) => this.observationDate(item).slice(0, 4) === `${y}` });
      }
    }

    return {
      title: `${fmt(start)} – ${fmt(end)}`,
      subtitle: `${days} day${days === 1 ? '' : 's'} · ${granularity.toLowerCase()} breakdown`,
      buckets,
      filterFn: inRange(startStr, endStr)
    };
  }

  private getPeriodConfig() {
    if (this.period === 'custom') return this.getCustomConfig();
    const ref = new Date(this.referenceDate);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fullMonthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    if (this.period === 'week') {
      const day = ref.getDay();
      const diffToMon = ref.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(ref.setDate(diffToMon));
      monday.setHours(0, 0, 0, 0);

      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);

      const title = `${monthNames[monday.getMonth()]} ${monday.getDate()} – ${monthNames[sunday.getMonth()]} ${sunday.getDate()}, ${sunday.getFullYear()}`;
      const subtitle = `Daily activity breakdown across 7 days`;
      const startDayStr = this.formatLocalDate(monday);
      const endDayStr = this.formatLocalDate(sunday);

      const buckets: any[] = [];
      for (let i = 0; i < 7; i++) {
        const bDate = new Date(monday);
        bDate.setDate(monday.getDate() + i);
        const bDayStr = this.formatLocalDate(bDate);
        buckets.push({
          key: bDayStr,
          label: `${dayNames[bDate.getDay()]} ${bDate.getDate()}`,
          sublabel: bDayStr,
          matchFn: (item: ObservationRecord) => (item.dateStr || item.timestamp.slice(0, 10)) === bDayStr
        });
      }

      return {
        title,
        subtitle,
        buckets,
        filterFn: (item: ObservationRecord) => {
          const ds = item.dateStr || item.timestamp.slice(0, 10);
          return ds >= startDayStr && ds <= endDayStr;
        }
      };
    }

    if (this.period === 'month') {
      const yr = ref.getFullYear();
      const mo = ref.getMonth();
      const end = new Date(yr, mo + 1, 0);
      const totalDays = end.getDate();

      const title = `${fullMonthNames[mo]} ${yr}`;
      const subtitle = `Daily observation activity across ${totalDays} days`;

      const buckets: any[] = [];
      for (let d = 1; d <= totalDays; d++) {
        const bDate = new Date(yr, mo, d);
        const bDayStr = this.formatLocalDate(bDate);
        buckets.push({
          key: bDayStr,
          label: `${d}`,
          sublabel: `${monthNames[mo]} ${d}`,
          matchFn: (item: ObservationRecord) => (item.dateStr || item.timestamp.slice(0, 10)) === bDayStr
        });
      }

      return {
        title,
        subtitle,
        buckets,
        filterFn: (item: ObservationRecord) => {
          const d = new Date(item.timestamp);
          return d.getFullYear() === yr && d.getMonth() === mo;
        }
      };
    }

    if (this.period === 'year') {
      const yr = ref.getFullYear();
      const title = `Year ${yr}`;
      const subtitle = `Monthly distribution across 12 months`;

      const buckets: any[] = [];
      for (let m = 0; m < 12; m++) {
        buckets.push({
          key: `${yr}-${m + 1}`,
          label: monthNames[m],
          sublabel: `${fullMonthNames[m]} ${yr}`,
          matchFn: (item: ObservationRecord) => {
            const d = new Date(item.timestamp);
            return d.getFullYear() === yr && d.getMonth() === m;
          }
        });
      }

      return {
        title,
        subtitle,
        buckets,
        filterFn: (item: ObservationRecord) => {
          const d = new Date(item.timestamp);
          return d.getFullYear() === yr;
        }
      };
    }

    // 'all' = All Years
    const years = Array.from(new Set(this.observations.map(i => new Date(i.timestamp).getFullYear()))).filter(y => !isNaN(y)).sort();
    const minYr = years[0] || new Date().getFullYear();
    const maxYr = years[years.length - 1] || new Date().getFullYear();

    const title = `All Surveyed Years (${minYr} – ${maxYr})`;
    const subtitle = `Multi-year observation patterns across all projects`;

    const buckets: any[] = [];
    for (let y = minYr; y <= maxYr; y++) {
      buckets.push({
        key: `${y}`,
        label: `${y}`,
        sublabel: `Year ${y}`,
        matchFn: (item: ObservationRecord) => new Date(item.timestamp).getFullYear() === y
      });
    }

    return {
      title,
      subtitle,
      buckets,
      filterFn: () => true
    };
  }

  private render(): void {
    const pane = document.getElementById('projectContentPane');
    const prevScroll = pane ? pane.scrollTop : 0;
    const config = this.getPeriodConfig();

    // Available Sites, Projects & Species for Filters
    const sites = Array.from(new Set(this.observations.map(i => i.site).filter(Boolean))).sort();
    const batches = Array.from(new Set(this.observations.map(i => i.batch).filter(Boolean))).sort() as string[];
    const speciesList = Array.from(new Set(this.observations.map(i => i.species).filter(Boolean))).sort();

    // Filter observations
    const filtered = this.applyFilters(config);

    // Compute KPIs
    const totalFrames = filtered.length;
    const totalAnimals = filtered.reduce((sum, r) => sum + (r.count || 1), 0);
    const avgAnimals = totalFrames > 0 ? (totalAnimals / totalFrames).toFixed(1) : '0';

    // Top Species
    const speciesCounts: Record<string, number> = {};
    filtered.forEach(r => {
      const sp = r.species || 'Unknown';
      speciesCounts[sp] = (speciesCounts[sp] || 0) + (this.metric === 'animals' ? (r.count || 1) : 1);
    });
    const sortedSpecies = Object.entries(speciesCounts).sort((a, b) => b[1] - a[1]);
    const topSpeciesName = sortedSpecies[0] ? sortedSpecies[0][0] : '—';
    const topSpeciesCount = sortedSpecies[0] ? sortedSpecies[0][1] : 0;
    const topSpeciesPct = (this.metric === 'animals' ? totalAnimals : totalFrames) > 0
      ? Math.round((topSpeciesCount / (this.metric === 'animals' ? totalAnimals : totalFrames)) * 100)
      : 0;

    // Peak Activity Hour
    const hourCounts = new Array(24).fill(0);
    filtered.forEach(r => {
      const h = r.hour !== undefined ? r.hour : new Date(r.timestamp).getHours();
      if (h >= 0 && h < 24) {
        hourCounts[h] += (this.metric === 'animals' ? (r.count || 1) : 1);
      }
    });
    let peakHour = 0;
    let peakVal = 0;
    hourCounts.forEach((val, h) => {
      if (val > peakVal) {
        peakVal = val;
        peakHour = h;
      }
    });
    const pad = (n: number) => String(n).padStart(2, '0');
    const peakTimeString = peakVal > 0 ? `${pad(peakHour)}:00 – ${pad((peakHour + 1) % 24)}:00` : '—';

    // Populate timeline buckets
    config.buckets.forEach(b => {
      const bItems = filtered.filter(b.matchFn);
      b.items = bItems;
      b.frames = bItems.length;
      b.animals = bItems.reduce((acc, curr) => acc + (curr.count || 1), 0);
      b.val = this.metric === 'animals' ? b.animals : b.frames;
      b.speciesMap = {};
      bItems.forEach(it => {
        const sp = it.species || 'Unknown';
        b.speciesMap[sp] = (b.speciesMap[sp] || 0) + (this.metric === 'animals' ? (it.count || 1) : 1);
      });
    });

    // Filter table records by search
    const query = this.searchQuery.trim().toLowerCase();
    const tableRecords = filtered.filter(r => {
      if (!query) return true;
      return (r.species && r.species.toLowerCase().includes(query))
        || (r.site && r.site.toLowerCase().includes(query))
        || (r.batch && r.batch.toLowerCase().includes(query))
        || (r.comment && r.comment.toLowerCase().includes(query))
        || (r.filename && r.filename.toLowerCase().includes(query));
    });

    this.innerHTML = html`
      <div
        style="display: flex; flex-direction: column; padding: 1.5rem 2rem 3rem 2rem; max-width: 1400px; margin: 0 auto; width: 100%;">
        <!-- View Header -->
        <div style="margin-bottom: var(--space-4);">
          <h1 style="font-size: var(--text-2xl); font-weight: 700; color: var(--color-text-main); margin: 0;">Insights</h1>
          <p class="text-muted text-sm mt-1">
            Aggregate species detections, temporal rhythms, and longitudinal camera metrics.
          </p>
        </div>

        <!-- Period, Filters & Metric (one bar, styled like the Classify toolbar) -->
        <div class="insights-bar">
          <div class="bar-group">
            <div class="seg-group" id="periodSelector">
              ${(['week', 'month', 'year', 'all', 'custom'] as const).map(p => `
                <button type="button" class="btn-ghost seg-btn ${this.period === p ? 'btn-secondary' : ''}" data-period="${p}">${
                  { week: 'Week', month: 'Month', year: 'Year', all: 'All', custom: 'Custom' }[p]}</button>`).join('')}
            </div>

            ${this.period === 'custom' ? `
              <label class="bar-field" title="${config.subtitle}"><span>From</span>
                <input type="date" id="inputRangeStart" value="${this.customStart}" max="${this.customEnd}" />
              </label>
              <label class="bar-field" title="${config.subtitle}"><span>To</span>
                <input type="date" id="inputRangeEnd" value="${this.customEnd}" min="${this.customStart}" />
              </label>
              <button type="button" class="btn-ghost bar-btn" id="btnFullRange" title="Use the full date range of your data">Full range</button>
            ` : `
              ${this.period !== 'all' ? `<button type="button" class="btn-ghost bar-btn" id="btnPrevPeriod" title="Previous">◀</button>` : ''}
              <span class="bar-title" title="${config.subtitle}">${config.title}</span>
              ${this.period !== 'all' ? `
                <button type="button" class="btn-ghost bar-btn" id="btnNextPeriod" title="Next">▶</button>
                <button type="button" class="btn-secondary bar-btn" id="btnCurrentPeriod">Current</button>` : ''}
            `}
          </div>

          <div class="bar-group bar-group-right">
            <label class="bar-field" title="Filter by site">
              <select id="selectSiteFilter" aria-label="Filter by site">
                <option value="ALL">All Sites</option>
                ${sites.map(s => `<option value="${escapeHtml(s)}" ${s === this.siteFilter ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
              </select>
            </label>
            <label class="bar-field" title="Filter by project">
              <select id="selectBatchFilter" aria-label="Filter by project">
                <option value="ALL">All Projects</option>
                ${batches.map(b => `<option value="${escapeHtml(b)}" ${b === this.batchFilter ? 'selected' : ''}>${escapeHtml(b)}</option>`).join('')}
              </select>
            </label>
            <label class="bar-field" title="Filter by species">
              <select id="selectSpeciesFilter" aria-label="Filter by species">
                <option value="ALL">All Species</option>
                ${speciesList.map(sp => `<option value="${escapeHtml(sp)}" ${sp === this.speciesFilter ? 'selected' : ''}>${escapeHtml(sp)}</option>`).join('')}
              </select>
            </label>
            <label class="bar-field" title="Filter by photo or video">
              <select id="selectMediaFilter" aria-label="Filter by photo or video">
                <option value="ALL" ${this.mediaFilter === 'ALL' ? 'selected' : ''}>All Media</option>
                <option value="photo" ${this.mediaFilter === 'photo' ? 'selected' : ''}>Photos</option>
                <option value="video" ${this.mediaFilter === 'video' ? 'selected' : ''}>Videos</option>
              </select>
            </label>
            <div class="seg-group" id="metricToggle">
              <button type="button" class="btn-ghost seg-btn ${this.metric === 'animals' ? 'btn-secondary' : ''}" data-metric="animals">Animals</button>
              <button type="button" class="btn-ghost seg-btn ${this.metric === 'frames' ? 'btn-secondary' : ''}" data-metric="frames">Frames</button>
            </div>
            <button type="button" class="btn-secondary bar-btn" id="btnRefreshAnalytics" title="Reload data" aria-label="Reload data">
              ${icon('refresh')}
            </button>
          </div>
        </div>

        <!-- 4 KPI Metrics Grid -->
        <div class="kpi-metrics-grid"
          style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem;">
          <div class="card kpi-card"
            style="background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem;">
            <div class="kpi-content">
              <span class="kpi-label"
                style="font-size: 0.75rem; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase;">Observations
                (Frames)</span>
              <h2 class="kpi-value" style="font-size: 2rem; font-weight: 700; color: var(--color-brand); margin: 4px 0;">
                ${totalFrames.toLocaleString()}</h2>
              <span class="kpi-hint" style="font-size: 0.75rem; color: var(--color-text-muted);">${totalFrames} camera
                triggers recorded</span>
            </div>
          </div>
      
          <div class="card kpi-card"
            style="background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem;">
            <div class="kpi-content">
              <span class="kpi-label"
                style="font-size: 0.75rem; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase;">Animals
                Counted</span>
              <h2 class="kpi-value" style="font-size: 2rem; font-weight: 700; color: var(--color-accent); margin: 4px 0;">
                ${totalAnimals.toLocaleString()}</h2>
              <span class="kpi-hint" style="font-size: 0.75rem; color: var(--color-text-muted);">Avg ${avgAnimals} animals /
                trigger</span>
            </div>
          </div>
      
          <div class="card kpi-card"
            style="background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem;">
            <div class="kpi-content">
              <span class="kpi-label"
                style="font-size: 0.75rem; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase;">Peak
                Activity Period</span>
              <h2 class="kpi-value"
                style="font-size: 1.75rem; font-weight: 700; color: var(--color-text-main); margin: 4px 0;">${peakTimeString}
              </h2>
              <span class="kpi-hint" style="font-size: 0.75rem; color: var(--color-text-muted);">${peakVal} ${this.metric}
                recorded at peak</span>
            </div>
          </div>
      
          <div class="card kpi-card"
            style="background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem;">
            <div class="kpi-content">
              <span class="kpi-label"
                style="font-size: 0.75rem; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase;">Top
                Observed Species</span>
              <h2 class="kpi-value"
                style="font-size: 1.75rem; font-weight: 700; color: var(--color-text-main); margin: 4px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                title="${topSpeciesName}">${topSpeciesName}</h2>
              <span class="kpi-hint" style="font-size: 0.75rem; color: var(--color-text-muted);">${topSpeciesCount} detections
                (${topSpeciesPct}% of period)</span>
            </div>
          </div>
        </div>
      
        <!-- Main Charts: Timeline & Species Donut -->
        <div style="display: grid; grid-template-columns: 2fr 1.2fr; gap: 1.5rem; margin-bottom: 1.5rem;">
          <!-- Timeline Card -->
          <div class="card chart-card"
            style="background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem; display: flex; flex-direction: column;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <div>
                <strong style="font-size: 1rem; color: var(--color-text-main);">Observation Activity Over Time</strong>
                <span style="display: block; font-size: 0.75rem; color: var(--color-text-muted);">${config.title}</span>
              </div>
            </div>
            <div id="timelineContainer" style="width: 100%; height: 260px; min-height: 260px;"></div>
          </div>
      
          <!-- Species Composition Donut -->
          <div class="card chart-card"
            style="background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem; display: flex; flex-direction: column;">
            <div style="margin-bottom: 1rem;">
              <strong style="font-size: 1rem; color: var(--color-text-main);">Species Composition</strong>
              <span style="display: block; font-size: 0.75rem; color: var(--color-text-muted);">Relative taxa frequency</span>
            </div>
            <div style="display: flex; align-items: center; gap: 1rem; height: 260px;">
              <div id="donutContainer" style="width: 180px; height: 180px; flex-shrink: 0;"></div>
              <div id="donutLegend"
                style="flex: 1; overflow-y: auto; max-height: 240px; display: flex; flex-direction: column; gap: 6px;"></div>
            </div>
          </div>
        </div>
      
        <!-- Secondary Charts: 24-Hour Rhythm & Camera Sites -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem;">
          <!-- 24-Hour Rhythm -->
          <div class="card chart-card"
            style="background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem; display: flex; flex-direction: column;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <div>
                <strong style="font-size: 1rem; color: var(--color-text-main);">24-Hour Activity Rhythm</strong>
                <span style="display: block; font-size: 0.75rem; color: var(--color-text-muted);">Circadian trigger
                  distribution (00:00 – 23:00)</span>
              </div>
              <div style="display: flex; gap: 4px; font-size: 11px;">
                <span class="badge" style="background: rgba(99, 102, 241, 0.2); color: #818cf8;">Night</span>
                <span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24;">Dawn</span>
                <span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #34d399;">Day</span>
                <span class="badge" style="background: rgba(244, 63, 94, 0.2); color: #fb7185;">Dusk</span>
              </div>
            </div>
            <div id="diurnalContainer" style="width: 100%; height: 220px; min-height: 220px;"></div>
          </div>
      
          <!-- Camera Sites Comparison -->
          <div class="card chart-card"
            style="background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem; display: flex; flex-direction: column;">
            <div style="margin-bottom: 1rem;">
              <strong style="font-size: 1rem; color: var(--color-text-main);">Camera Sites</strong>
              <span style="display: block; font-size: 0.75rem; color: var(--color-text-muted);">Observations across surveyed
                locations</span>
            </div>
            <div id="sitesContainer"
              style="flex: 1; overflow-y: auto; max-height: 220px; display: flex; flex-direction: column; gap: 8px;"></div>
          </div>
        </div>
      
        <!-- Observation Records Table -->
        <div class="card analytics-table-card"
          style="background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem;">
          <div
            style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 1rem;">
            <div>
              <strong style="font-size: 1rem; color: var(--color-text-main);">Observation Records Database</strong>
              <span id="tableRecordCountSubtitle" style="display: block; font-size: 0.75rem; color: var(--color-text-muted);">
                Showing ${Math.min(tableRecords.length, 100)} of ${tableRecords.length} records in period
                (${this.observations.length} total)
              </span>
            </div>
            <div style="display: flex; gap: 0.75rem; align-items: center;">
              <input type="text" id="inputTableSearch" placeholder="Search species, site, project, comment..."
                value="${this.searchQuery}"
                style="width: 260px; font-size: 0.75rem; padding: 6px 10px; border-radius: var(--radius-sm); border: 1px solid var(--color-border); background: var(--color-bg-base); color: var(--color-text-main);" />
              <button class="btn-secondary" id="btnImportCsv" style="font-size: 0.75rem; height: 32px; padding: 0 12px;"
                title="Import observation records from CSV manifest">
                ${icon('table-import')} Import CSV
              </button>
              <button class="btn-secondary" id="btnExportCsv" style="font-size: 0.75rem; height: 32px; padding: 0 12px;">
                ${icon('table-export')} Export CSV
              </button>
            </div>
          </div>
      
          <div
            style="overflow-x: auto; max-height: 400px; overflow-y: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md);">
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.8125rem;">
              <thead
                style="position: sticky; top: 0; background: var(--color-bg-base); border-bottom: 1px solid var(--color-border); font-size: 0.75rem; color: var(--color-text-muted);">
                <tr>
                  <th style="padding: 8px 12px;">Timestamp</th>
                  <th style="padding: 8px 12px;">Site</th>
                  <th style="padding: 8px 12px;">Project</th>
                  <th style="padding: 8px 12px;">Species</th>
                  <th style="padding: 8px 12px; text-align: right;">Count</th>
                  <th style="padding: 8px 12px;">Comment</th>
                  <th style="padding: 8px 12px;">Filename</th>
                  <th style="padding: 8px 12px;">Media</th>
                </tr>
              </thead>
              <tbody id="observationTableBody">
                ${tableRecords.length === 0 ? `
                <tr>
                  <td colspan="8" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">
                    No observation records match current filters.
                  </td>
                </tr>
                ` : tableRecords.slice(0, 100).map(r => {
      const spColor = this.assignSpeciesColor(r.species);
      return `
                <tr style="border-bottom: 1px solid var(--color-border);">
                  <td
                    style="padding: 8px 12px; font-family: var(--font-mono); font-size: 0.75rem; color: var(--color-text-muted);">
                    ${this.formatDisplayTimestamp(r.timestamp)}</td>
                  <td style="padding: 8px 12px; font-weight: 600;">${escapeHtml(r.site)}</td>
                  <td
                    style="padding: 8px 12px; font-family: var(--font-mono); font-size: 0.75rem; color: var(--color-text-muted);">
                    ${escapeHtml(r.batch) || '—'}</td>
                  <td style="padding: 8px 12px;">
                    <span style="display: inline-flex; align-items: center; gap: 6px;">
                      <span class="legend-dot" ${spColor ? `style="background-color: ${spColor};" ` : ''}></span>
                      <strong>${escapeHtml(r.species)}</strong>
                    </span>
                  </td>
                  <td style="padding: 8px 12px; text-align: right; font-weight: 600;">${r.count || 1}</td>
                  <td style="padding: 8px 12px; color: var(--color-text-muted);">${escapeHtml(r.comment) || '—'}</td>
                  <td
                    style="padding: 8px 12px; font-family: var(--font-mono); font-size: 0.75rem; color: var(--color-text-muted);">
                    ${escapeHtml(r.filename) || '—'}</td>
                  <td style="padding: 8px 12px; color: var(--color-text-muted);">${this.mediaLabel(r)}</td>
                </tr>
                `;
    }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Render SVG Charts into containers
    this.renderTimelineChart(config.buckets);
    this.renderDonutChart(filtered);
    this.renderDiurnalChart(filtered);
    this.renderSitesChart(filtered);

    // Event Listeners: Granularity
    this.querySelectorAll('#periodSelector .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.period = (btn.getAttribute('data-period') as any) || 'all';
        if (this.period === 'custom' && (!this.customStart || !this.customEnd)) this.setFullCustomRange();
        this.render();
      });
    });

    // Custom date range: keep start <= end by pulling the other end along
    this.querySelector<HTMLInputElement>('#inputRangeStart')?.addEventListener('change', (e) => {
      const v = (e.target as HTMLInputElement).value;
      if (!v) return;
      this.customStart = v;
      if (this.customEnd < v) this.customEnd = v;
      this.render();
    });
    this.querySelector<HTMLInputElement>('#inputRangeEnd')?.addEventListener('change', (e) => {
      const v = (e.target as HTMLInputElement).value;
      if (!v) return;
      this.customEnd = v;
      if (this.customStart > v) this.customStart = v;
      this.render();
    });
    this.querySelector('#btnFullRange')?.addEventListener('click', () => {
      this.setFullCustomRange();
      this.render();
    });

    // Metric Toggle
    this.querySelectorAll('#metricToggle .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.metric = (btn.getAttribute('data-metric') as any) || 'animals';
        this.render();
      });
    });

    // Prev / Next / Current Period
    this.querySelector('#btnPrevPeriod')?.addEventListener('click', () => this.shiftPeriod(-1));
    this.querySelector('#btnNextPeriod')?.addEventListener('click', () => this.shiftPeriod(1));
    this.querySelector('#btnCurrentPeriod')?.addEventListener('click', () => {
      this.referenceDate = new Date();
      this.render();
    });

    // Site, Batch & Species Filters
    this.querySelector<HTMLSelectElement>('#selectSiteFilter')?.addEventListener('change', (e) => {
      this.siteFilter = (e.target as HTMLSelectElement).value;
      this.render();
    });

    this.querySelector<HTMLSelectElement>('#selectBatchFilter')?.addEventListener('change', (e) => {
      this.batchFilter = (e.target as HTMLSelectElement).value;
      this.render();
    });

    this.querySelector<HTMLSelectElement>('#selectSpeciesFilter')?.addEventListener('change', (e) => {
      this.speciesFilter = (e.target as HTMLSelectElement).value;
      this.render();
    });

    this.querySelector<HTMLSelectElement>('#selectMediaFilter')?.addEventListener('change', (e) => {
      this.mediaFilter = (e.target as HTMLSelectElement).value as 'ALL' | 'photo' | 'video';
      this.render();
    });

    // Search Input
    const searchInput = this.querySelector<HTMLInputElement>('#inputTableSearch');
    searchInput?.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      this.updateTableOnly();
    });

    // Refresh Data
    this.querySelector('#btnRefreshAnalytics')?.addEventListener('click', () => {
      this.loadData();
    });

    // Import CSV
    this.querySelector('#btnImportCsv')?.addEventListener('click', async () => {
      try {
        const file = await ipc.selectCsvFile();
        if (file) {
          const res = await ipc.importAnalyticsCsv(file);
          showToast(res.message || 'CSV imported successfully!');
          await this.loadData();
        }
      } catch (err) {
        showToast(`Failed to import CSV: ${err}`);
      }
    });

    // Export CSV
    this.querySelector('#btnExportCsv')?.addEventListener('click', async () => {
      if (tableRecords.length === 0) {
        showToast('No records available to export.');
        return;
      }
      try {
        const dest = await ipc.selectSaveCsvPath(`trace_insights_${this.period}_${this.formatLocalDate(new Date())}.csv`);
        if (dest) {
          const esc = (v: any) => `"${String(v || '').replace(/"/g, '""')}"`;
          let csv = 'Timestamp,Site,Batch,Species,Animal_Count,Comment,Filename,Media_Type\n';
          tableRecords.forEach(r => {
            csv += `${esc(r.timestamp)},${esc(r.site)},${esc(r.batch || '')},${esc(r.species)},${r.count || 1},${esc(r.comment)},${esc(r.filename)},${this.mediaLabel(r)}\n`;
          });
          await ipc.exportAnalyticsCsv(csv, 'trace_insights.csv', dest);
          showToast(`Successfully exported ${tableRecords.length} records to: ${dest}`);
        }
      } catch (err) {
        showToast(`Export failed: ${err}`);
      }
    });

    if (pane && prevScroll > 0) {
      pane.scrollTop = prevScroll;
    }
  }

  private updateTableOnly(): void {
    const config = this.getPeriodConfig();
    const filtered = this.applyFilters(config);

    const query = this.searchQuery.trim().toLowerCase();
    const tableRecords = filtered.filter(r => {
      if (!query) return true;
      return (r.species && r.species.toLowerCase().includes(query))
        || (r.site && r.site.toLowerCase().includes(query))
        || (r.batch && r.batch.toLowerCase().includes(query))
        || (r.comment && r.comment.toLowerCase().includes(query))
        || (r.filename && r.filename.toLowerCase().includes(query));
    });

    const sub = this.querySelector('#tableRecordCountSubtitle');
    if (sub) {
      sub.textContent = `Showing ${Math.min(tableRecords.length, 100)} of ${tableRecords.length} records in period (${this.observations.length} total)`;
    }

    const tbody = this.querySelector('#observationTableBody');
    if (tbody) {
      if (tableRecords.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="8" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">
              No observation records match current filters.
            </td>
          </tr>
        `;
      } else {
        tbody.innerHTML = tableRecords.slice(0, 100).map(r => {
          const spColor = this.assignSpeciesColor(r.species);
          return `
            <tr style="border-bottom: 1px solid var(--color-border);">
              <td style="padding: 8px 12px; font-family: var(--font-mono); font-size: 0.75rem; color: var(--color-text-muted);">${this.formatDisplayTimestamp(r.timestamp)}</td>
              <td style="padding: 8px 12px; font-weight: 600;">${escapeHtml(r.site)}</td>
              <td style="padding: 8px 12px; font-family: var(--font-mono); font-size: 0.75rem; color: var(--color-text-muted);">${escapeHtml(r.batch) || '—'}</td>
              <td style="padding: 8px 12px;">
                <span style="display: inline-flex; align-items: center; gap: 6px;">
                  <span class="legend-dot" ${spColor ? `style="background-color: ${spColor};"` : ''}></span>
                  <strong>${escapeHtml(r.species)}</strong>
                </span>
              </td>
              <td style="padding: 8px 12px; text-align: right; font-weight: 600;">${r.count || 1}</td>
              <td style="padding: 8px 12px; color: var(--color-text-muted);">${escapeHtml(r.comment) || '—'}</td>
              <td style="padding: 8px 12px; font-family: var(--font-mono); font-size: 0.75rem; color: var(--color-text-muted);">${escapeHtml(r.filename) || '—'}</td>
              <td style="padding: 8px 12px; color: var(--color-text-muted);">${this.mediaLabel(r)}</td>
            </tr>
          `;
        }).join('');
      }
    }
  }

  private renderTimelineChart(buckets: any[]): void {
    const container = this.querySelector('#timelineContainer');
    if (!container) return;

    const width = 640;
    const height = 240;
    const padLeft = 40;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 35;
    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;

    const maxVal = Math.max(...buckets.map(b => b.val), 4);
    const numLines = 4;

    let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="overflow: visible; display: block;">`;

    // Horizontal Grid Lines
    for (let i = 0; i <= numLines; i++) {
      const yVal = Math.round((maxVal / numLines) * i);
      const yPos = padTop + plotHeight - (i / numLines) * plotHeight;
      svg += `
        <line x1="${padLeft}" y1="${yPos}" x2="${width - padRight}" y2="${yPos}" stroke="var(--color-border)" stroke-dasharray="${i === 0 ? 'none' : '3,3'}" stroke-width="1"/>
        <text x="${padLeft - 8}" y="${yPos + 4}" font-size="10" fill="var(--color-text-muted)" text-anchor="end" font-family="var(--font-mono)">${yVal}</text>
      `;
    }

    // Bars
    const n = buckets.length;
    const colWidth = plotWidth / Math.max(n, 1);
    // Keep bars at least 6px wide, but never wider than their column, or a crowded chart's bars overlap.
    const barWidth = Math.max(Math.min(colWidth * 0.68, 36), Math.min(6, colWidth * 0.85));
    const values = buckets.map(b => b.val as number);

    buckets.forEach((b, idx) => {
      const xCenter = padLeft + idx * colWidth + colWidth / 2;
      const xPos = xCenter - barWidth / 2;
      const barHeight = maxVal > 0 ? (b.val / maxVal) * plotHeight : 0;
      const yPos = padTop + plotHeight - barHeight;

      svg += `
        <g class="chart-timeline-bar" data-idx="${idx}" style="cursor: pointer;">
          <rect x="${xPos}" y="${yPos}" width="${barWidth}" height="${Math.max(barHeight, 2)}"
                rx="3" ry="3"
                fill="${b.val > 0 ? 'var(--color-brand)' : 'var(--color-border)'}"
                fill-opacity="${b.val > 0 ? 0.9 : 0.3}"/>
          ${barHeight > 16 && showValueLabel(idx, values, colWidth) ? `
            <text x="${xCenter}" y="${yPos - 4}" font-size="10" font-weight="700" fill="var(--color-text-main)" text-anchor="middle">${b.val}</text>
          ` : ''}
          ${(n <= 12 || idx % Math.ceil(n / 10) === 0) ? `
            <text x="${xCenter}" y="${height - padBottom + 16}" font-size="10" fill="var(--color-text-muted)" text-anchor="middle">${this.escape(b.label)}</text>
          ` : ''}
        </g>
      `;
    });

    svg += `</svg>`;
    container.innerHTML = svg;

    // Hover tooltips
    container.querySelectorAll('.chart-timeline-bar').forEach(grp => {
      const idx = parseInt(grp.getAttribute('data-idx') || '0', 10);
      const b = buckets[idx];
      if (!b) return;

      grp.addEventListener('mouseenter', (e: any) => {
        const rows: Array<{ label: string; value: any; color?: string }> = [
          { label: `Total ${this.metric === 'animals' ? 'Animals' : 'Frames'}`, value: b.val },
          { label: 'Triggers', value: b.frames }
        ];
        const sortedSp = Object.entries(b.speciesMap).sort((x: any, y: any) => y[1] - x[1]).slice(0, 3);
        sortedSp.forEach(([sp, cnt]) => {
          rows.push({ label: sp, value: cnt as number, color: this.assignSpeciesColor(sp) });
        });
        this.showTooltip(e, b.sublabel || b.label, rows);
      });

      grp.addEventListener('mousemove', (e: any) => {
        const tip = this.getTooltipElement();
        tip.style.left = `${e.clientX + 10}px`;
        tip.style.top = `${e.clientY + 10}px`;
      });

      grp.addEventListener('mouseleave', () => this.hideTooltip());
    });
  }

  private renderDonutChart(records: ObservationRecord[]): void {
    const container = this.querySelector('#donutContainer');
    const legendEl = this.querySelector('#donutLegend');
    if (!container || !legendEl) return;

    const speciesMap: Record<string, number> = {};
    records.forEach(r => {
      const sp = r.species || 'Unknown';
      speciesMap[sp] = (speciesMap[sp] || 0) + (this.metric === 'animals' ? (r.count || 1) : 1);
    });

    const sorted = Object.entries(speciesMap).sort((a, b) => b[1] - a[1]);
    const totalVal = sorted.reduce((sum, [, cnt]) => sum + cnt, 0);

    if (totalVal === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--color-text-muted); font-size: 11px; margin-top: 60px;">No observations</div>`;
      legendEl.innerHTML = '';
      return;
    }

    const slices: any[] = [];
    let otherCount = 0;
    sorted.forEach(([sp, cnt], idx) => {
      if (idx < 5) {
        slices.push({ species: sp, count: cnt, color: this.assignSpeciesColor(sp) });
      } else {
        otherCount += cnt;
      }
    });
    if (otherCount > 0) {
      slices.push({ species: 'Other species', count: otherCount, color: '#94a3b8' });
    }

    const size = 180;
    const cx = 90;
    const cy = 90;
    const r = 64;
    const strokeW = 20;
    const circ = 2 * Math.PI * r;

    let svg = `<svg viewBox="0 0 ${size} ${size}" width="100%" height="100%"><g transform="rotate(-90 ${cx} ${cy})">`;
    let offset = 0;
    slices.forEach((s) => {
      const pct = s.count / totalVal;
      const dashLen = pct * circ;
      s.pct = Math.round(pct * 100);
      svg += `
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="transparent"
                stroke="${s.color}" stroke-width="${strokeW}"
                stroke-dasharray="${dashLen} ${circ}"
                stroke-dashoffset="${-offset}"/>
      `;
      offset += dashLen;
    });

    svg += `
      </g>
      <text x="${cx}" y="${cy - 2}" font-size="20" font-weight="700" fill="var(--color-text-main)" text-anchor="middle">${totalVal.toLocaleString()}</text>
      <text x="${cx}" y="${cy + 14}" font-size="10" font-weight="600" fill="var(--color-text-muted)" text-anchor="middle">${this.metric === 'animals' ? 'Animals' : 'Frames'}</text>
    </svg>`;
    container.innerHTML = svg;

    // Legend
    legendEl.innerHTML = slices.map(s => `
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 2px 0;">
        <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
          <span class="legend-dot" ${s.color ? `style="background-color: ${s.color};"` : ''}></span>
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500;" title="${escapeHtml(s.species)}">${escapeHtml(s.species)}</span>
        </div>
        <div style="font-family: var(--font-mono); font-weight: 600; color: var(--color-text-main); margin-left: 8px;">
          ${s.count} <span style="font-weight: 400; color: var(--color-text-muted); font-size: 10px;">(${s.pct}%)</span>
        </div>
      </div>
    `).join('');
  }

  private renderDiurnalChart(records: ObservationRecord[]): void {
    const container = this.querySelector('#diurnalContainer');
    if (!container) return;

    const width = 600;
    const height = 200;
    const padLeft = 32;
    const padRight = 0;
    const padTop = 20;
    const padBottom = 35;
    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;

    const hourly = new Array(24).fill(0).map((_, h) => ({
      hour: h,
      frames: 0,
      animals: 0,
      val: 0
    }));

    records.forEach(r => {
      const h = r.hour !== undefined ? r.hour : new Date(r.timestamp).getHours();
      if (h >= 0 && h < 24) {
        hourly[h].frames++;
        hourly[h].animals += (r.count || 1);
        hourly[h].val = this.metric === 'animals' ? hourly[h].animals : hourly[h].frames;
      }
    });

    const maxVal = Math.max(...hourly.map(h => h.val), 4);
    let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="none" style="overflow: visible; display: block;">`;

    // Phase bands
    const getX = (hr: number) => padLeft + (hr / 24) * plotWidth;
    const phases = [
      { start: 0, end: 5, fill: 'rgba(99, 102, 241, 0.08)' },
      { start: 5, end: 7, fill: 'rgba(245, 158, 11, 0.12)' },
      { start: 7, end: 18, fill: 'rgba(16, 185, 129, 0.08)' },
      { start: 18, end: 20, fill: 'rgba(244, 63, 94, 0.12)' },
      { start: 20, end: 24, fill: 'rgba(99, 102, 241, 0.08)' }
    ];
    phases.forEach(p => {
      const x = getX(p.start);
      const w = getX(p.end) - x;
      svg += `<rect x="${x}" y="${padTop}" width="${w}" height="${plotHeight}" fill="${p.fill}"/>`;
    });

    // Bars
    const colWidth = plotWidth / 24;
    const barWidth = Math.max(colWidth * 0.72, 6);

    hourly.forEach((hObj, idx) => {
      const xPos = padLeft + idx * colWidth + (colWidth - barWidth) / 2;
      const barHeight = maxVal > 0 ? (hObj.val / maxVal) * plotHeight : 0;
      const yPos = padTop + plotHeight - barHeight;

      let color = '#10b981';
      if (idx < 5 || idx >= 20) color = '#6366f1';
      else if (idx >= 5 && idx < 7) color = '#f59e0b';
      else if (idx >= 18 && idx < 20) color = '#f43f5e';

      svg += `
        <g class="chart-diurnal-bar" data-hour="${idx}" style="cursor: pointer;">
          <rect x="${xPos}" y="${yPos}" width="${barWidth}" height="${Math.max(barHeight, 2)}"
                rx="2" ry="2" fill="${color}" fill-opacity="${hObj.val > 0 ? 0.9 : 0.25}"/>
        </g>
      `;
    });

    [0, 6, 12, 18, 23].forEach(hr => {
      let x = getX(hr) + colWidth / 2;
      let anchor = 'middle';
      if (hr === 0) {
        x = padLeft;
        anchor = 'start';
      } else if (hr === 23) {
        x = width;
        anchor = 'end';
      }
      const padHr = String(hr).padStart(2, '0') + ':00';
      svg += `<text x="${x}" y="${height - padBottom + 16}" font-size="10" fill="var(--color-text-muted)" text-anchor="${anchor}">${padHr}</text>`;
    });

    svg += `</svg>`;
    container.innerHTML = svg;

    // Interactive hourly hover tooltips
    container.querySelectorAll('.chart-diurnal-bar').forEach(grp => {
      const hr = parseInt(grp.getAttribute('data-hour') || '0', 10);
      const hObj = hourly[hr];
      if (!hObj) return;

      const padHr = String(hr).padStart(2, '0');
      const nextHr = String((hr + 1) % 24).padStart(2, '0');
      let phaseName = 'Day';
      let phaseColor = '#10b981';
      if (hr < 5 || hr >= 20) { phaseName = 'Night'; phaseColor = '#818cf8'; }
      else if (hr >= 5 && hr < 7) { phaseName = 'Dawn'; phaseColor = '#fbbf24'; }
      else if (hr >= 18 && hr < 20) { phaseName = 'Dusk'; phaseColor = '#fb7185'; }

      grp.addEventListener('mouseenter', (e: any) => {
        const rows: Array<{ label: string; value: any; color?: string }> = [
          { label: 'Circadian Phase', value: phaseName, color: phaseColor },
          { label: `Total ${this.metric === 'animals' ? 'Animals' : 'Frames'}`, value: hObj.val },
          { label: 'Triggers (Frames)', value: hObj.frames }
        ];

        // Collect species counts for this hour
        const hrSpecies: Record<string, number> = {};
        records.forEach(r => {
          const h = r.hour !== undefined ? r.hour : new Date(r.timestamp).getHours();
          if (h === hr) {
            const sp = r.species || 'Unknown';
            hrSpecies[sp] = (hrSpecies[sp] || 0) + (this.metric === 'animals' ? (r.count || 1) : 1);
          }
        });
        const topSpecies = Object.entries(hrSpecies).sort((a, b) => b[1] - a[1]).slice(0, 3);
        topSpecies.forEach(([sp, cnt]) => {
          rows.push({ label: sp, value: cnt, color: this.assignSpeciesColor(sp) });
        });

        this.showTooltip(e, `${padHr}:00 – ${nextHr}:00 (${phaseName})`, rows);
      });

      grp.addEventListener('mousemove', (e: any) => {
        const tip = this.getTooltipElement();
        tip.style.left = `${e.clientX + 10}px`;
        tip.style.top = `${e.clientY + 10}px`;
      });

      grp.addEventListener('mouseleave', () => this.hideTooltip());
    });
  }

  private renderSitesChart(records: ObservationRecord[]): void {
    const container = this.querySelector('#sitesContainer');
    if (!container) return;

    const siteMap: Record<string, number> = {};
    records.forEach(r => {
      const s = r.site || 'Unknown Site';
      siteMap[s] = (siteMap[s] || 0) + (this.metric === 'animals' ? (r.count || 1) : 1);
    });

    const sorted = Object.entries(siteMap).sort((a, b) => b[1] - a[1]);
    const maxSite = sorted[0] ? sorted[0][1] : 1;

    if (sorted.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--color-text-muted); font-size: 11px; padding: 2rem;">No site data available</div>`;
      return;
    }

    container.innerHTML = sorted.slice(0, 6).map(([site, count]) => {
      const pct = maxSite > 0 ? Math.round((count / maxSite) * 100) : 0;
      return `
        <div style="display: flex; flex-direction: column; gap: 3px;">
          <div style="display: flex; justify-content: space-between; font-size: 11px;">
            <strong style="color: var(--color-text-main); font-family: var(--font-mono);">${this.escape(site)}</strong>
            <span style="font-family: var(--font-mono); font-weight: 600; color: var(--color-text-main);">${count.toLocaleString()}</span>
          </div>
          <div style="height: 8px; width: 100%; background: var(--color-bg-base); border-radius: 4px; overflow: hidden;">
            <div ${`style="height: 100%; width: ${pct}%; background: var(--color-brand); border-radius: 4px;"`}></div>
          </div>
        </div>
      `;
    }).join('');
  }
}

customElements.define('project-insights', ProjectInsights);

declare global {
  interface HTMLElementTagNameMap {
    'project-insights': ProjectInsights;
  }
}
