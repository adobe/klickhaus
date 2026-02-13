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
import { LOG_COLUMN_ORDER, LOG_COLUMN_SHORT_LABELS, buildLogColumnsSql } from './columns.js';
import { loadSql } from './sql-loader.js';
import { formatLogCell } from './templates/logs-table.js';
import { PAGE_SIZE } from './pagination.js';
import { setScrubberPosition } from './chart.js';
import { parseUTC } from './chart-state.js';
import { VirtualTable } from './virtual-table.js';

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;

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

// VirtualTable instance
let virtualTable = null;

// Page cache for cursor-based pagination
// Maps pageIndex → { rows, cursor (timestamp of last row) }
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

// Log detail modal element
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
 * renderCell callback for VirtualTable.
 * Returns HTML string for a single cell.
 */
function renderCell(col, value) {
  const { displayValue, cellClass, colorIndicator } = formatLogCell(col.key, value);
  const escaped = escapeHtml(displayValue);
  const cls = cellClass ? ` class="${cellClass}"` : '';
  return `<span${cls} title="${escaped}">${colorIndicator}${escaped}</span>`;
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
 * Interpolate a timestamp from the time range for a given row index.
 * Used when no cursor chain is available for direct page jumps.
 * @param {number} startIdx
 * @param {number} totalRows
 * @returns {string} timestamp in 'YYYY-MM-DD HH:MM:SS.mmm' format
 */
function interpolateTimestamp(startIdx, totalRows) {
  const { start, end } = getTimeRangeBounds();
  const totalMs = end.getTime() - start.getTime();
  const fraction = Math.min(startIdx / totalRows, 1);
  const targetTs = new Date(end.getTime() - fraction * totalMs);
  const pad = (n) => String(n).padStart(2, '0');
  const ms = String(targetTs.getUTCMilliseconds()).padStart(3, '0');
  return `${targetTs.getUTCFullYear()}-${pad(targetTs.getUTCMonth() + 1)}-${pad(targetTs.getUTCDate())} ${pad(targetTs.getUTCHours())}:${pad(targetTs.getUTCMinutes())}:${pad(targetTs.getUTCSeconds())}.${ms}`;
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
 * getData callback for VirtualTable.
 * Fetches a page of log rows from ClickHouse using cursor-based pagination.
 */
async function getData(startIdx, count) {
  const pageIdx = Math.floor(startIdx / PAGE_SIZE);

  // Return from cache if available
  if (pageCache.has(pageIdx)) {
    const page = pageCache.get(pageIdx);
    const offset = startIdx - pageIdx * PAGE_SIZE;
    return page.rows.slice(offset, offset + count);
  }

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

    // Adjust totalRows based on how full this page is
    if (!isInterpolated && virtualTable) {
      if (rows.length < PAGE_SIZE) {
        // Short page — cap totalRows to actual loaded count
        const actualTotal = pageIdx * PAGE_SIZE + rows.length;
        if (actualTotal < virtualTable.totalRows) {
          virtualTable.setTotalRows(actualTotal);
        }
      } else {
        // Full page — ensure there's scroll room for at least one more page
        const minTotal = (pageIdx + 2) * PAGE_SIZE;
        if (minTotal > virtualTable.totalRows) {
          virtualTable.setTotalRows(minTotal);
        }
      }
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

/**
 * Create or reconfigure the VirtualTable instance.
 */
function ensureVirtualTable() {
  const container = logsView.querySelector('.logs-table-container');
  if (!container) return;

  if (virtualTable) {
    // Already exists — just clear cache and re-render
    virtualTable.clearCache();
    virtualTable.setTotalRows(0);
    return;
  }

  // Clear loading placeholder
  container.innerHTML = '';

  virtualTable = new VirtualTable({
    container,
    rowHeight: 28,
    columns: currentColumns.length > 0 ? buildVirtualColumns(currentColumns) : [],
    getData,
    renderCell,
    onVisibleRangeChange(firstRow, lastRow) {
      // Sync chart scrubber to the middle visible row
      const midIdx = Math.floor((firstRow + lastRow) / 2);
      const row = getRowFromCache(midIdx);
      if (row && row.timestamp) {
        setScrubberPosition(parseUTC(row.timestamp));
      }
    },
    onRowClick(idx, row) {
      openLogDetailModal(idx, row);
    },
  });
}

// Scroll log table to the row closest to a given timestamp
export function scrollLogsToTimestamp(timestamp) {
  if (!state.showLogs || !virtualTable) return;
  const targetMs = timestamp instanceof Date ? timestamp.getTime() : timestamp;
  virtualTable.scrollToTimestamp(targetMs, (row) => parseUTC(row.timestamp).getTime());
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
 * Estimate total rows from chart data bucket counts.
 * @returns {number}
 */
function estimateTotalRows() {
  if (!state.chartData || !state.chartData.buckets) return 0;
  return state.chartData.buckets.reduce((sum, b) => sum + (b.total || b.count || 0), 0);
}

export async function loadLogs(requestContext = getRequestContext('dashboard')) {
  const { requestId, signal, scope } = requestContext;
  const isCurrent = () => isRequestCurrent(requestId, scope);

  state.logsLoading = true;
  state.logsReady = false;

  // Reset page cache
  pageCache.clear();
  currentColumns = [];

  // Apply blur effect while loading
  const container = logsView.querySelector('.logs-table-container');
  container.classList.add('updating');

  // Set up virtual table
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
    pageSize: String(PAGE_SIZE),
  });

  try {
    const result = await query(sql, { signal });
    if (!isCurrent()) return;

    const rows = result.data;
    state.logsData = rows;
    state.logsReady = true;

    if (rows.length === 0) {
      container.innerHTML = '<div class="empty" style="padding: 60px;">No logs matching current filters</div>';
      destroyVirtualTable();
      return;
    }

    // Populate initial page cache
    const cursor = rows.length > 0 ? rows[rows.length - 1].timestamp : null;
    pageCache.set(0, { rows, cursor });

    // Set columns from data
    currentColumns = getLogColumns(Object.keys(rows[0]));
    if (virtualTable) {
      virtualTable.setColumns(buildVirtualColumns(currentColumns));

      // Seed VirtualTable cache with pre-fetched page 0 to avoid re-fetch
      virtualTable.seedCache(0, rows);

      // Estimate total rows: use chart data if available, otherwise extrapolate
      const estimated = estimateTotalRows();
      const total = estimated > rows.length ? estimated : rows.length * 10;
      virtualTable.setTotalRows(total);
    }
  } catch (err) {
    if (!isCurrent() || isAbortError(err)) return;
    // eslint-disable-next-line no-console
    console.error('Logs error:', err);
    renderLogsError(err.message);
  } finally {
    if (isCurrent()) {
      state.logsLoading = false;
      container.classList.remove('updating');
    }
  }
}

export function toggleLogsView(saveStateToURL) {
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
    ensureVirtualTable();
    // Re-seed virtual table from page cache, or trigger a fresh load
    if (state.logsReady && pageCache.size > 0) {
      const page0 = pageCache.get(0);
      if (page0 && page0.rows.length > 0) {
        currentColumns = getLogColumns(Object.keys(page0.rows[0]));
        virtualTable.setColumns(buildVirtualColumns(currentColumns));
        virtualTable.seedCache(0, page0.rows);
        const estimated = estimateTotalRows();
        const total = estimated > page0.rows.length ? estimated : page0.rows.length * 10;
        virtualTable.setTotalRows(total);
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
    // Clean up virtual table when leaving logs view
    destroyVirtualTable();
  }
  saveStateToURL();
}
