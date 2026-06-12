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
import {
  state, setOnPinnedColumnsChange, setOnLogColumnPrefsChange, saveViewMode,
} from './state.js';
import { query, isAbortError } from './api.js';
import { getTimeFilter, getHostFilter, getLogsTable } from './time.js';
import { getFacetFilters } from './breakdowns/index.js';
import { escapeHtml } from './utils.js';
import { formatBytes } from './format.js';
import { getColorForColumn } from './colors/index.js';
import { getRequestContext, isRequestCurrent } from './request-context.js';
import { LOG_COLUMN_ORDER, LOG_COLUMN_SHORT_LABELS } from './columns.js';
import { loadSql } from './sql-loader.js';
import { buildLogRowHtml, buildLogTableHeaderHtml } from './templates/logs-table.js';
import { attachColumnResize } from './column-resize.js';
import { PAGE_SIZE, PaginationState } from './pagination.js';

/**
 * Build ordered log column list from available columns.
 * @param {string[]} allColumns
 * @returns {string[]}
 */
function getLogColumns(allColumns) {
  const hidden = new Set(state.hiddenLogColumns || []);
  const visible = allColumns.filter((col) => !hidden.has(col));
  const columnOrder = state.userLogColumnOrder ?? state.logColumnOrder ?? LOG_COLUMN_ORDER;
  const pinned = state.pinnedColumns.filter((col) => visible.includes(col));
  const preferred = columnOrder
    .filter((col) => visible.includes(col) && !pinned.includes(col));
  const rest = visible.filter((col) => !pinned.includes(col) && !columnOrder.includes(col));
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
  if (pinned.length === 0) { return; }

  requestAnimationFrame(() => {
    const table = container.querySelector('.logs-table');
    if (!table) { return; }
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
let filtersView = null;
let contentArea = null;

const CYCLE_MODES = ['filters', 'logs', 'split'];
const SPLIT_BREAKPOINT = window.matchMedia('(max-width: 1500px)');
const VIEW_META = {
  filters: {
    title: 'Switch to Filters view',
    icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>',
  },
  logs: {
    title: 'Switch to Logs view',
    icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1" width="14" height="14" rx="2"/><line x1="4" y1="5" x2="12" y2="5"/><line x1="4" y1="8" x2="12" y2="8"/><line x1="4" y1="11" x2="9" y2="11"/></svg>',
  },
  split: {
    title: 'Switch to Split view',
    icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1" width="14" height="14" rx="2"/><line x1="8" y1="1" x2="8" y2="15"/></svg>',
  },
};

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
    if (status >= 500) {
      className = 'status-5xx';
    } else if (status >= 400) {
      className = 'status-4xx';
    } else {
      className = 'status-ok';
    }
  } else if (col === 'response.body_size') {
    displayValue = formatBytes(parseInt(value, 10));
  } else if (typeof value === 'object') {
    displayValue = JSON.stringify(value, null, 2);
  } else {
    displayValue = String(value);
  }

  const color = getColorForColumn(`\`${col}\``, value);
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
  if (!table) { return; }

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
        const filterBtn = (col === 'request_id' && value)
          ? ` <button type="button" class="detail-filter-btn" data-action="search-by-request-id" data-value="${escapeHtml(String(value))}" title="Search by this request ID">search</button>`
          : '';
        html += `<tr>
        <th title="${escapeHtml(col)}">${escapeHtml(displayCol)}</th>
        <td class="${className}">${valueHtml}${filterBtn}</td>
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
 * Open log detail modal for a row.
 * @param {number} rowIdx
 */
export function openLogDetailModal(rowIdx) {
  const row = state.logsData[rowIdx];
  if (!row) { return; }

  if (!logDetailModal) {
    logDetailModal = document.getElementById('logDetailModal');
    if (!logDetailModal) { return; }

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

    // Search-by-request-id button handler
    logDetailModal.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="search-by-request-id"]');
      if (!btn) { return; }
      const searchInput = document.getElementById('searchFilter');
      if (searchInput) {
        searchInput.value = btn.dataset.value;
        searchInput.dispatchEvent(new Event('change'));
      }
      closeLogDetailModal();
    });
  }

  renderLogDetailContent(row);
  logDetailModal.showModal();
}

// Copy row data as JSON when clicking on row background
export function copyLogRow(rowIdx) {
  const row = state.logsData[rowIdx];
  if (!row) { return; }

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
  if (!container) { return; }

  container.addEventListener('click', (e) => {
    // Only handle clicks directly on td or tr (not on links, buttons, or spans)
    const { target } = e;
    if (target.tagName !== 'TD' && target.tagName !== 'TR') { return; }

    // Don't open modal if clicking on a clickable cell (filter action)
    if (target.classList.contains('clickable')) { return; }

    // Don't open modal if the user is selecting text
    const selection = window.getSelection?.();
    if (selection && selection.toString().length > 0) { return; }

    // Find the row
    const row = target.closest('tr');
    if (!row || !row.dataset.rowIdx) { return; }

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
  if (!tbody || data.length === 0) { return; }

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

  const widths = state.logColumnWidths || {};
  let html = '';
  for (let i = 0; i < data.length; i += 1) {
    const rowIdx = existingRows + i;
    html += buildLogRowHtml({
      row: data[i], columns: fullColumns, rowIdx, pinned, widths,
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

  const widths = state.logColumnWidths || {};

  let html = `
    <table class="logs-table">
      <thead>
        <tr>
          ${buildLogTableHeaderHtml(columns, pinned, pinnedOffsets, widths)}
        </tr>
      </thead>
      <tbody>
  `;

  for (let rowIdx = 0; rowIdx < data.length; rowIdx += 1) {
    html += buildLogRowHtml({
      row: data[rowIdx], columns, rowIdx, pinned, pinnedOffsets, widths,
    });
  }

  html += '</tbody></table>';
  container.innerHTML = html;

  updatePinnedOffsets(container, pinned);
  attachColumnResize(container, () => updatePinnedOffsets(container, state.pinnedColumns));
}

async function loadMoreLogs() {
  if (!pagination.canLoadMore()) { return; }
  pagination.loading = true;
  const requestContext = getRequestContext('dashboard');
  const { requestId, signal, scope } = requestContext;
  const isCurrent = () => isRequestCurrent(requestId, scope);

  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const facetFilters = getFacetFilters();

  const sql = await loadSql('logs-more', {
    database: DATABASE,
    table: getLogsTable(),
    timeFilter,
    hostFilter,
    facetFilters,
    additionalWhereClause: state.additionalWhereClause,
    pageSize: String(PAGE_SIZE),
    offset: String(pagination.offset),
  });

  try {
    const result = await query(sql, { signal });
    if (!isCurrent()) { return; }
    if (result.data.length > 0) {
      state.logsData = [...state.logsData, ...result.data];
      appendLogsRows(result.data);
    }
    pagination.recordPage(result.data.length);
  } catch (err) {
    if (!isCurrent() || isAbortError(err)) { return; }
    // eslint-disable-next-line no-console
    console.error('Load more logs error:', err);
  } finally {
    pagination.loading = false;
  }
}

function handleLogsScroll() {
  // Only handle scroll when logs view is visible
  if (state.viewMode === 'filters') { return; }

  const { scrollHeight } = document.documentElement;
  const scrollTop = window.scrollY;
  const clientHeight = window.innerHeight;

  // Load more when scrolled to last 50%
  const scrollPercent = (scrollTop + clientHeight) / scrollHeight;
  if (pagination.shouldTriggerLoad(scrollPercent, state.logsLoading)) {
    loadMoreLogs();
  }
}

export function setLogsElements(view, filtersViewEl, contentAreaEl) {
  logsView = view;
  filtersView = filtersViewEl;
  contentArea = contentAreaEl;

  // Set up scroll listener for infinite scroll on window
  window.addEventListener('scroll', handleLogsScroll);

  // Set up click handler for copying row data
  setupLogRowClickHandler();
}

// Register callback for pinned column changes
setOnPinnedColumnsChange(renderLogsTable);
setOnLogColumnPrefsChange(renderLogsTable);

// Callback for redrawing chart when switching views
let onShowFiltersView = null;
let onShowLogsView = null;

export function setOnShowFiltersView(callback) {
  onShowFiltersView = callback;
}

export function setOnShowLogsView(callback) {
  onShowLogsView = callback;
}

export function applyViewMode(suppressDataLoad = false) {
  const { viewMode } = state;
  const isSplit = viewMode === 'split';
  const isLogs = viewMode === 'logs';
  const showLogs = isLogs || isSplit;

  logsView.classList.toggle('visible', showLogs);
  filtersView.classList.toggle('visible', !isLogs);
  filtersView.classList.toggle('in-split', isSplit);
  if (contentArea) { contentArea.classList.toggle('split', isSplit); }

  const modes = SPLIT_BREAKPOINT.matches ? ['filters', 'logs'] : CYCLE_MODES;
  const nextMode = modes[(modes.indexOf(viewMode) + 1) % modes.length];
  const meta = VIEW_META[nextMode] || VIEW_META.filters;

  const cycleBtn = document.getElementById('viewCycleBtn');
  if (cycleBtn) {
    cycleBtn.innerHTML = meta.icon;
    cycleBtn.title = meta.title;
  }

  const moreLabel = document.querySelector('#moreViewToggleItem .menu-item-label');
  if (moreLabel) { moreLabel.textContent = meta.title; }

  if (!suppressDataLoad) {
    if (showLogs && onShowLogsView && !state.logsReady) {
      requestAnimationFrame(() => onShowLogsView());
    }
    if (viewMode !== 'logs' && onShowFiltersView) {
      requestAnimationFrame(() => onShowFiltersView());
    }
  }
}

export function setViewMode(mode, saveStateToURL) {
  state.viewMode = mode;
  saveViewMode(mode);
  applyViewMode();
  saveStateToURL();
}

export function cycleViewMode(saveStateToURL) {
  const modes = SPLIT_BREAKPOINT.matches ? ['filters', 'logs'] : CYCLE_MODES;
  const next = modes[(modes.indexOf(state.viewMode) + 1) % modes.length];
  setViewMode(next, saveStateToURL);
}

/** @deprecated use setViewMode / cycleViewMode */
export function toggleLogsView(saveStateToURL) {
  cycleViewMode(saveStateToURL);
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
    table: getLogsTable(),
    timeFilter,
    hostFilter,
    facetFilters,
    additionalWhereClause: state.additionalWhereClause,
    pageSize: String(PAGE_SIZE),
  });

  try {
    const result = await query(sql, { signal });
    if (!isCurrent()) { return; }
    state.logsData = result.data;
    renderLogsTable(result.data);
    state.logsReady = true;
    pagination.recordPage(result.data.length);
  } catch (err) {
    if (!isCurrent() || isAbortError(err)) { return; }
    // eslint-disable-next-line no-console
    console.error('Logs error:', err, '\nSQL:', sql);
    renderLogsError(err.message);
  } finally {
    state.logsLoading = false;
    container.classList.remove('updating');
  }
}
