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
import { query } from './api.js';
import { getTimeFilter, getHostFilter, getTable } from './time.js';
import { getFacetFilters } from './breakdowns/index.js';
import { escapeHtml } from './utils.js';
import { formatBytes } from './format.js';
import { getColorForColumn } from './colors/index.js';
import { LOG_COLUMN_ORDER, LOG_COLUMN_SHORT_LABELS, LOG_COLUMN_TO_FACET } from './columns.js';

// Format timestamp - short format on mobile
function formatTimestamp(value) {
  const date = new Date(value);
  const isMobile = window.innerWidth < 600;
  if (isMobile) {
    return date.toLocaleTimeString();
  }
  return date.toLocaleString();
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
 * Format a log cell for display and color.
 * @param {string} col
 * @param {unknown} value
 * @returns {{ displayValue: string, cellClass: string, colorIndicator: string }}
 */
function formatLogCell(col, value) {
  let cellClass = '';
  let displayValue = '';

  if (col === 'timestamp' && value) {
    displayValue = formatTimestamp(value);
    cellClass = 'timestamp';
  } else if (col === 'response.status' && value) {
    const status = parseInt(value, 10);
    displayValue = String(status);
    if (status >= 500) cellClass = 'status-5xx';
    else if (status >= 400) cellClass = 'status-4xx';
    else cellClass = 'status-ok';
  } else if (col === 'response.body_size' && value) {
    displayValue = formatBytes(parseInt(value, 10));
  } else if (col === 'request.method') {
    displayValue = value || '';
    cellClass = 'method';
  } else if (value === null || value === undefined || value === '') {
    displayValue = '';
  } else if (typeof value === 'object') {
    displayValue = JSON.stringify(value);
  } else {
    displayValue = String(value);
  }

  const color = value ? getColorForColumn(col, value) : '';
  const colorIndicator = color ? `<span class="log-color" style="background:${color}"></span>` : '';

  return { displayValue, cellClass, colorIndicator };
}

/**
 * Build HTML for a log table cell.
 * @param {Object} params
 * @param {string} params.col
 * @param {unknown} params.value
 * @param {string[]} params.pinned
 * @param {Record<string, number>} [params.pinnedOffsets]
 * @returns {string}
 */
function buildLogCellHtml({
  col, value, pinned, pinnedOffsets,
}) {
  const { displayValue, cellClass, colorIndicator } = formatLogCell(col, value);
  const isPinned = pinned.includes(col);
  const leftOffset = isPinned && pinnedOffsets && pinnedOffsets[col] !== undefined
    ? `left: ${pinnedOffsets[col]}px;`
    : '';

  let className = cellClass;
  if (isPinned) className = `${className} pinned`.trim();

  const escaped = escapeHtml(displayValue);

  let actionAttrs = '';
  const facetMapping = LOG_COLUMN_TO_FACET[col];
  if (colorIndicator && facetMapping && value !== null && value !== undefined && value !== '') {
    const filterValue = facetMapping.transform ? facetMapping.transform(value) : String(value);
    className = `${className} clickable`.trim();
    actionAttrs = ` data-action="add-filter" data-col="${escapeHtml(facetMapping.col)}" data-value="${escapeHtml(filterValue)}" data-exclude="false"`;
  }

  return `<td class="${className}" style="${leftOffset}" title="${escaped}"${actionAttrs}>${colorIndicator}${escaped}</td>`;
}

/**
 * Build HTML for a log table row.
 * @param {Object} params
 * @param {Object} params.row
 * @param {string[]} params.columns
 * @param {number} params.rowIdx
 * @param {string[]} params.pinned
 * @param {Record<string, number>} [params.pinnedOffsets]
 * @returns {string}
 */
function buildLogRowHtml({
  row, columns, rowIdx, pinned, pinnedOffsets,
}) {
  let html = `<tr data-row-idx="${rowIdx}">`;
  for (const col of columns) {
    html += buildLogCellHtml({
      col, value: row[col], pinned, pinnedOffsets,
    });
  }
  html += '</tr>';
  return html;
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
const PAGE_SIZE = 500;
let logsOffset = 0;
let hasMoreLogs = true;
let loadingMore = false;

// Show brief "Copied!" feedback
function showCopyFeedback() {
  let feedback = document.getElementById('copy-feedback');
  if (!feedback) {
    feedback = document.createElement('div');
    feedback.id = 'copy-feedback';
    feedback.textContent = 'Copied to clipboard';
    feedback.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--text);
      color: var(--bg);
      padding: 8px 16px;
      border-radius: 4px;
      font-size: 14px;
      z-index: 9999;
      opacity: 0;
      transition: opacity 0.2s;
    `;
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
 * Open log detail modal for a row.
 * @param {number} rowIdx
 */
export function openLogDetailModal(rowIdx) {
  const row = state.logsData[rowIdx];
  if (!row) return;

  if (!logDetailModal) {
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

  renderLogDetailContent(row);
  logDetailModal.showModal();
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
          ${columns.map((col) => {
    const isPinned = pinned.includes(col);
    const pinnedClass = isPinned ? 'pinned' : '';
    const leftOffset = isPinned ? `left: ${pinnedOffsets[col]}px;` : '';
    const displayName = LOG_COLUMN_SHORT_LABELS[col] || col;
    const titleAttr = LOG_COLUMN_SHORT_LABELS[col] ? ` title="${escapeHtml(col)}"` : '';
    const actionAttrs = ` data-action="toggle-pinned-column" data-col="${escapeHtml(col)}"`;
    return `<th class="${pinnedClass}" style="${leftOffset}"${titleAttr}${actionAttrs}>${escapeHtml(displayName)}</th>`;
  }).join('')}
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
  if (loadingMore || !hasMoreLogs) return;
  loadingMore = true;

  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const facetFilters = getFacetFilters();

  const sql = `
    SELECT *
    FROM ${DATABASE}.${getTable()}
    WHERE ${timeFilter} ${hostFilter} ${facetFilters}
    ORDER BY timestamp DESC
    LIMIT ${PAGE_SIZE}
    OFFSET ${logsOffset}
  `;

  try {
    const result = await query(sql);
    if (result.data.length > 0) {
      state.logsData = [...state.logsData, ...result.data];
      appendLogsRows(result.data);
      logsOffset += result.data.length;
    }
    // Check if there might be more data
    hasMoreLogs = result.data.length === PAGE_SIZE;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Load more logs error:', err);
  } finally {
    loadingMore = false;
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
  if (scrollPercent > 0.5 && hasMoreLogs && !loadingMore && !state.logsLoading) {
    loadMoreLogs();
  }
}

export function setLogsElements(view, toggleBtn, filtersViewEl) {
  logsView = view;
  viewToggleBtn = toggleBtn;
  filtersView = filtersViewEl;

  // Set up scroll listener for infinite scroll on window
  window.addEventListener('scroll', handleLogsScroll);

  // Set up click handler for copying row data
  setupLogRowClickHandler();
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
  if (state.showLogs) {
    logsView.classList.add('visible');
    filtersView.classList.remove('visible');
    viewToggleBtn.querySelector('.menu-item-label').textContent = 'View Filters';
  } else {
    logsView.classList.remove('visible');
    filtersView.classList.add('visible');
    viewToggleBtn.querySelector('.menu-item-label').textContent = 'View Logs';
    // Redraw chart after view becomes visible
    if (onShowFiltersView) {
      requestAnimationFrame(() => onShowFiltersView());
    }
  }
  saveStateToURL();
}

export async function loadLogs() {
  if (state.logsLoading) return;
  state.logsLoading = true;
  state.logsReady = false;

  // Reset pagination state
  logsOffset = 0;
  hasMoreLogs = true;

  // Apply blur effect while loading
  const container = logsView.querySelector('.logs-table-container');
  container.classList.add('updating');

  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const facetFilters = getFacetFilters();

  const sql = `
    SELECT *
    FROM ${DATABASE}.${getTable()}
    WHERE ${timeFilter} ${hostFilter} ${facetFilters}
    ORDER BY timestamp DESC
    LIMIT ${PAGE_SIZE}
  `;

  try {
    const result = await query(sql);
    state.logsData = result.data;
    renderLogsTable(result.data);
    state.logsReady = true;
    // Check if there might be more data
    hasMoreLogs = result.data.length === PAGE_SIZE;
    logsOffset = result.data.length;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Logs error:', err);
    renderLogsError(err.message);
  } finally {
    state.logsLoading = false;
    container.classList.remove('updating');
  }
}
