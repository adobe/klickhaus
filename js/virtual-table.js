/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

const DEFAULT_ROW_HEIGHT = 28;
const DEFAULT_OVERSCAN = 10;
const MAX_CACHED_PAGES = 20;

function getPinnedOffsets(columns) {
  const offsets = new Map();
  let left = 0;
  for (const col of columns) {
    if (col.pinned) {
      offsets.set(col.key, left);
      left += col.width || 120;
    }
  }
  return offsets;
}

function makeCellStyle(col, offsets) {
  if (!col.pinned) return '';
  const left = offsets.get(col.key);
  return ` style="position:sticky;left:${left}px;z-index:1"`;
}

function findInCache(cache, idx) {
  for (const page of cache.values()) {
    const offset = idx - page.startIdx;
    if (offset >= 0 && offset < page.rows.length) {
      return page.rows[offset];
    }
  }
  return null;
}

/**
 * Minimal virtual-scrolling table. Renders only visible rows into a
 * standard HTML <table>, backed by an async getData callback.
 */
export class VirtualTable {
  /**
   * @param {Object} opts
   * @param {HTMLElement} opts.container
   * @param {number} [opts.rowHeight=28]
   * @param {Array<{key:string, label:string, pinned?:boolean, width?:number}>} opts.columns
   * @param {(start:number, count:number) => Promise<Object[]>} opts.getData
   * @param {(col:Object, value:unknown, row:Object) => string} opts.renderCell
   * @param {(first:number, last:number) => void} [opts.onVisibleRangeChange]
   * @param {(idx:number, row:Object) => void} [opts.onRowClick]
   */
  constructor({
    container, rowHeight, columns, getData, renderCell,
    onVisibleRangeChange, onRowClick,
  }) {
    this.container = container;
    this.rowHeight = rowHeight || DEFAULT_ROW_HEIGHT;
    this.columns = columns;
    this.getDataFn = getData;
    this.renderCellFn = renderCell;
    this.onRangeChange = onVisibleRangeChange || null;
    this.onRowClickFn = onRowClick || null;

    this.totalRows = 0;
    this.cache = new Map();
    this.pending = new Set();
    this.rafId = null;
    this.lastRange = null;

    this.initDom();
    this.initEvents();
  }

  initDom() {
    this.container.style.overflowY = 'auto';

    this.table = document.createElement('table');
    this.table.className = 'logs-table';

    this.colgroup = document.createElement('colgroup');
    this.table.appendChild(this.colgroup);

    this.thead = document.createElement('thead');
    this.tbody = document.createElement('tbody');
    this.table.appendChild(this.thead);
    this.table.appendChild(this.tbody);

    this.container.appendChild(this.table);

    this.updateHeader();
  }

  updateHeader() {
    // Build colgroup for deterministic column widths
    this.colgroup.innerHTML = '';
    let totalWidth = 0;
    for (const col of this.columns) {
      const colEl = document.createElement('col');
      const w = col.width || 120;
      colEl.style.width = `${w}px`;
      totalWidth += w;
      this.colgroup.appendChild(colEl);
    }

    // Set explicit table width so it can exceed container (enables horizontal scroll)
    if (totalWidth > 0) {
      this.table.style.width = `${totalWidth}px`;
    }

    const tr = document.createElement('tr');
    let pinnedLeft = 0;
    for (const col of this.columns) {
      const th = document.createElement('th');
      th.textContent = col.label || col.key;
      th.title = col.key;
      if (col.pinned) {
        th.style.position = 'sticky';
        th.style.left = `${pinnedLeft}px`;
        th.style.zIndex = '2';
        pinnedLeft += col.width || 120;
      }
      tr.appendChild(th);
    }
    this.thead.innerHTML = '';
    this.thead.appendChild(tr);
  }

  initEvents() {
    this.scrollHandler = () => {
      if (this.rafId) return;
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.renderRows();
      });
    };
    this.container.addEventListener(
      'scroll',
      this.scrollHandler,
      { passive: true },
    );

    if (this.onRowClickFn) {
      this.clickHandler = (e) => {
        const tr = e.target.closest('tr[data-row-idx]');
        if (!tr) return;
        const idx = parseInt(tr.dataset.rowIdx, 10);
        const row = findInCache(this.cache, idx);
        if (row) this.onRowClickFn(idx, row);
      };
      this.tbody.addEventListener('click', this.clickHandler);
    }
  }

  computeRange() {
    const { scrollTop } = this.container;
    const viewHeight = this.container.clientHeight;
    const start = Math.max(
      0,
      Math.floor(scrollTop / this.rowHeight) - DEFAULT_OVERSCAN,
    );
    const visible = Math.ceil(viewHeight / this.rowHeight);
    const end = Math.min(
      this.totalRows,
      start + visible + DEFAULT_OVERSCAN * 2,
    );
    return { start, end };
  }

  renderRows() {
    if (this.totalRows === 0) {
      this.tbody.style.paddingTop = '0px';
      this.tbody.style.paddingBottom = '0px';
      this.tbody.innerHTML = '';
      this.lastRange = null;
      return;
    }

    const { start, end } = this.computeRange();

    if (
      this.lastRange
      && this.lastRange.start === start
      && this.lastRange.end === end
    ) return;
    this.lastRange = { start, end };

    const offsets = getPinnedOffsets(this.columns);
    let html = '';
    let fetchStart = -1;

    for (let i = start; i < end; i += 1) {
      const row = findInCache(this.cache, i);

      if (row) {
        html += `<tr data-row-idx="${i}" style="height:${this.rowHeight}px">`;
        for (const col of this.columns) {
          const sty = makeCellStyle(col, offsets);
          html += `<td${sty}>${this.renderCellFn(col, row[col.key], row)}</td>`;
        }
        html += '</tr>';
      } else {
        html += `<tr data-row-idx="${i}" class="loading-row" style="height:${this.rowHeight}px">`;
        for (const col of this.columns) {
          html += `<td${makeCellStyle(col, offsets)}>&nbsp;</td>`;
        }
        html += '</tr>';
        if (fetchStart === -1) fetchStart = i;
      }
    }

    // Padding-based virtual scroll: push visible rows into correct position
    this.tbody.style.paddingTop = `${start * this.rowHeight}px`;
    this.tbody.style.paddingBottom = `${Math.max(0, (this.totalRows - end) * this.rowHeight)}px`;
    this.tbody.innerHTML = html;

    if (fetchStart !== -1) {
      this.fetchRange(fetchStart, end);
    }

    if (this.onRangeChange) {
      const visStart = Math.max(start + DEFAULT_OVERSCAN, 0);
      const visEnd = Math.min(end - DEFAULT_OVERSCAN, this.totalRows);
      this.onRangeChange(visStart, visEnd);
    }
  }

  async fetchRange(startIdx, endIdx) {
    const count = endIdx - startIdx;
    if (this.pending.has(startIdx)) return;
    this.pending.add(startIdx);

    try {
      const rows = await this.getDataFn(startIdx, count);
      this.cache.set(startIdx, { startIdx, rows });
      this.evictDistantPages();
      this.lastRange = null;
      this.renderRows();
    } finally {
      this.pending.delete(startIdx);
    }
  }

  evictDistantPages() {
    if (this.cache.size <= MAX_CACHED_PAGES) return;
    const center = this.container.scrollTop / this.rowHeight;
    const sorted = [...this.cache.entries()]
      .map(([key, page]) => ({
        key,
        dist: Math.abs(page.startIdx - center),
      }))
      .sort((a, b) => b.dist - a.dist);

    while (this.cache.size > MAX_CACHED_PAGES) {
      this.cache.delete(sorted.shift().key);
    }
  }

  /* ---- Public API ---- */

  setTotalRows(n) {
    this.totalRows = n;
    this.lastRange = null;
    this.renderRows();
  }

  setColumns(cols) {
    this.columns = cols;
    this.updateHeader();
    this.lastRange = null;
    this.renderRows();
  }

  scrollToRow(index) {
    this.container.scrollTop = Math.max(0, index * this.rowHeight);
  }

  scrollToTimestamp(ts, getTimestamp) {
    if (this.totalRows === 0) return;
    const target = typeof ts === 'number' ? ts : ts.getTime();
    let lo = 0;
    let hi = this.totalRows - 1;
    let best = 0;
    let bestDiff = Infinity;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const row = findInCache(this.cache, mid);
      if (!row) break;
      const rowTs = getTimestamp(row);
      const diff = Math.abs(rowTs - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = mid;
      }
      if (rowTs > target) lo = mid + 1;
      else hi = mid - 1;
    }
    this.scrollToRow(best);
  }

  invalidate() {
    this.lastRange = null;
    this.renderRows();
  }

  seedCache(startIdx, rows) {
    this.cache.set(startIdx, { startIdx, rows });
  }

  clearCache() {
    this.cache.clear();
    this.pending.clear();
  }

  destroy() {
    this.container.removeEventListener('scroll', this.scrollHandler);
    if (this.clickHandler) {
      this.tbody.removeEventListener('click', this.clickHandler);
    }
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.cache.clear();
    this.container.innerHTML = '';
  }
}
