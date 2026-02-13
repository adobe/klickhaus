/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { DATABASE } from './config.js';
import { state, setOnPinnedColumnsChange } from './state.js';
import { query, isAbortError } from './api.js';
import {
  getTimeFilter, getHostFilter, getTable, getTimeRangeBounds,
} from './time.js';
import { getFacetFilters } from './breakdowns/index.js';
import { escapeHtml } from './utils.js';
import { formatBytes } from './format.js';
import { getColorForColumn } from './colors/index.js';
import { getRequestContext, isRequestCurrent } from './request-context.js';
import {
  LOG_COLUMN_ORDER, LOG_COLUMN_SHORT_LABELS, LOG_COLUMN_TO_FACET, buildLogColumnsSql,
} from './columns.js';
import { loadSql } from './sql-loader.js';
import { formatLogCell } from './templates/logs-table.js';
import { PAGE_SIZE, INITIAL_PAGE_SIZE } from './pagination.js';
import { setScrubberPosition } from './chart.js';
import { parseUTC } from './chart-state.js';
// VirtualTable intentionally NOT used — replaced by bucket-row approach.
// eslint-disable-next-line prefer-const -- reassigned in buildBucketIndex/loadLogs
let bucketIndex = null;

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;

// Bucket-row table constants
const ROW_HEIGHT = 28;
const MAX_TOTAL_HEIGHT = 10_000_000; // 10M pixels cap

/**
 * Build ordered log column list from available columns.
 * @param {string[]} allColumns
 * @returns {string[]}
 */
function getLogColumns(allColumns) {
  const pinned = state.pinnedColumns.filter((col) => allColumns.includes(col));
  const preferred = LOG_COLUMN_ORDER
    .filter((col) => allColumns.includes(col) && !pinned.includes(col));
  const rest = allColumns.filter((col) => !pinned.includes(col) && !LOG_COLUMN_ORDER.includes(col));
  return [...pinned, ...preferred, ...rest];
}

const COLUMN_WIDTHS = {
  timestamp: 180,
  'response.status': 70,
  'request.method': 80,
  'request.host': 200,
  'request.url': 300,
  'response.body_size': 100,
  'cdn.cache_status': 100,
  'cdn.datacenter': 100,
};
const DEFAULT_COLUMN_WIDTH = 150;

/**
 * Build VirtualTable column descriptors from column name list.
 * @param {string[]} columns - ordered column names
 * @returns {Array<{key:string, label:string, pinned?:boolean, width?:number}>}
 */
function buildVirtualColumns(columns) {
  const pinned = state.pinnedColumns;
  return columns.map((col) => {
    const isPinned = pinned.includes(col);
    const label = LOG_COLUMN_SHORT_LABELS[col] || col;
    const width = COLUMN_WIDTHS[col] || DEFAULT_COLUMN_WIDTH;
    const entry = { key: col, label, width };
    if (isPinned) entry.pinned = true;
    return entry;
  });
}

// DOM elements (set by main.js)
let logsView = null;
let viewToggleBtn = null;
let filtersView = null;

let virtualTable = null;

// Page cache: pageIndex → { rows, cursor (timestamp of last row) }
const pageCache = new Map();
let currentColumns = [];

// Show brief "Copied!" feedback
function showCopyFeedback() {
  let feedback = document.getElementById('copy-feedback');
  if (!feedback) {
    feedback = document.createElement('div');
    feedback.id = 'copy-feedback';
    feedback.textContent = 'Copied to clipboard';
    feedback.classList.add('copy-feedback');
    document.body.appendChild(feedback);
  }
  feedback.style.opacity = '1';
  setTimeout(() => {
    feedback.style.opacity = '0';
  }, 1500);
}

let logDetailModal = null;

/**
 * Group columns by their prefix for organized display.
 * @param {string[]} columns
 * @returns {Map<string, string[]>}
 */
function groupColumnsByPrefix(columns) {
  const groups = new Map();
  const groupOrder = ['', 'request', 'response', 'cdn', 'client', 'helix'];

  // Initialize groups in order
  for (const prefix of groupOrder) {
    groups.set(prefix, []);
  }

  for (const col of columns) {
    const dotIndex = col.indexOf('.');
    const prefix = dotIndex > -1 ? col.substring(0, dotIndex) : '';
    if (!groups.has(prefix)) {
      groups.set(prefix, []);
    }
    groups.get(prefix).push(col);
  }

  return groups;
}

/**
 * Format a value for display in the detail modal.
 * @param {string} col
 * @param {unknown} value
 * @returns {{ html: string, className: string }}
 */
function formatDetailValue(col, value) {
  if (value === null || value === undefined || value === '') {
    return { html: '(empty)', className: 'empty-value' };
  }

  let className = '';
  let displayValue = '';

  if (col === 'timestamp') {
    const date = new Date(value);
    displayValue = date.toLocaleString();
  } else if (col === 'response.status') {
    const status = parseInt(value, 10);
    displayValue = String(status);
    if (status >= 500) className = 'status-5xx';
    else if (status >= 400) className = 'status-4xx';
    else className = 'status-ok';
  } else if (col === 'response.body_size') {
    displayValue = formatBytes(parseInt(value, 10));
  } else if (typeof value === 'object') {
    displayValue = JSON.stringify(value, null, 2);
  } else {
    displayValue = String(value);
  }

  const color = getColorForColumn(col, value);
  const colorIndicator = color ? `<span class="log-color" style="background:${color}"></span>` : '';

  return { html: colorIndicator + escapeHtml(displayValue), className };
}

/**
 * Get display name for a column group.
 * @param {string} prefix
 * @returns {string}
 */
function getGroupDisplayName(prefix) {
  const names = {
    '': 'Core',
    request: 'Request',
    response: 'Response',
    cdn: 'CDN',
    client: 'Client',
    helix: 'Helix',
  };
  return names[prefix] || prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

/**
 * Render log detail modal content.
 * @param {Object} row
 */
function renderLogDetailContent(row) {
  const table = document.getElementById('logDetailTable');
  if (!table) return;

  const columns = Object.keys(row);
  const groups = groupColumnsByPrefix(columns);

  let html = '';

  for (const [prefix, cols] of groups) {
    if (cols.length > 0) {
      html += '<tbody class="log-detail-group">';
      html += `<tr><td colspan="2" class="log-detail-group-title">${getGroupDisplayName(prefix)}</td></tr>`;

      for (const col of cols) {
        const value = row[col];
        const { html: valueHtml, className } = formatDetailValue(col, value);
        const displayCol = col.includes('.') ? col.split('.').slice(1).join('.') : col;
        html += `<tr>
        <th title="${escapeHtml(col)}">${escapeHtml(displayCol)}</th>
        <td class="${className}">${valueHtml}</td>
      </tr>`;
      }

      html += '</tbody>';
    }
  }

  table.innerHTML = html;
}

/**
 * Close the log detail modal.
 */
export function closeLogDetailModal() {
  if (logDetailModal) {
    logDetailModal.close();
  }
}

/**
 * Show loading state in the detail modal.
 */
function showDetailLoading() {
  const table = document.getElementById('logDetailTable');
  if (table) {
    table.innerHTML = '<tbody><tr><td class="log-detail-loading">Loading full row data\u2026</td></tr></tbody>';
  }
}

/**
 * Fetch full row data for a single log entry.
 * @param {Object} partialRow - Row with at least timestamp and request.host
 * @returns {Promise<Object|null>} Full row data or null on failure
 */
async function fetchFullRow(partialRow) {
  const { timestamp } = partialRow;
  const tsStr = String(timestamp);
  if (!TIMESTAMP_RE.test(tsStr)) {
    // eslint-disable-next-line no-console
    console.warn('fetchFullRow: invalid timestamp format, aborting', tsStr);
    return null;
  }
  const host = partialRow['request.host'] || '';
  const sql = await loadSql('log-detail', {
    database: DATABASE,
    table: getTable(),
    timestamp: tsStr,
    host: host.replace(/'/g, "\\'"),
  });
  const result = await query(sql);
  return result.data.length > 0 ? result.data[0] : null;
}

/**
 * Initialize the log detail modal element and event listeners.
 */
function initLogDetailModal() {
  if (logDetailModal) return;
  logDetailModal = document.getElementById('logDetailModal');
  if (!logDetailModal) return;

  // Close on backdrop click
  logDetailModal.addEventListener('click', (e) => {
    if (e.target === logDetailModal) {
      closeLogDetailModal();
    }
  });

  // Close on Escape
  logDetailModal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLogDetailModal();
    }
  });

  // Close button handler
  const closeBtn = logDetailModal.querySelector('[data-action="close-log-detail"]');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeLogDetailModal);
  }
}

/**
 * Look up a row from the page cache by virtual index.
 * @param {number} rowIdx
 * @returns {Object|null}
 */
function getRowFromCache(rowIdx) {
  const pageIdx = Math.floor(rowIdx / PAGE_SIZE);
  const page = pageCache.get(pageIdx);
  if (!page) return null;
  const offset = rowIdx - pageIdx * PAGE_SIZE;
  return offset < page.rows.length ? page.rows[offset] : null;
}

/**
 * Open log detail modal for a row.
 * Fetches full row data on demand if not already present.
 * @param {number} rowIdx
 * @param {Object} row
 */
export async function openLogDetailModal(rowIdx, row) {
  if (!row) return;

  initLogDetailModal();
  if (!logDetailModal) return;

  // Show modal immediately with loading state
  showDetailLoading();
  logDetailModal.showModal();

  try {
    const fullRow = await fetchFullRow(row);
    if (fullRow) {
      renderLogDetailContent(fullRow);
    } else {
      // Fallback: render with partial data
      renderLogDetailContent(row);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to fetch full row:', err);
    // Fallback: render with partial data
    renderLogDetailContent(row);
  }
}

// Copy row data as JSON when clicking on row background
export function copyLogRow(rowIdx) {
  const row = getRowFromCache(rowIdx);
  if (!row) return;

  // Convert flat dot notation to nested object
  const nested = {};
  for (const [key, value] of Object.entries(row)) {
    // Skip empty values
    if (value !== null && value !== undefined && value !== '') {
      const parts = key.split('.');
      let current = nested;
      for (let i = 0; i < parts.length - 1; i += 1) {
        if (!current[parts[i]]) {
          current[parts[i]] = {};
        }
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = value;
    }
  }

  const json = JSON.stringify(nested, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    // Brief visual feedback
    showCopyFeedback();
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to copy:', err);
  });
}

function renderLogsError(message) {
  const container = logsView.querySelector('.logs-table-container');
  container.innerHTML = `<div class="empty" style="padding: 60px;">Error loading logs: ${escapeHtml(message)}</div>`;
}

// Collapse toggle label helper
function updateCollapseToggleLabel() {
  const btn = document.getElementById('chartCollapseToggle');
  if (!btn) return;
  const chartSection = document.querySelector('.chart-section');
  const collapsed = chartSection?.classList.contains('chart-collapsed');
  btn.innerHTML = collapsed ? '<span aria-hidden="true">&#9660;</span> Show chart' : '<span aria-hidden="true">&#9650;</span> Hide chart';
  btn.title = collapsed ? 'Expand chart' : 'Collapse chart';
}

// Set up collapse toggle click handler
export function initChartCollapseToggle() {
  const btn = document.getElementById('chartCollapseToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const chartSection = document.querySelector('.chart-section');
    if (!chartSection) return;
    chartSection.classList.toggle('chart-collapsed');
    const collapsed = chartSection.classList.contains('chart-collapsed');
    localStorage.setItem('chartCollapsed', collapsed ? 'true' : 'false');
    updateCollapseToggleLabel();
  });
  updateCollapseToggleLabel();
}

/**
 * renderCell callback for VirtualTable (unused while bucket-row table is active).
 * Returns HTML string for a single cell.
 */
// eslint-disable-next-line no-unused-vars -- kept for future VirtualTable re-enablement
function renderCell(col, value) {
  const { displayValue, cellClass, colorIndicator } = formatLogCell(col.key, value);
  const escaped = escapeHtml(displayValue);

  // Add click-to-filter attributes when column has a facet mapping and a color indicator
  let actionAttrs = '';
  let extraClass = '';
  const facetMapping = LOG_COLUMN_TO_FACET[col.key];
  if (colorIndicator && facetMapping && value !== null && value !== undefined && value !== '') {
    const filterValue = facetMapping.transform ? facetMapping.transform(value) : String(value);
    actionAttrs = ` data-action="add-filter" data-col="${escapeHtml(facetMapping.col)}" data-value="${escapeHtml(filterValue)}" data-exclude="false"`;
    extraClass = ' clickable';
  }

  const cls = cellClass || extraClass ? ` class="${(cellClass || '') + extraClass}"` : '';
  return `<span${cls} title="${escaped}"${actionAttrs}>${colorIndicator}${escaped}</span>`;
}

/**
 * Find the nearest cached cursor for a given page index.
 * @param {number} pageIdx
 * @returns {string|null}
 */
function findCachedCursor(pageIdx) {
  for (let p = pageIdx - 1; p >= 0; p -= 1) {
    const prev = pageCache.get(p);
    if (prev && prev.cursor) return prev.cursor;
  }
  return null;
}

/**
 * Format a Date as 'YYYY-MM-DD HH:MM:SS.mmm' in UTC.
 * @param {Date} date
 * @returns {string}
 */
function formatTimestampUTC(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${ms}`;
}

/**
 * Interpolate a timestamp for a given row index using bucket-aware lookup.
 * Chart data buckets are ordered oldest→newest (ascending time), but rows are
 * ordered newest→oldest (descending time, ORDER BY timestamp DESC).
 * So row 0 = newest bucket (last in chart), row N = oldest bucket (first in chart).
 *
 * Uses binary search on the cumulative row-count array when available,
 * falling back to linear interpolation across the time range.
 * @param {number} startIdx - virtual row index (0 = newest)
 * @param {number} totalRows
 * @returns {string} timestamp in 'YYYY-MM-DD HH:MM:SS.mmm' format
 */
function interpolateTimestamp(startIdx, totalRows) {
  // Bucket-aware path: binary search the cumulative array
  if (bucketIndex && bucketIndex.cumulative.length > 0) {
    const { cumulative } = bucketIndex;
    const total = bucketIndex.totalRows;
    // Clamp to valid range
    const targetRow = Math.min(Math.max(startIdx, 0), total - 1);

    // cumulative is oldest→newest; cumRows is a running total in that order.
    // Row 0 (newest) maps to the END of the cumulative array.
    // Convert: rows from the end = targetRow → cumulative offset from end.
    const rowsFromEnd = targetRow;
    // rowsFromEnd=0 means the last bucket; rowsFromEnd=total-1 means the first.
    // cumulativeTarget = total - rowsFromEnd = the cumRows value we seek.
    const cumulativeTarget = total - rowsFromEnd;

    // Binary search: find the bucket where cumRows >= cumulativeTarget
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (cumulative[mid].cumRows < cumulativeTarget) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    return formatTimestampUTC(parseUTC(cumulative[lo].timestamp));
  }

  // Fallback: linear interpolation across the time range
  const { start, end } = getTimeRangeBounds();
  const totalMs = end.getTime() - start.getTime();
  const fraction = Math.min(startIdx / Math.max(totalRows, 1), 1);
  const targetTs = new Date(end.getTime() - fraction * totalMs);
  return formatTimestampUTC(targetTs);
}

/**
 * Build the SQL query for a given page, using cursor, interpolation, or initial query.
 * @param {number} pageIdx
 * @param {number} startIdx
 * @param {Object} sqlParams
 * @returns {Promise<{sql: string, isInterpolated: boolean}>}
 */
async function buildPageQuery(pageIdx, startIdx, sqlParams) {
  if (pageIdx === 0) {
    return { sql: await loadSql('logs', sqlParams), isInterpolated: false };
  }

  const cursor = findCachedCursor(pageIdx);
  if (cursor && TIMESTAMP_RE.test(cursor)) {
    return { sql: await loadSql('logs-more', { ...sqlParams, cursor }), isInterpolated: false };
  }

  const total = virtualTable ? virtualTable.totalRows : PAGE_SIZE * 10;
  const interpolatedCursor = interpolateTimestamp(startIdx, total);
  return { sql: await loadSql('logs-at', { ...sqlParams, cursor: interpolatedCursor }), isInterpolated: true };
}

/**
 * Check the page cache for data at the given index.
 * Returns the cached rows, or null if a fresh fetch is needed.
 */
function getCachedRows(pageIdx, startIdx, count) {
  if (!pageCache.has(pageIdx)) return null;
  const page = pageCache.get(pageIdx);
  const offset = startIdx - pageIdx * PAGE_SIZE;
  if (offset < page.rows.length) {
    return page.rows.slice(offset, offset + count);
  }
  // Page 0 may be a partial initial load — allow re-fetch
  // Other pages: a short cache means end of data
  return pageIdx === 0 ? null : [];
}

/**
 * Adjust virtualTable totalRows after fetching a page.
 * Only shrinks totalRows when a genuine short page indicates end-of-data.
 * Never grows — the initial estimate from chart data is the upper bound.
 */
function adjustTotalRows(pageIdx, rowCount) {
  if (!virtualTable) return;
  if (rowCount < PAGE_SIZE) {
    const actualTotal = pageIdx * PAGE_SIZE + rowCount;
    if (actualTotal < virtualTable.totalRows) {
      virtualTable.setTotalRows(actualTotal);
    }
  }
  // Removed: growth path that caused scroll jumps by expanding totalRows
}

/**
 * getData callback for VirtualTable (unused while bucket-row table is active).
 * Fetches a page of log rows from ClickHouse using cursor-based pagination.
 */
// eslint-disable-next-line no-unused-vars -- kept for future VirtualTable re-enablement
async function getData(startIdx, count) {
  const pageIdx = Math.floor(startIdx / PAGE_SIZE);

  const cached = getCachedRows(pageIdx, startIdx, count);
  if (cached !== null) return cached;

  const sqlParams = {
    database: DATABASE,
    table: getTable(),
    columns: buildLogColumnsSql(state.pinnedColumns),
    timeFilter: getTimeFilter(),
    hostFilter: getHostFilter(),
    facetFilters: getFacetFilters(),
    additionalWhereClause: state.additionalWhereClause,
    pageSize: String(PAGE_SIZE),
  };

  const { sql, isInterpolated } = await buildPageQuery(pageIdx, startIdx, sqlParams);

  try {
    const result = await query(sql);
    const rows = result.data;
    const cursor = rows.length > 0 ? rows[rows.length - 1].timestamp : null;
    pageCache.set(pageIdx, { rows, cursor });

    if (!isInterpolated) {
      adjustTotalRows(pageIdx, rows.length);
    }

    // Update columns on first data load
    if (rows.length > 0 && currentColumns.length === 0) {
      currentColumns = getLogColumns(Object.keys(rows[0]));
      if (virtualTable) {
        virtualTable.setColumns(buildVirtualColumns(currentColumns));
      }
    }

    // Also update logsData on state for backwards compat with detail modal
    if (pageIdx === 0) {
      state.logsData = rows;
    }

    const offset = startIdx - pageIdx * PAGE_SIZE;
    return rows.slice(offset, offset + count);
  } catch (err) {
    if (!isAbortError(err)) {
      // eslint-disable-next-line no-console
      console.error('getData error:', err);
    }
    return [];
  }
}

/**
 * Destroy the current virtual table if it exists.
 */
function destroyVirtualTable() {
  if (virtualTable) {
    virtualTable.destroy();
    virtualTable = null;
  }
}

// Bucket-row table state
let bucketTableContainer = null;
let bucketScrollHandler = null;

/**
 * Compute bucket heights, applying proportional scaling if total exceeds MAX_TOTAL_HEIGHT.
 * @param {Array} chartData - array of { t, cnt_ok, cnt_4xx, cnt_5xx }
 * @returns {{ buckets: Array<{t: string, count: number, height: number}>, totalHeight: number }}
 */
export function computeBucketHeights(chartData) {
  if (!chartData || chartData.length === 0) return { buckets: [], totalHeight: 0 };

  const buckets = chartData.map((b) => {
    const count = (parseInt(b.cnt_ok, 10) || 0)
      + (parseInt(b.cnt_4xx, 10) || 0)
      + (parseInt(b.cnt_5xx, 10) || 0);
    return { t: b.t, count };
  });

  // Calculate natural heights
  let totalHeight = 0;
  for (const b of buckets) {
    const h = Math.max(b.count, 1) * ROW_HEIGHT;
    b.height = h;
    totalHeight += h;
  }

  // Scale proportionally if over cap
  if (totalHeight > MAX_TOTAL_HEIGHT) {
    const scale = MAX_TOTAL_HEIGHT / totalHeight;
    totalHeight = 0;
    for (const b of buckets) {
      b.height = Math.max(Math.round(b.height * scale), ROW_HEIGHT);
      totalHeight += b.height;
    }
  }

  return { buckets, totalHeight };
}

/**
 * Sync the chart scrubber to the first visible bucket.
 * @param {HTMLElement} scrollContainer
 */
function syncBucketScrubber(scrollContainer) {
  const rows = scrollContainer.querySelectorAll('tbody tr.bucket-row');
  if (rows.length === 0) return;

  const { scrollTop } = scrollContainer;
  const viewportBottom = scrollTop + scrollContainer.clientHeight;
  let firstVisible = null;

  for (const row of rows) {
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (bottom > scrollTop && top < viewportBottom) {
      if (!firstVisible) firstVisible = row;
    }
    // Optimization: stop if we've passed the viewport
    if (top > viewportBottom) break;
  }

  if (firstVisible) {
    const firstTs = firstVisible.id.replace('bucket-', '');
    const firstDate = parseUTC(firstTs);
    setScrubberPosition(firstDate);
  }
}

/**
 * Render the bucket-row table from chart data.
 * Each chart bucket gets one <tr> with proportional height.
 * @param {HTMLElement} el - .logs-table-container element
 * @param {Array} chartData - state.chartData array
 */
export function renderBucketTable(el, chartData) {
  if (!chartData || chartData.length === 0) {
    // eslint-disable-next-line no-param-reassign -- DOM manipulation
    el.innerHTML = '<div class="empty" style="padding: 60px;">No chart data available for bucket table</div>';
    return;
  }

  const { buckets } = computeBucketHeights(chartData);

  // Build table HTML
  const numColumns = 7; // placeholder colspan
  let tbodyHtml = '';

  // Reverse to newest-first (chart data is oldest-first)
  for (let i = buckets.length - 1; i >= 0; i -= 1) {
    const b = buckets[i];
    const rowCount = b.count;
    const label = rowCount === 1 ? '1 row' : `${rowCount.toLocaleString()} rows`;
    tbodyHtml += `<tr id="bucket-${b.t}" class="bucket-row" style="height: ${b.height}px;">`
      + `<td colspan="${numColumns}" class="bucket-placeholder">${label}</td>`
      + '</tr>';
  }

  // eslint-disable-next-line no-param-reassign -- DOM manipulation
  el.innerHTML = `<table class="logs-table bucket-table">
    <thead><tr><th colspan="${numColumns}">Log Buckets</th></tr></thead>
    <tbody>${tbodyHtml}</tbody>
  </table>`;

  bucketTableContainer = el;

  // Set up scroll listener for scrubber sync
  if (bucketScrollHandler) {
    el.removeEventListener('scroll', bucketScrollHandler);
  }
  bucketScrollHandler = () => {
    syncBucketScrubber(el);
  };
  el.addEventListener('scroll', bucketScrollHandler, { passive: true });
}

/**
 * Clean up bucket table event listeners.
 */
function destroyBucketTable() {
  if (bucketTableContainer && bucketScrollHandler) {
    bucketTableContainer.removeEventListener('scroll', bucketScrollHandler);
  }
  bucketScrollHandler = null;
  bucketTableContainer = null;
}

/**
 * Create or reconfigure the VirtualTable instance.
 * Currently bypassed in favor of the bucket-row table approach.
 */
function ensureVirtualTable() {
  const container = logsView.querySelector('.logs-table-container');
  if (!container) return;

  // Use bucket-row table when chart data is available
  if (state.chartData && state.chartData.length > 0) {
    destroyVirtualTable();
    renderBucketTable(container, state.chartData);
    return;
  }

  // Fallback: show loading state when chart data not yet available
  container.innerHTML = '<div class="logs-loading">Loading\u2026</div>';
}

// Re-render bucket table when chart data arrives after loadLogs() (race condition fix)
export function tryRenderBucketTable() {
  if (!state.showLogs || !logsView || !state.chartData?.length) return;
  const container = logsView.querySelector('.logs-table-container');
  if (!container || container.querySelector('.bucket-table')) return;
  ensureVirtualTable();
}

// Scroll log table to the row closest to a given timestamp
export function scrollLogsToTimestamp(timestamp) {
  if (!state.showLogs) return;
  const targetMs = timestamp instanceof Date ? timestamp.getTime() : timestamp;

  // Bucket-row approach: find the closest bucket <tr> by timestamp
  if (bucketTableContainer) {
    const rows = bucketTableContainer.querySelectorAll('tbody tr.bucket-row');
    let bestRow = null;
    let bestDiff = Infinity;
    for (const row of rows) {
      const ts = row.id.replace('bucket-', '');
      const diff = Math.abs(parseUTC(ts).getTime() - targetMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestRow = row;
      }
    }
    if (bestRow) {
      bestRow.scrollIntoView({ behavior: 'instant', block: 'center' });
    }
    return;
  }

  // Legacy VirtualTable fallback
  if (virtualTable) {
    virtualTable.scrollToTimestamp(targetMs, (row) => parseUTC(row.timestamp).getTime());
  }
}

export function setLogsElements(view, toggleBtn, filtersViewEl) {
  logsView = view;
  viewToggleBtn = toggleBtn;
  filtersView = filtersViewEl;

  // Set up chart collapse toggle
  initChartCollapseToggle();
}

// Register callback for pinned column changes
setOnPinnedColumnsChange(() => {
  if (!virtualTable || currentColumns.length === 0) return;

  // Rebuild column list with new pinned state
  // Re-derive from current data keys if available
  const page0 = pageCache.get(0);
  if (page0 && page0.rows.length > 0) {
    currentColumns = getLogColumns(Object.keys(page0.rows[0]));
  }
  virtualTable.setColumns(buildVirtualColumns(currentColumns));
});

// Callback for redrawing chart when switching views
let onShowFiltersView = null;

export function setOnShowFiltersView(callback) {
  onShowFiltersView = callback;
}

/**
 * Build a cumulative row-count index from chart data buckets.
 * Each bucket has { t, cnt_ok, cnt_4xx, cnt_5xx } (strings from ClickHouse).
 * Returns { cumulative: [{timestamp, cumRows, count}], totalRows } or null.
 * Buckets are ordered oldest→newest (ascending time), matching chart data order.
 * @param {Array} chartData
 * @returns {{cumulative: Array, totalRows: number}|null}
 */
function buildBucketIndex(chartData) {
  if (!chartData || chartData.length === 0) return null;
  const cumulative = [];
  let total = 0;
  for (const bucket of chartData) {
    const count = (parseInt(bucket.cnt_ok, 10) || 0)
      + (parseInt(bucket.cnt_4xx, 10) || 0)
      + (parseInt(bucket.cnt_5xx, 10) || 0);
    total += count;
    cumulative.push({ timestamp: bucket.t, cumRows: total, count });
  }
  return { cumulative, totalRows: total };
}

/**
 * Estimate total rows from chart data bucket counts (unused while bucket-row table is active).
 * @returns {number}
 */
// eslint-disable-next-line no-unused-vars -- kept for future VirtualTable re-enablement
function estimateTotalRows() {
  if (!state.chartData || state.chartData.length === 0) return 0;
  let total = 0;
  for (const b of state.chartData) {
    total += (parseInt(b.cnt_ok, 10) || 0)
      + (parseInt(b.cnt_4xx, 10) || 0)
      + (parseInt(b.cnt_5xx, 10) || 0);
  }
  return total;
}

export async function loadLogs(requestContext = getRequestContext('dashboard')) {
  const { requestId, signal, scope } = requestContext;
  const isCurrent = () => isRequestCurrent(requestId, scope);

  state.logsLoading = true;
  state.logsReady = false;

  // Reset page cache and bucket index
  pageCache.clear();
  bucketIndex = null;
  currentColumns = [];

  // Apply blur effect while loading
  const container = logsView.querySelector('.logs-table-container');
  container.classList.add('updating');

  // Render bucket table from chart data (available before log data)
  ensureVirtualTable();

  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const facetFilters = getFacetFilters();

  const sql = await loadSql('logs', {
    database: DATABASE,
    table: getTable(),
    columns: buildLogColumnsSql(state.pinnedColumns),
    timeFilter,
    hostFilter,
    facetFilters,
    additionalWhereClause: state.additionalWhereClause,
    pageSize: String(INITIAL_PAGE_SIZE),
  });

  try {
    const result = await query(sql, { signal });
    if (!isCurrent()) return;

    const rows = result.data;
    state.logsData = rows;
    state.logsReady = true;

    if (rows.length === 0 && (!state.chartData || state.chartData.length === 0)) {
      container.innerHTML = '<div class="empty" style="padding: 60px;">No logs matching current filters</div>';
      destroyBucketTable();
      destroyVirtualTable();
      return;
    }

    // Populate initial page cache (for detail modals)
    const cursor = rows.length > 0 ? rows[rows.length - 1].timestamp : null;
    pageCache.set(0, { rows, cursor });

    // Set columns from data
    if (rows.length > 0) {
      currentColumns = getLogColumns(Object.keys(rows[0]));
    }

    // Build bucket index from chart data
    bucketIndex = buildBucketIndex(state.chartData);
  } catch (err) {
    if (!isCurrent() || isAbortError(err)) return;
    // eslint-disable-next-line no-console
    console.error('Logs error:', err);
    renderLogsError(err.message);
  } finally {
    if (isCurrent()) {
      state.logsLoading = false;
      container.classList.remove('updating');
      // Chart data may have arrived while the logs query was in-flight
      tryRenderBucketTable();
    }
  }
}

export function toggleLogsView(saveStateToURL, scrollToTimestamp) {
  state.showLogs = !state.showLogs;
  const dashboardContent = document.getElementById('dashboardContent');
  if (state.showLogs) {
    logsView.classList.add('visible');
    filtersView.classList.remove('visible');
    viewToggleBtn.querySelector('.menu-item-label').textContent = 'View Filters';
    dashboardContent.classList.add('logs-active');
    // Restore collapse state from localStorage
    const chartSection = document.querySelector('.chart-section');
    if (chartSection && localStorage.getItem('chartCollapsed') === 'true') {
      chartSection.classList.add('chart-collapsed');
      updateCollapseToggleLabel();
    }
    // Render bucket table or trigger fresh load
    ensureVirtualTable();
    if (state.logsReady && pageCache.size > 0) {
      bucketIndex = buildBucketIndex(state.chartData);
      if (scrollToTimestamp) {
        scrollLogsToTimestamp(scrollToTimestamp);
      }
    } else {
      loadLogs();
    }
  } else {
    logsView.classList.remove('visible');
    filtersView.classList.add('visible');
    viewToggleBtn.querySelector('.menu-item-label').textContent = 'View Logs';
    dashboardContent.classList.remove('logs-active');
    // Redraw chart after view becomes visible
    if (onShowFiltersView) {
      requestAnimationFrame(() => onShowFiltersView());
    }
    // Clean up when leaving logs view
    destroyBucketTable();
    destroyVirtualTable();
  }
  saveStateToURL();
}
