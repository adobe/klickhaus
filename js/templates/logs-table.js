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
import { escapeHtml } from '../utils.js';
import { formatBytes } from '../format.js';
import { getColorForColumn } from '../colors/index.js';
import { LOG_COLUMN_SHORT_LABELS, LOG_COLUMN_TO_FACET } from '../columns.js';
import { parseUTC } from '../chart-state.js';

/**
 * Format timestamp - short format on mobile.
 */
function formatTimestamp(value) {
  const date = new Date(value);
  return window.innerWidth < 600 ? date.toLocaleTimeString() : date.toLocaleString();
}

/**
 * Format status column
 */
function formatStatusCell(value) {
  const status = parseInt(value, 10);
  let cellClass = 'status-ok';
  if (status >= 500) cellClass = 'status-5xx';
  else if (status >= 400) cellClass = 'status-4xx';
  return { displayValue: String(status), cellClass };
}

/**
 * Format generic value
 */
function formatGenericValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Format a log cell for display and color.
 */
export function formatLogCell(col, value) {
  let cellClass = '';
  let displayValue = '';

  if (col === 'timestamp' && value) {
    displayValue = formatTimestamp(value);
    cellClass = 'timestamp';
  } else if (col === 'response.status' && value) {
    const result = formatStatusCell(value);
    displayValue = result.displayValue;
    cellClass = result.cellClass;
  } else if (col === 'response.body_size' && value) {
    displayValue = formatBytes(parseInt(value, 10));
  } else if (col === 'request.method') {
    displayValue = value || '';
    cellClass = 'method';
  } else {
    displayValue = formatGenericValue(value);
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
export function buildLogCellHtml({
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
export function buildLogRowHtml({
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
 * Build the full logs table header HTML.
 * @param {string[]} columns
 * @param {string[]} pinned
 * @param {Record<string, number>} pinnedOffsets
 * @returns {string}
 */
export function buildLogTableHeaderHtml(columns, pinned, pinnedOffsets) {
  return columns.map((col) => {
    const isPinned = pinned.includes(col);
    const pinnedClass = isPinned ? 'pinned' : '';
    const leftOffset = isPinned ? `left: ${pinnedOffsets[col]}px;` : '';
    const displayName = LOG_COLUMN_SHORT_LABELS[col] || col;
    const titleAttr = LOG_COLUMN_SHORT_LABELS[col] ? ` title="${escapeHtml(col)}"` : '';
    const actionAttrs = ` data-action="toggle-pinned-column" data-col="${escapeHtml(col)}"`;
    return `<th class="${pinnedClass}" style="${leftOffset}"${titleAttr}${actionAttrs}>${escapeHtml(displayName)}</th>`;
  }).join('');
}

/**
 * Format a duration between two timestamps for display.
 * @param {string} gapStart - Newest boundary timestamp (e.g. '2026-02-12 10:00:00.000')
 * @param {string} gapEnd - Oldest boundary timestamp (e.g. '2026-02-12 06:00:00.000')
 * @returns {string} Human-readable duration like "4h" or "30m"
 */
function formatGapDuration(gapStart, gapEnd) {
  const startMs = parseUTC(gapStart).getTime();
  const endMs = parseUTC(gapEnd).getTime();
  const diffMs = Math.abs(startMs - endMs);
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d`;
}

/**
 * Format a timestamp for display in gap label (time only, no date).
 * @param {string} ts - Timestamp string like '2026-02-12 10:00:00.000'
 * @returns {string} Time like "10:00"
 */
function formatGapTime(ts) {
  const d = parseUTC(ts);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Format a number with locale-aware thousands separators.
 * @param {number} num
 * @returns {string}
 */
function formatCount(num) {
  return num.toLocaleString();
}

/**
 * Build HTML for a gap row placeholder.
 * @param {Object} params
 * @param {Object} params.gap - Gap row object with gapStart, gapEnd, gapLoading, gapCount
 * @param {number} params.rowIdx - Index in state.logsData
 * @param {number} params.colCount - Number of columns for colspan
 * @returns {string}
 */
export function buildGapRowHtml({ gap, rowIdx, colCount }) {
  const duration = formatGapDuration(gap.gapStart, gap.gapEnd);
  const startTime = formatGapTime(gap.gapStart);
  const endTime = formatGapTime(gap.gapEnd);
  const timeRange = `${startTime}\u2013${endTime}`;
  const loadingClass = gap.gapLoading ? ' loading' : '';

  let labelText;
  if (gap.gapLoading) {
    labelText = `Loading ${timeRange} (${duration})\u2026`;
  } else if (gap.gapCount !== undefined && gap.gapCount > 0) {
    labelText = `\u2026 ${formatCount(gap.gapCount)} more entries (${duration})`;
  } else {
    labelText = `\u2026 ${duration} of logs (${timeRange})`;
  }

  const iconHtml = gap.gapLoading
    ? '<span class="logs-gap-spinner"></span>'
    : '<span class="logs-gap-icon">\u2193</span>';

  return `<tr class="logs-gap-row${loadingClass}" data-row-idx="${rowIdx}" data-gap="true">
  <td colspan="${colCount}" class="logs-gap-cell">
    <button class="logs-gap-button" data-action="load-gap" data-gap-idx="${rowIdx}">
      ${iconHtml}<span class="logs-gap-label">${escapeHtml(labelText)}</span>
    </button>
  </td>
</tr>`;
}
