// Logs view management
import { DATABASE } from './config.js';
import { state, setOnPinnedColumnsChange } from './state.js';
import { query } from './api.js';
import { getTimeFilter, getHostFilter, getTable } from './time.js';
import { getFacetFilters } from './breakdowns/index.js';
import { escapeHtml } from './utils.js';
import { formatBytes } from './format.js';
import {
  getStatusColor, getMethodColor, getHostColor, getContentTypeColor,
  getCacheStatusColor, getPathColor, getRefererColor, getUserAgentColor,
  getIPColor, getRequestTypeColor, getBackendTypeColor, getErrorColor,
  getAcceptColor, getAcceptEncodingColor, getCacheControlColor,
  getByoCdnColor, getLocationColor
} from './colors/index.js';

// Map log columns to facet column expressions and value transformations
const logColumnToFacet = {
  'response.status': { col: 'toString(`response.status`)', transform: (v) => String(v) },
  'request.method': { col: '`request.method`' },
  'request.host': { col: '`request.host`' },
  'request.url': { col: '`request.url`' },
  'cdn.cache_status': { col: 'upper(`cdn.cache_status`)', transform: (v) => String(v).toUpperCase() },
  'response.headers.content_type': { col: '`response.headers.content_type`' },
  'helix.request_type': { col: '`helix.request_type`' },
  'helix.backend_type': { col: '`helix.backend_type`' },
  'request.headers.x_forwarded_host': { col: '`request.headers.x_forwarded_host`' },
  'request.headers.referer': { col: '`request.headers.referer`' },
  'request.headers.user_agent': { col: '`request.headers.user_agent`' },
  'response.headers.x_error': { col: '`response.headers.x_error`' },
  'client.ip': { col: "if(`request.headers.x_forwarded_for` != '', `request.headers.x_forwarded_for`, `client.ip`)" },
  'request.headers.x_forwarded_for': { col: "if(`request.headers.x_forwarded_for` != '', `request.headers.x_forwarded_for`, `client.ip`)" },
};

// DOM elements (set by main.js)
let logsView = null;
let logsBtn = null;
let dashboardContent = null;

// Pagination state
const PAGE_SIZE = 500;
let logsOffset = 0;
let hasMoreLogs = true;
let loadingMore = false;

export function setLogsElements(view, btn, content) {
  logsView = view;
  logsBtn = btn;
  dashboardContent = content;

  // Set up scroll listener for infinite scroll on window
  window.addEventListener('scroll', handleLogsScroll);

  // Set up click handler for copying row data
  setupLogRowClickHandler();
}

function handleLogsScroll() {
  // Only handle scroll when logs view is visible
  if (!state.showLogs) return;

  const scrollHeight = document.documentElement.scrollHeight;
  const scrollTop = window.scrollY;
  const clientHeight = window.innerHeight;

  // Load more when scrolled to last 50%
  const scrollPercent = (scrollTop + clientHeight) / scrollHeight;
  if (scrollPercent > 0.5 && hasMoreLogs && !loadingMore && !state.logsLoading) {
    loadMoreLogs();
  }
}

// Register callback for pinned column changes
setOnPinnedColumnsChange(renderLogsTable);

export function toggleLogsView(saveStateToURL) {
  state.showLogs = !state.showLogs;
  if (state.showLogs) {
    logsView.classList.add('visible');
    dashboardContent.classList.add('hidden');
    logsBtn.classList.add('active');
    logsBtn.textContent = 'Filters';
  } else {
    logsView.classList.remove('visible');
    dashboardContent.classList.remove('hidden');
    logsBtn.classList.remove('active');
    logsBtn.textContent = 'Logs';
  }
  saveStateToURL();
}

export async function loadLogs() {
  if (state.logsLoading) return;
  state.logsLoading = true;
  state.logsReady = false;
  logsBtn.classList.remove('ready');

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
    logsBtn.classList.add('ready');
    // Check if there might be more data
    hasMoreLogs = result.data.length === PAGE_SIZE;
    logsOffset = result.data.length;
  } catch (err) {
    console.error('Logs error:', err);
    renderLogsError(err.message);
  } finally {
    state.logsLoading = false;
    container.classList.remove('updating');
  }
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
    console.error('Load more logs error:', err);
  } finally {
    loadingMore = false;
  }
}

export function renderLogsTable(data) {
  const container = logsView.querySelector('.logs-table-container');

  if (data.length === 0) {
    container.innerHTML = '<div class="empty" style="padding: 60px;">No logs matching current filters</div>';
    return;
  }

  // Get all column names from first row
  const allColumns = Object.keys(data[0]);

  // Columns that have color coding (in preferred display order)
  const colorCodedColumns = [
    'timestamp',
    'response.status',
    'request.method',
    'request.host',
    'request.url',
    'cdn.cache_status',
    'response.headers.content_type',
    'helix.request_type',
    'helix.backend_type',
    'request.headers.x_forwarded_host',
    'request.headers.referer',
    'request.headers.user_agent',
    'client.ip',
    'request.headers.x_forwarded_for',
    'response.headers.x_error',
    'request.headers.accept',
    'request.headers.accept_encoding',
    'request.headers.cache_control',
    'request.headers.x_byo_cdn_type',
    'response.headers.location',
  ];

  // Sort columns: pinned first, then color-coded, then the rest
  const pinned = state.pinnedColumns.filter(col => allColumns.includes(col));
  const colorCoded = colorCodedColumns.filter(col => allColumns.includes(col) && !pinned.includes(col));
  const rest = allColumns.filter(col => !pinned.includes(col) && !colorCodedColumns.includes(col));
  const columns = [...pinned, ...colorCoded, ...rest];

  // Calculate left offsets for sticky pinned columns
  const COL_WIDTH = 120;

  // Short names for columns to save space
  const shortNames = {
    'response.status': 'status',
    'request.method': 'method',
    'cdn.cache_status': 'cache',
    'helix.request_type': 'type',
    'helix.backend_type': 'backend',
  };

  let html = `
    <table class="logs-table">
      <thead>
        <tr>
          ${columns.map((col, idx) => {
            const isPinned = pinned.includes(col);
            const pinnedClass = isPinned ? 'pinned' : '';
            const leftOffset = isPinned ? `left: ${pinned.indexOf(col) * COL_WIDTH}px;` : '';
            const colEscaped = col.replace(/'/g, "\\'");
            const displayName = shortNames[col] || col;
            const titleAttr = shortNames[col] ? ` title="${escapeHtml(col)}"` : '';
            return `<th class="${pinnedClass}" style="${leftOffset}"${titleAttr} onclick="togglePinnedColumn('${colEscaped}')">${escapeHtml(displayName)}</th>`;
          }).join('')}
        </tr>
      </thead>
      <tbody>
  `;

  for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
    const row = data[rowIdx];
    html += `<tr data-row-idx="${rowIdx}">`;
    for (const col of columns) {
      let value = row[col];
      let cellClass = '';
      let displayValue = '';
      let colorIndicator = '';

      // Format specific columns
      if (col === 'timestamp' && value) {
        displayValue = new Date(value).toLocaleString();
        cellClass = 'timestamp';
      } else if (col === 'response.status' && value) {
        const status = parseInt(value);
        displayValue = String(status);
        if (status >= 500) cellClass = 'status-5xx';
        else if (status >= 400) cellClass = 'status-4xx';
        else cellClass = 'status-ok';
        const color = getStatusColor(status);
        if (color) colorIndicator = `<span class="log-color" style="background:${color}"></span>`;
      } else if (col === 'response.body_size' && value) {
        displayValue = formatBytes(parseInt(value));
      } else if (col === 'request.method') {
        displayValue = value || '';
        cellClass = 'method';
        const color = getMethodColor(value);
        if (color) colorIndicator = `<span class="log-color" style="background:${color}"></span>`;
      } else if (value === null || value === undefined || value === '') {
        displayValue = '';
      } else if (typeof value === 'object') {
        displayValue = JSON.stringify(value);
      } else {
        displayValue = String(value);
      }

      // Apply color coding based on column type
      if (!colorIndicator && value) {
        let color = '';
        if (col === 'request.host' || col === 'request.headers.x_forwarded_host') {
          color = getHostColor(value);
        } else if (col === 'response.headers.content_type') {
          color = getContentTypeColor(value);
        } else if (col === 'cdn.cache_status') {
          color = getCacheStatusColor(value);
        } else if (col === 'request.url') {
          color = getPathColor(value);
        } else if (col === 'request.headers.referer') {
          color = getRefererColor(value);
        } else if (col === 'request.headers.user_agent') {
          color = getUserAgentColor(value);
        } else if (col === 'client.ip' || col === 'request.headers.x_forwarded_for') {
          color = getIPColor(value);
        } else if (col === 'helix.request_type') {
          color = getRequestTypeColor(value);
        } else if (col === 'helix.backend_type') {
          color = getBackendTypeColor(value);
        } else if (col === 'response.headers.x_error') {
          color = getErrorColor(value);
        } else if (col === 'request.headers.accept') {
          color = getAcceptColor(value);
        } else if (col === 'request.headers.accept_encoding') {
          color = getAcceptEncodingColor(value);
        } else if (col === 'request.headers.cache_control') {
          color = getCacheControlColor(value);
        } else if (col === 'request.headers.x_byo_cdn_type') {
          color = getByoCdnColor(value);
        } else if (col === 'response.headers.location') {
          color = getLocationColor(value);
        }
        if (color) colorIndicator = `<span class="log-color" style="background:${color}"></span>`;
      }

      const isPinned = pinned.includes(col);
      if (isPinned) cellClass += ' pinned';
      const leftOffset = isPinned ? `left: ${pinned.indexOf(col) * COL_WIDTH}px;` : '';

      const escaped = escapeHtml(displayValue);

      // Add click handler for filterable columns with color indicators
      let clickHandler = '';
      const facetMapping = logColumnToFacet[col];
      if (colorIndicator && facetMapping && value) {
        const filterValue = facetMapping.transform ? facetMapping.transform(value) : String(value);
        const colEscaped = facetMapping.col.replace(/'/g, "\\'");
        const valEscaped = filterValue.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        clickHandler = ` onclick="addFilter('${colEscaped}', '${valEscaped}', false)"`;
        cellClass += ' clickable';
      }

      html += `<td class="${cellClass.trim()}" style="${leftOffset}" title="${escaped}"${clickHandler}>${colorIndicator}${escaped}</td>`;
    }
    html += '</tr>';
  }

  html += '</tbody></table>';
  container.innerHTML = html;

  // After render, measure actual column widths and update left offsets
  if (pinned.length > 0) {
    requestAnimationFrame(() => {
      const table = container.querySelector('.logs-table');
      if (!table) return;
      const headerCells = table.querySelectorAll('thead th');
      const pinnedWidths = [];
      let cumLeft = 0;

      // Calculate cumulative widths for pinned columns
      for (let i = 0; i < pinned.length; i++) {
        pinnedWidths.push(cumLeft);
        cumLeft += headerCells[i].offsetWidth;
      }

      // Update all pinned cells with correct left values
      headerCells.forEach((th, idx) => {
        if (idx < pinned.length) {
          th.style.left = pinnedWidths[idx] + 'px';
        }
      });

      const rows = table.querySelectorAll('tbody tr');
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        cells.forEach((td, idx) => {
          if (idx < pinned.length) {
            td.style.left = pinnedWidths[idx] + 'px';
          }
        });
      });
    });
  }
}

// Append rows to existing logs table (for infinite scroll)
function appendLogsRows(data) {
  const container = logsView.querySelector('.logs-table-container');
  const tbody = container.querySelector('.logs-table tbody');
  if (!tbody || data.length === 0) return;

  // Get columns from existing table header
  const headerCells = container.querySelectorAll('.logs-table thead th');
  const columns = Array.from(headerCells).map(th => th.title || th.textContent);

  // Map short names back to full names
  const shortToFull = {
    'status': 'response.status',
    'method': 'request.method',
    'cache': 'cdn.cache_status',
    'type': 'helix.request_type',
    'backend': 'helix.backend_type',
  };

  const fullColumns = columns.map(col => shortToFull[col] || col);
  const pinned = state.pinnedColumns.filter(col => fullColumns.includes(col));

  // Get starting index from existing rows
  const existingRows = tbody.querySelectorAll('tr').length;

  let html = '';
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowIdx = existingRows + i;
    html += `<tr data-row-idx="${rowIdx}">`;
    for (const col of fullColumns) {
      let value = row[col];
      let cellClass = '';
      let displayValue = '';
      let colorIndicator = '';

      // Format specific columns (same logic as renderLogsTable)
      if (col === 'timestamp' && value) {
        displayValue = new Date(value).toLocaleString();
        cellClass = 'timestamp';
      } else if (col === 'response.status' && value) {
        const status = parseInt(value);
        displayValue = String(status);
        if (status >= 500) cellClass = 'status-5xx';
        else if (status >= 400) cellClass = 'status-4xx';
        else cellClass = 'status-ok';
        const color = getStatusColor(status);
        if (color) colorIndicator = `<span class="log-color" style="background:${color}"></span>`;
      } else if (col === 'response.body_size' && value) {
        displayValue = formatBytes(parseInt(value));
      } else if (col === 'request.method') {
        displayValue = value || '';
        cellClass = 'method';
        const color = getMethodColor(value);
        if (color) colorIndicator = `<span class="log-color" style="background:${color}"></span>`;
      } else if (value === null || value === undefined || value === '') {
        displayValue = '';
      } else if (typeof value === 'object') {
        displayValue = JSON.stringify(value);
      } else {
        displayValue = String(value);
      }

      // Apply color coding based on column type
      if (!colorIndicator && value) {
        let color = '';
        if (col === 'request.host' || col === 'request.headers.x_forwarded_host') {
          color = getHostColor(value);
        } else if (col === 'response.headers.content_type') {
          color = getContentTypeColor(value);
        } else if (col === 'cdn.cache_status') {
          color = getCacheStatusColor(value);
        } else if (col === 'request.url') {
          color = getPathColor(value);
        } else if (col === 'request.headers.referer') {
          color = getRefererColor(value);
        } else if (col === 'request.headers.user_agent') {
          color = getUserAgentColor(value);
        } else if (col === 'client.ip' || col === 'request.headers.x_forwarded_for') {
          color = getIPColor(value);
        } else if (col === 'helix.request_type') {
          color = getRequestTypeColor(value);
        } else if (col === 'helix.backend_type') {
          color = getBackendTypeColor(value);
        } else if (col === 'response.headers.x_error') {
          color = getErrorColor(value);
        } else if (col === 'request.headers.accept') {
          color = getAcceptColor(value);
        } else if (col === 'request.headers.accept_encoding') {
          color = getAcceptEncodingColor(value);
        } else if (col === 'request.headers.cache_control') {
          color = getCacheControlColor(value);
        } else if (col === 'request.headers.x_byo_cdn_type') {
          color = getByoCdnColor(value);
        } else if (col === 'response.headers.location') {
          color = getLocationColor(value);
        }
        if (color) colorIndicator = `<span class="log-color" style="background:${color}"></span>`;
      }

      const isPinned = pinned.includes(col);
      if (isPinned) cellClass += ' pinned';

      const escaped = escapeHtml(displayValue);

      // Add click handler for filterable columns with color indicators
      let clickHandler = '';
      const facetMapping = logColumnToFacet[col];
      if (colorIndicator && facetMapping && value) {
        const filterValue = facetMapping.transform ? facetMapping.transform(value) : String(value);
        const colEscaped = facetMapping.col.replace(/'/g, "\\'");
        const valEscaped = filterValue.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        clickHandler = ` onclick="addFilter('${colEscaped}', '${valEscaped}', false)"`;
        cellClass += ' clickable';
      }

      html += `<td class="${cellClass.trim()}" title="${escaped}"${clickHandler}>${colorIndicator}${escaped}</td>`;
    }
    html += '</tr>';
  }

  tbody.insertAdjacentHTML('beforeend', html);

  // Update pinned column positions for new rows
  if (pinned.length > 0) {
    requestAnimationFrame(() => {
      const headerCells = container.querySelectorAll('.logs-table thead th');
      const pinnedWidths = [];
      let cumLeft = 0;
      for (let i = 0; i < pinned.length; i++) {
        pinnedWidths.push(cumLeft);
        cumLeft += headerCells[i].offsetWidth;
      }
      const rows = tbody.querySelectorAll('tr');
      rows.forEach(row => {
        const cells = row.querySelectorAll('td.pinned');
        cells.forEach((td, idx) => {
          if (idx < pinnedWidths.length) {
            td.style.left = pinnedWidths[idx] + 'px';
          }
        });
      });
    });
  }
}

function renderLogsError(message) {
  const container = logsView.querySelector('.logs-table-container');
  container.innerHTML = `<div class="empty" style="padding: 60px;">Error loading logs: ${escapeHtml(message)}</div>`;
}

// Copy row data as JSON when clicking on row background
export function copyLogRow(rowIdx) {
  const row = state.logsData[rowIdx];
  if (!row) return;

  // Convert flat dot notation to nested object
  const nested = {};
  for (const [key, value] of Object.entries(row)) {
    // Skip empty values
    if (value === null || value === undefined || value === '') continue;

    const parts = key.split('.');
    let current = nested;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  }

  const json = JSON.stringify(nested, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    // Brief visual feedback
    showCopyFeedback();
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}

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

// Set up click handler for row background clicks
export function setupLogRowClickHandler() {
  const container = logsView?.querySelector('.logs-table-container');
  if (!container) return;

  container.addEventListener('click', (e) => {
    // Only handle clicks directly on td or tr (not on links, buttons, or spans)
    const target = e.target;
    if (target.tagName !== 'TD' && target.tagName !== 'TR') return;

    // Don't copy if clicking on a clickable cell (filter action)
    if (target.classList.contains('clickable')) return;

    // Find the row
    const row = target.closest('tr');
    if (!row || !row.dataset.rowIdx) return;

    const rowIdx = parseInt(row.dataset.rowIdx);
    copyLogRow(rowIdx);
  });
}
