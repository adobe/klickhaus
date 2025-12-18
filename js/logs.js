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
  getIPColor, getRequestTypeColor, getBackendTypeColor, getErrorColor
} from './colors/index.js';

// DOM elements (set by main.js)
let logsView = null;
let logsBtn = null;
let dashboardContent = null;

export function setLogsElements(view, btn, content) {
  logsView = view;
  logsBtn = btn;
  dashboardContent = content;
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

  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const facetFilters = getFacetFilters();

  const sql = `
    SELECT *
    FROM ${DATABASE}.${getTable()}
    WHERE ${timeFilter} ${hostFilter} ${facetFilters}
    ORDER BY timestamp DESC
    LIMIT 100
  `;

  try {
    const result = await query(sql);
    state.logsData = result.data;
    renderLogsTable(result.data);
    state.logsReady = true;
    logsBtn.classList.add('ready');
  } catch (err) {
    console.error('Logs error:', err);
    renderLogsError(err.message);
  } finally {
    state.logsLoading = false;
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

  for (const row of data) {
    html += '<tr>';
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
        }
        if (color) colorIndicator = `<span class="log-color" style="background:${color}"></span>`;
      }

      const isPinned = pinned.includes(col);
      if (isPinned) cellClass += ' pinned';
      const leftOffset = isPinned ? `left: ${pinned.indexOf(col) * COL_WIDTH}px;` : '';

      const escaped = escapeHtml(displayValue);
      html += `<td class="${cellClass.trim()}" style="${leftOffset}" title="${escaped}">${colorIndicator}${escaped}</td>`;
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

function renderLogsError(message) {
  const container = logsView.querySelector('.logs-table-container');
  container.innerHTML = `<div class="empty" style="padding: 60px;">Error loading logs: ${escapeHtml(message)}</div>`;
}
