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
import { getTimeFilter, getHostFilter, getTable } from './time.js';
import { getFacetFilters } from './breakdowns/index.js';
import { escapeHtml } from './utils.js';
import { formatBytes } from './format.js';
import { getColorForColumn } from './colors/index.js';
import { getRequestContext, isRequestCurrent } from './request-context.js';
import { LOG_COLUMN_ORDER, LOG_COLUMN_SHORT_LABELS, buildLogColumnsSql } from './columns.js';
import { loadSql } from './sql-loader.js';
import { buildLogRowHtml, buildLogTableHeaderHtml } from './templates/logs-table.js';
import { PAGE_SIZE, PaginationState } from './pagination.js';
import { setScrubberPosition } from './chart.js';
import { parseUTC } from './chart-state.js';

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

/**
 * Build approximate left offsets for pinned columns.
 * @param {string[]} pinned
 * @param {number} width
 * @returns {Record<string, number>}
 */
function getApproxPinnedOffsets(pinned, width) {
  const offsets = {};
  pinned.forEach((col, index) => {
    offsets[col] = index * width;
  });
  return offsets;
}

/**
 * Update pinned column offsets based on actual column widths.
 * @param {HTMLElement} container
 * @param {string[]} pinned
 */
function updatePinnedOffsets(container, pinned) {
  if (pinned.length === 0) return;

  requestAnimationFrame(() => {
    const table = container.querySelector('.logs-table');
    if (!table) return;
    const headerCells = table.querySelectorAll('thead th');
    const pinnedWidths = [];
    let cumLeft = 0;

    for (let i = 0; i < pinned.length; i += 1) {
      pinnedWidths.push(cumLeft);
      cumLeft += headerCells[i].offsetWidth;
    }

    headerCells.forEach((headerCell, idx) => {
      if (idx < pinned.length) {
        const th = headerCell;
        th.style.left = `${pinnedWidths[idx]}px`;
      }
    });

    const rows = table.querySelectorAll('tbody tr');
    rows.forEach((row) => {
      const cells = row.querySelectorAll('td');
      cells.forEach((cell, idx) => {
        if (idx < pinned.length) {
          const td = cell;
          td.style.left = `${pinnedWidths[idx]}px`;
        }
      });
    });
  });
}

// DOM elements (set by main.js)
let logsView = null;
let viewToggleBtn = null;
let filtersView = null;

// Pagination state
const pagination = new PaginationState();

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
 * Open log detail modal for a row.
 * Fetches full row data on demand if not already present.
 * @param {number} rowIdx
 */
export async function openLogDetailModal(rowIdx) {
  const row = state.logsData[rowIdx];
  if (!row) return;

  initLogDetailModal();
  if (!logDetailModal) return;

  // Show modal immediately with loading state
  showDetailLoading();
  logDetailModal.showModal();

  // Check if row already has full data (e.g. from a previous fetch)
  if (row.fullRowData) {
    renderLogDetailContent(row.fullRowData);
    return;
  }

  try {
    const fullRow = await fetchFullRow(row);
    if (fullRow) {
      // Cache the full row for future opens
      row.fullRowData = fullRow;
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
  const row = state.logsData[rowIdx];
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

// Set up click handler for row background clicks
export function setupLogRowClickHandler() {
  const container = logsView?.querySelector('.logs-table-container');
  if (!container) return;

  container.addEventListener('click', (e) => {
    // Only handle clicks directly on td or tr (not on links, buttons, or spans)
    const { target } = e;
    if (target.tagName !== 'TD' && target.tagName !== 'TR') return;

    // Don't open modal if clicking on a clickable cell (filter action)
    if (target.classList.contains('clickable')) return;

    // Find the row
    const row = target.closest('tr');
    if (!row || !row.dataset.rowIdx) return;

    const rowIdx = parseInt(row.dataset.rowIdx, 10);
    openLogDetailModal(rowIdx);
  });
}

function renderLogsError(message) {
  const container = logsView.querySelector('.logs-table-container');
  container.innerHTML = `<div class="empty" style="padding: 60px;">Error loading logs: ${escapeHtml(message)}</div>`;
}

// Append rows to existing logs table (for infinite scroll)
function appendLogsRows(data) {
  const container = logsView.querySelector('.logs-table-container');
  const tbody = container.querySelector('.logs-table tbody');
  if (!tbody || data.length === 0) return;

  // Get columns from existing table header
  const headerCells = container.querySelectorAll('.logs-table thead th');
  const columns = Array.from(headerCells).map((th) => th.title || th.textContent);

  // Map short names back to full names
  const shortToFull = Object.fromEntries(
    Object.entries(LOG_COLUMN_SHORT_LABELS).map(([full, short]) => [short, full]),
  );

  const fullColumns = columns.map((col) => shortToFull[col] || col);
  const pinned = state.pinnedColumns.filter((col) => fullColumns.includes(col));

  // Get starting index from existing rows
  const existingRows = tbody.querySelectorAll('tr').length;

  let html = '';
  for (let i = 0; i < data.length; i += 1) {
    const rowIdx = existingRows + i;
    html += buildLogRowHtml({
      row: data[i], columns: fullColumns, rowIdx, pinned,
    });
  }

  tbody.insertAdjacentHTML('beforeend', html);

  updatePinnedOffsets(container, pinned);
}

export function renderLogsTable(data) {
  const container = logsView.querySelector('.logs-table-container');

  if (data.length === 0) {
    container.innerHTML = '<div class="empty" style="padding: 60px;">No logs matching current filters</div>';
    return;
  }

  // Get all column names from first row
  const allColumns = Object.keys(data[0]);

  // Sort columns: pinned first, then preferred order, then the rest
  const pinned = state.pinnedColumns.filter((col) => allColumns.includes(col));
  const columns = getLogColumns(allColumns);

  // Calculate left offsets for sticky pinned columns
  const COL_WIDTH = 120;
  const pinnedOffsets = getApproxPinnedOffsets(pinned, COL_WIDTH);

  let html = `
    <table class="logs-table">
      <thead>
        <tr>
          ${buildLogTableHeaderHtml(columns, pinned, pinnedOffsets)}
        </tr>
      </thead>
      <tbody>
  `;

  for (let rowIdx = 0; rowIdx < data.length; rowIdx += 1) {
    html += buildLogRowHtml({
      row: data[rowIdx], columns, rowIdx, pinned, pinnedOffsets,
    });
  }

  html += '</tbody></table>';
  container.innerHTML = html;

  updatePinnedOffsets(container, pinned);
}

async function loadMoreLogs() {
  if (!pagination.canLoadMore()) return;

  // Validate cursor format before interpolating into SQL
  if (!TIMESTAMP_RE.test(pagination.cursor)) {
    // eslint-disable-next-line no-console
    console.warn('loadMoreLogs: invalid cursor format, aborting', pagination.cursor);
    return;
  }

  pagination.loading = true;
  const requestContext = getRequestContext('dashboard');
  const { requestId, signal, scope } = requestContext;
  const isCurrent = () => isRequestCurrent(requestId, scope);

  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const facetFilters = getFacetFilters();

  const sql = await loadSql('logs-more', {
    database: DATABASE,
    table: getTable(),
    columns: buildLogColumnsSql(state.pinnedColumns),
    timeFilter,
    hostFilter,
    facetFilters,
    additionalWhereClause: state.additionalWhereClause,
    pageSize: String(PAGE_SIZE),
    cursor: pagination.cursor,
  });

  try {
    const result = await query(sql, { signal });
    if (!isCurrent()) return;
    if (result.data.length > 0) {
      state.logsData = [...state.logsData, ...result.data];
      appendLogsRows(result.data);
    }
    pagination.recordPage(result.data);
  } catch (err) {
    if (!isCurrent() || isAbortError(err)) return;
    // eslint-disable-next-line no-console
    console.error('Load more logs error:', err);
  } finally {
    if (isCurrent()) {
      pagination.loading = false;
    }
  }
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

// Throttle helper
function throttle(fn, delay) {
  let lastCall = 0;
  let timer = null;
  let pendingArgs = null;
  return (...args) => {
    const now = Date.now();
    const remaining = delay - (now - lastCall);
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pendingArgs = null;
      lastCall = now;
      fn(...args);
    } else {
      pendingArgs = args;
      if (!timer) {
        timer = setTimeout(() => {
          lastCall = Date.now();
          timer = null;
          const latestArgs = pendingArgs;
          pendingArgs = null;
          fn(...latestArgs);
        }, remaining);
      }
    }
  };
}

// Scroll→Chart sync: update scrubber to match topmost visible log row
function syncScrubberToScroll() {
  if (!state.showLogs || !state.logsData || state.logsData.length === 0) return;

  const container = logsView?.querySelector('.logs-table-container');
  if (!container) return;

  // Find the topmost visible row below the sticky chart
  const chartSection = document.querySelector('.chart-section');
  const chartBottom = chartSection ? chartSection.getBoundingClientRect().bottom : 0;

  const rows = container.querySelectorAll('.logs-table tbody tr');
  let topRow = null;
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (rect.bottom > chartBottom) {
      topRow = row;
      break;
    }
  }

  if (!topRow || !topRow.dataset.rowIdx) return;
  const rowIdx = parseInt(topRow.dataset.rowIdx, 10);
  const rowData = state.logsData[rowIdx];
  if (!rowData || !rowData.timestamp) return;

  const timestamp = parseUTC(rowData.timestamp);
  setScrubberPosition(timestamp);
}

const throttledSyncScrubber = throttle(syncScrubberToScroll, 100);

// Scroll log table to the row closest to a given timestamp
export function scrollLogsToTimestamp(timestamp) {
  if (!state.showLogs || !state.logsData || state.logsData.length === 0) return;

  const targetMs = timestamp instanceof Date ? timestamp.getTime() : timestamp;
  let closestIdx = 0;
  let closestDiff = Infinity;

  for (let i = 0; i < state.logsData.length; i += 1) {
    const row = state.logsData[i];
    if (!row.timestamp) {
      continue; // eslint-disable-line no-continue
    } else {
      const rowMs = parseUTC(row.timestamp).getTime();
      const diff = Math.abs(rowMs - targetMs);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIdx = i;
      }
    }
  }

  const container = logsView?.querySelector('.logs-table-container');
  if (!container) return;
  const targetRow = container.querySelector(`tr[data-row-idx="${closestIdx}"]`);
  if (targetRow) {
    targetRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function handleLogsScroll() {
  // Only handle scroll when logs view is visible
  if (!state.showLogs) return;

  const { scrollHeight } = document.documentElement;
  const scrollTop = window.scrollY;
  const clientHeight = window.innerHeight;

  // Load more when scrolled to last 50%
  const scrollPercent = (scrollTop + clientHeight) / scrollHeight;
  if (pagination.shouldTriggerLoad(scrollPercent, state.logsLoading)) {
    loadMoreLogs();
  }

  // Sync chart scrubber to topmost visible log row
  throttledSyncScrubber();
}

export function setLogsElements(view, toggleBtn, filtersViewEl) {
  logsView = view;
  viewToggleBtn = toggleBtn;
  filtersView = filtersViewEl;

  // Set up scroll listener for infinite scroll on window
  window.addEventListener('scroll', handleLogsScroll);

  // Set up click handler for copying row data
  setupLogRowClickHandler();

  // Set up chart collapse toggle
  initChartCollapseToggle();
}

// Register callback for pinned column changes
setOnPinnedColumnsChange(renderLogsTable);

// Callback for redrawing chart when switching views
let onShowFiltersView = null;

export function setOnShowFiltersView(callback) {
  onShowFiltersView = callback;
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
  } else {
    logsView.classList.remove('visible');
    filtersView.classList.add('visible');
    viewToggleBtn.querySelector('.menu-item-label').textContent = 'View Logs';
    dashboardContent.classList.remove('logs-active');
    // Redraw chart after view becomes visible
    if (onShowFiltersView) {
      requestAnimationFrame(() => onShowFiltersView());
    }
  }
  saveStateToURL();
}

export async function loadLogs(requestContext = getRequestContext('dashboard')) {
  const { requestId, signal, scope } = requestContext;
  const isCurrent = () => isRequestCurrent(requestId, scope);

  state.logsLoading = true;
  state.logsReady = false;

  // Reset pagination state
  pagination.reset();

  // Apply blur effect while loading
  const container = logsView.querySelector('.logs-table-container');
  container.classList.add('updating');

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
    state.logsData = result.data;
    renderLogsTable(result.data);
    state.logsReady = true;
    pagination.recordPage(result.data);
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
