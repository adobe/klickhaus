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

/**
 * Format timestamp - short format on mobile.
 * @param {string} value
 * @returns {string}
 */
function formatTimestamp(value) {
  const date = new Date(value);
  const isMobile = window.innerWidth < 600;
  if (isMobile) {
    return date.toLocaleTimeString();
  }
  return date.toLocaleString();
}

/**
 * Format a log cell for display and color.
 * @param {string} col
 * @param {unknown} value
 * @returns {{ displayValue: string, cellClass: string, colorIndicator: string }}
 */
export function formatLogCell(col, value) {
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
