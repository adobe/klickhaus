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
import { getRequestContext, isRequestCurrent, startRequestContext } from './request-context.js';
import { LOG_COLUMN_ORDER, buildLogColumnsSql } from './columns.js';
import { loadSql } from './sql-loader.js';
import { buildLogRowHtml, buildLogTableHeaderHtml, buildGapRowHtml } from './templates/logs-table.js';
import { PAGE_SIZE, PaginationState } from './pagination.js';
import { setScrubberPosition } from './chart.js';
import { parseUTC } from './chart-state.js';

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;
// Host validation: alphanumeric, dots, hyphens, underscores (standard hostname chars)
const HOST_RE = /^[a-z0-9._-]*$/i;

/**
 * Create a gap row object representing an unloaded time range.
 * @param {string} gapStart - Newest boundary (timestamp of last loaded row above)
 * @param {string} gapEnd - Oldest boundary (first row below or range start)
 * @param {number} [gapCount] - Optional estimated count of entries in the gap
 * @returns {Object}
 */
function createGapRow(gapStart, gapEnd, gapCount) {
  const gap = {
    isGap: true,
    gapStart,
    gapEnd,
    gapLoading: false,
  };
  if (gapCount !== undefined) {
    gap.gapCount = gapCount;
  }
  return gap;
}

/**
 * Check if a data item is a gap row.
 * @param {Object} item
 * @returns {boolean}
 */
function isGapRow(item) {
  return item && item.isGap === true;
}

/**
 * Format a Date as a ClickHouse-compatible timestamp string.
 * @param {Date} date
 * @returns {string} e.g. '2026-02-12 10:00:00.000'
 */
function formatTimestampStr(date) {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

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
  if (!HOST_RE.test(host)) {
    // eslint-disable-next-line no-console
    console.warn('fetchFullRow: invalid host format, aborting', host);
    return null;
  }
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
  if (!row || isGapRow(row)) return;

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
  if (!row || isGapRow(row)) return;

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

/**
 * Update the DOM for a single gap row (e.g., to show/hide loading spinner).
 * @param {number} gapIdx
 */
function updateGapRowDom(gapIdx) {
  const container = logsView?.querySelector('.logs-table-container');
  if (!container) return;
  const gapTr = container.querySelector(
    `tr[data-row-idx="${gapIdx}"][data-gap="true"]`,
  );
  if (!gapTr) return;
  const gap = state.logsData[gapIdx];
  if (!gap || !isGapRow(gap)) return;

  const headerCells = container.querySelectorAll('.logs-table thead th');
  const colCount = headerCells.length;

  const temp = document.createElement('tbody');
  temp.innerHTML = buildGapRowHtml({ gap, rowIdx: gapIdx, colCount });
  const newRow = temp.querySelector('tr');
  if (newRow) gapTr.replaceWith(newRow);
}

// IntersectionObserver for auto-loading bottom gap
let gapObserver = null;
let loadGapFn = null;

function setupGapObserver() {
  if (gapObserver) gapObserver.disconnect();
  if (!loadGapFn) return;
  gapObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting || !state.showLogs) return;
      const lastIdx = state.logsData.length - 1;
      const gap = state.logsData[lastIdx];
      if (gap && isGapRow(gap) && !gap.gapLoading) loadGapFn(lastIdx);
    });
  }, { rootMargin: '200px 0px', threshold: 0 });
  const container = logsView?.querySelector('.logs-table-container');
  if (!container) return;
  const lastGapRow = container.querySelector('tr.logs-gap-row:last-of-type');
  if (lastGapRow) gapObserver.observe(lastGapRow);
}

export function renderLogsTable(data) {
  const container = logsView.querySelector('.logs-table-container');

  // Find first real (non-gap) row
  const firstRealRow = data.find((item) => !isGapRow(item));
  if (!firstRealRow) {
    container.innerHTML = '<div class="empty" style="padding: 60px;">No logs matching current filters</div>';
    return;
  }

  // Get all column names from first real row
  const allColumns = Object.keys(firstRealRow);

  // Sort columns: pinned first, then preferred order, then the rest
  const pinned = state.pinnedColumns.filter((col) => allColumns.includes(col));
  const columns = getLogColumns(allColumns);
  const colCount = columns.length;

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
    const item = data[rowIdx];
    if (isGapRow(item)) {
      html += buildGapRowHtml({ gap: item, rowIdx, colCount });
    } else {
      html += buildLogRowHtml({
        row: item, columns, rowIdx, pinned, pinnedOffsets,
      });
    }
  }

  html += '</tbody></table>';
  container.innerHTML = html;

  updatePinnedOffsets(container, pinned);

  // Set up IntersectionObserver for auto-loading bottom gap
  setupGapObserver();
}

/**
 * Build the replacement array when loading data into a gap.
 * @param {Object[]} newRows - Fetched rows
 * @param {Object} gap - The gap being loaded
 * @param {number} gapIdx - Index of the gap in state.logsData
 * @returns {Object[]}
 */
function buildGapReplacement(newRows, gap, gapIdx) {
  if (newRows.length === 0) return [];

  const hasMoreInGap = newRows.length === PAGE_SIZE;
  const replacement = [];
  const newestNewTs = newRows[0].timestamp;
  const oldestNewTs = newRows[newRows.length - 1].timestamp;

  // Upper sub-gap: between the row above and the newest new row
  const itemAbove = gapIdx > 0
    ? state.logsData[gapIdx - 1] : null;
  const aboveTs = itemAbove && !isGapRow(itemAbove)
    ? itemAbove.timestamp : null;
  if (aboveTs && aboveTs !== newestNewTs) {
    const aboveMs = parseUTC(aboveTs).getTime();
    const newestMs = parseUTC(newestNewTs).getTime();
    if (Math.abs(aboveMs - newestMs) > 1000) {
      replacement.push(createGapRow(aboveTs, newestNewTs));
    }
  }

  replacement.push(...newRows);

  // Lower sub-gap: between oldest new row and gap's old end
  if (hasMoreInGap) {
    replacement.push(createGapRow(oldestNewTs, gap.gapEnd));
  }

  return replacement;
}

/**
 * Load data into a gap at the given index in state.logsData.
 * @param {number} gapIdx - Index of the gap row in state.logsData
 * @returns {Promise<void>}
 */
async function loadGap(gapIdx) {
  const gap = state.logsData[gapIdx];
  if (!gap || !isGapRow(gap) || gap.gapLoading) return;

  if (!TIMESTAMP_RE.test(gap.gapStart)) {
    // eslint-disable-next-line no-console
    console.warn('loadGap: invalid gapStart format', gap.gapStart);
    return;
  }

  gap.gapLoading = true;
  updateGapRowDom(gapIdx);

  const requestContext = getRequestContext('dashboard');
  const { requestId, signal, scope } = requestContext;
  const isCurrent = () => isRequestCurrent(requestId, scope);

  const sql = await loadSql('logs-at', {
    database: DATABASE,
    table: getTable(),
    columns: buildLogColumnsSql(state.pinnedColumns),
    timeFilter: getTimeFilter(),
    hostFilter: getHostFilter(),
    facetFilters: getFacetFilters(),
    additionalWhereClause: state.additionalWhereClause,
    pageSize: String(PAGE_SIZE),
    target: gap.gapStart,
  });

  try {
    const result = await query(sql, { signal });
    if (!isCurrent()) return;

    const newRows = result.data;
    const replacement = buildGapReplacement(newRows, gap, gapIdx);
    state.logsData.splice(gapIdx, 1, ...replacement);

    // Update pagination cursor
    if (newRows.length > 0) {
      const lastNewRow = newRows[newRows.length - 1];
      const cursorMs = pagination.cursor
        ? parseUTC(pagination.cursor).getTime()
        : Infinity;
      const lastMs = parseUTC(lastNewRow.timestamp).getTime();
      if (lastMs < cursorMs) {
        pagination.cursor = lastNewRow.timestamp;
      }
    }

    renderLogsTable(state.logsData);
  } catch (err) {
    if (!isCurrent() || isAbortError(err)) return;
    // eslint-disable-next-line no-console
    console.error('Load gap error:', err);
    gap.gapLoading = false;
    updateGapRowDom(gapIdx);
  }
}

loadGapFn = loadGap; // Enable IntersectionObserver gap loading

// Set up click handler for row background clicks
export function setupLogRowClickHandler() {
  const container = logsView?.querySelector('.logs-table-container');
  if (!container) return;

  container.addEventListener('click', (e) => {
    const { target } = e;

    // Handle gap row button clicks
    const gapBtn = target.closest('[data-action="load-gap"]');
    if (gapBtn) {
      const gapIdx = parseInt(gapBtn.dataset.gapIdx, 10);
      if (!Number.isNaN(gapIdx)) {
        loadGap(gapIdx);
      }
      return;
    }

    // Only handle clicks on td or tr (not buttons, spans)
    if (target.tagName !== 'TD'
      && target.tagName !== 'TR') return;

    // Don't open modal for clickable cells (filter action)
    if (target.classList.contains('clickable')) return;

    // Find the row — skip gap rows
    const row = target.closest('tr');
    if (!row || !row.dataset.rowIdx) return;
    if (row.dataset.gap === 'true') return;

    const rowIdx = parseInt(row.dataset.rowIdx, 10);
    openLogDetailModal(rowIdx);
  });
}

// Update collapse toggle button label based on current state
function updateCollapseToggleLabel() {
  const btn = document.getElementById('chartCollapseToggle');
  const dc = document.getElementById('dashboardContent');
  if (!btn || !dc) return;
  const collapsed = dc.classList.contains('logs-collapsed');
  btn.innerHTML = collapsed ? '&#9660; Show chart' : '&#9650; Hide chart';
  btn.title = collapsed ? 'Expand chart' : 'Collapse chart';
}

// Set up collapse toggle click handler
export function initChartCollapseToggle() {
  const btn = document.getElementById('chartCollapseToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const dc = document.getElementById('dashboardContent');
    const cs = document.querySelector('.chart-section');
    if (!dc) return;
    const collapsed = !dc.classList.contains('logs-collapsed');
    dc.classList.toggle('logs-collapsed', collapsed);
    cs?.classList.toggle('chart-collapsed', collapsed);
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
  // Skip gap rows for scrubber sync
  if (topRow.dataset.gap === 'true') return;
  const rowIdx = parseInt(topRow.dataset.rowIdx, 10);
  const rowData = state.logsData[rowIdx];
  if (!rowData || isGapRow(rowData) || !rowData.timestamp) return;

  const timestamp = parseUTC(rowData.timestamp);
  setScrubberPosition(timestamp);
}

const throttledSyncScrubber = throttle(syncScrubberToScroll, 100);

/**
 * Get the timestamp (in ms) for an item, handling both regular rows and gap rows.
 * For gap rows, returns the gapStart (newest boundary).
 * @param {Object} item
 * @returns {number|null}
 */
function getItemTimestampMs(item) {
  if (isGapRow(item)) {
    return parseUTC(item.gapStart).getTime();
  }
  if (item.timestamp) {
    return parseUTC(item.timestamp).getTime();
  }
  return null;
}

/**
 * Find the closest item in state.logsData to a target timestamp using binary search.
 * Data is sorted by timestamp DESC (newest first).
 * Returns { index, isGap } indicating whether the closest match is a gap row.
 * @param {number} targetMs
 * @returns {{ index: number, isGap: boolean }}
 */
function findClosestItem(targetMs) {
  const data = state.logsData;
  const n = data.length;
  if (n === 0) return { index: 0, isGap: false };

  // Binary search for insertion point (data sorted DESC by timestamp)
  let low = 0;
  let high = n - 1;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const midMs = getItemTimestampMs(data[mid]);
    if (midMs === null) {
      // Skip items without timestamps by expanding search
      low = mid + 1;
    } else if (midMs > targetMs) {
      // Target is older (smaller ms), search right half
      low = mid + 1;
    } else {
      // Target is newer or equal, search left half
      high = mid;
    }
  }

  // Check candidates around the insertion point
  const candidates = [];
  for (let i = Math.max(0, low - 1); i <= Math.min(n - 1, low + 1); i += 1) {
    candidates.push(i);
  }

  let closestIdx = 0;
  let closestDiff = Infinity;
  let closestIsGap = false;

  for (const i of candidates) {
    const item = data[i];
    if (isGapRow(item)) {
      const gapStartMs = parseUTC(item.gapStart).getTime();
      const gapEndMs = parseUTC(item.gapEnd).getTime();
      // Check if target falls within this gap
      if (targetMs <= gapStartMs && targetMs >= gapEndMs) {
        return { index: i, isGap: true };
      }
      const diff = Math.min(Math.abs(gapStartMs - targetMs), Math.abs(gapEndMs - targetMs));
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIdx = i;
        closestIsGap = true;
      }
    } else if (item.timestamp) {
      const rowMs = parseUTC(item.timestamp).getTime();
      const diff = Math.abs(rowMs - targetMs);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIdx = i;
        closestIsGap = false;
      }
    }
  }

  return { index: closestIdx, isGap: closestIsGap };
}

/**
 * Scroll log table to the row closest to a given timestamp.
 * If the target is inside a gap, load data at that position first.
 * @param {Date|number} timestamp
 */
export async function scrollLogsToTimestamp(timestamp) {
  if (!state.showLogs || !state.logsData || state.logsData.length === 0) return;

  const targetMs = timestamp instanceof Date ? timestamp.getTime() : timestamp;
  const { index, isGap } = findClosestItem(targetMs);

  if (isGap) {
    // Target is inside a gap — load data there, then scroll
    await loadGap(index);
    // After loading, find the closest real row and scroll
    const { index: newIdx } = findClosestItem(targetMs);
    const container = logsView?.querySelector('.logs-table-container');
    if (!container) return;
    const targetRow = container.querySelector(`tr[data-row-idx="${newIdx}"]`);
    if (targetRow) {
      targetRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  } else {
    const container = logsView?.querySelector('.logs-table-container');
    if (!container) return;
    const targetRow = container.querySelector(`tr[data-row-idx="${index}"]`);
    if (targetRow) {
      targetRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
}

function handleLogsScroll() {
  // Only handle scroll when logs view is visible
  if (!state.showLogs) return;

  // Sync chart scrubber to topmost visible log row
  throttledSyncScrubber();
}

export function setLogsElements(view, toggleBtn, filtersViewEl) {
  logsView = view;
  viewToggleBtn = toggleBtn;
  filtersView = filtersViewEl;

  // Set up scroll listener for scrubber sync
  document.body.addEventListener('scroll', handleLogsScroll);

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
  const chartSection = document.querySelector('.chart-section');
  if (state.showLogs) {
    // Cancel in-flight facet requests to prioritize log loading
    startRequestContext('facets');
    logsView.classList.add('visible');
    filtersView.classList.remove('visible');
    viewToggleBtn.querySelector('.menu-item-label').textContent = 'View Filters';
    dashboardContent.classList.add('logs-active');
    // Restore collapse state from localStorage
    if (localStorage.getItem('chartCollapsed') === 'true') {
      dashboardContent.classList.add('logs-collapsed');
      if (chartSection) chartSection.classList.add('chart-collapsed');
    }
    updateCollapseToggleLabel();
  } else {
    logsView.classList.remove('visible');
    filtersView.classList.add('visible');
    viewToggleBtn.querySelector('.menu-item-label').textContent = 'View Logs';
    dashboardContent.classList.remove('logs-active');
    dashboardContent.classList.remove('logs-collapsed');
    if (chartSection) chartSection.classList.remove('chart-collapsed');
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
    pagination.recordPage(result.data);

    // If more data is available, append a bottom gap
    if (pagination.hasMore && result.data.length > 0) {
      const lastRow = result.data[result.data.length - 1];
      const timeRangeBounds = getTimeRangeBounds();
      const gapEnd = formatTimestampStr(timeRangeBounds.start);
      state.logsData.push(createGapRow(lastRow.timestamp, gapEnd));
    }

    renderLogsTable(state.logsData);
    state.logsReady = true;
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
