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
import { state } from './state.js';
import { getLogsTable } from './time.js';
import { LOG_COLUMN_ORDER } from './columns.js';

/**
 * Show a brief toast in the bottom-center of the screen.
 * @param {string} message
 */
function showExportFeedback(message) {
  let feedback = document.getElementById('export-feedback');
  if (!feedback) {
    feedback = document.createElement('div');
    feedback.id = 'export-feedback';
    feedback.classList.add('copy-feedback');
    document.body.appendChild(feedback);
  }
  feedback.textContent = message;
  feedback.style.opacity = '1';
  setTimeout(() => {
    feedback.style.opacity = '0';
  }, 1500);
}

/**
 * Order columns for export: pinned first, then the display order, then any
 * remaining columns (including ones hidden in the table — an export stays
 * lossless). Mirrors the table ordering in js/logs.js getLogColumns, but keeps
 * hidden columns instead of dropping them.
 * @param {string[]} allColumns
 * @returns {string[]}
 */
function orderExportColumns(allColumns) {
  const pinned = state.pinnedColumns.filter((col) => allColumns.includes(col));
  const columnOrder = state.userLogColumnOrder ?? state.logColumnOrder ?? LOG_COLUMN_ORDER;
  const ordered = columnOrder
    .filter((col) => allColumns.includes(col) && !pinned.includes(col));
  const rest = allColumns.filter((col) => !pinned.includes(col) && !ordered.includes(col));
  return [...pinned, ...ordered, ...rest];
}

/**
 * Format a single value for a CSV cell, quoting/escaping per RFC 4180.
 * @param {unknown} value
 * @returns {string}
 */
function csvCell(value) {
  if (value === null || value === undefined) { return ''; }
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialize log rows (flat dot-notation objects) to CSV text with a header row.
 * @param {Object[]} rows
 * @returns {string}
 */
export function rowsToCsv(rows) {
  const columns = orderExportColumns(Object.keys(rows[0]));
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((col) => csvCell(row[col])).join(','));
  }
  return lines.join('\r\n');
}

/**
 * Convert a flat dot-notation row into a nested object, skipping empty values.
 * Matches the shape produced by the single-row "copy as JSON" action.
 * @param {Object} row
 * @returns {Object}
 */
function nestRow(row) {
  const nested = {};
  for (const [key, value] of Object.entries(row)) {
    // Skip empty values, matching the single-row "copy as JSON" action.
    if (value !== null && value !== undefined && value !== '') {
      const parts = key.split('.');
      let current = nested;
      for (let i = 0; i < parts.length - 1; i += 1) {
        if (!current[parts[i]]) { current[parts[i]] = {}; }
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = value;
    }
  }
  return nested;
}

/**
 * Serialize log rows to a pretty-printed JSON array of nested objects.
 * @param {Object[]} rows
 * @returns {string}
 */
export function rowsToJson(rows) {
  return JSON.stringify(rows.map(nestRow), null, 2);
}

/**
 * Trigger a browser download of the given text content.
 * @param {string} filename
 * @param {string} content
 * @param {string} mimeType
 */
function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Build a filename like "delivery-logs-2026-08-28T14-30-05.csv".
 * @param {string} extension
 * @returns {string}
 */
function buildFilename(extension) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  return `${getLogsTable()}-logs-${stamp}.${extension}`;
}

/**
 * Export the currently loaded log rows (state.logsData) as CSV or JSON.
 * @param {'csv'|'json'} format
 */
export function exportLogs(format) {
  const rows = state.logsData;
  if (!rows || rows.length === 0) {
    showExportFeedback('No logs to export — open the Logs view first');
    return;
  }

  if (format === 'json') {
    downloadFile(buildFilename('json'), rowsToJson(rows), 'application/json');
  } else {
    downloadFile(buildFilename('csv'), rowsToCsv(rows), 'text/csv');
  }

  const count = rows.length.toLocaleString();
  showExportFeedback(`Exported ${count} row${rows.length === 1 ? '' : 's'} as ${format.toUpperCase()}`);
}
