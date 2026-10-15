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
 * Format a single value for a TSV cell. Tabs and line breaks are replaced by
 * spaces so every row stays on one line when pasted into a spreadsheet.
 * @param {unknown} value
 * @returns {string}
 */
function tsvCell(value) {
  if (value === null || value === undefined) { return ''; }
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return str.replace(/[\t\r\n]+/g, ' ');
}

/**
 * Serialize log rows (flat dot-notation objects) to TSV text with a header row.
 * @param {Object[]} rows
 * @returns {string}
 */
export function rowsToTsv(rows) {
  const columns = orderExportColumns(Object.keys(rows[0]));
  const lines = [columns.map(tsvCell).join('\t')];
  for (const row of rows) {
    lines.push(columns.map((col) => tsvCell(row[col])).join('\t'));
  }
  return lines.join('\n');
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
 * Supported export formats, in menu order. TSV comes first: it pastes straight
 * into spreadsheet columns.
 */
const FORMATS = {
  tsv: { serialize: (rows) => rowsToTsv(rows), mimeType: 'text/tab-separated-values' },
  csv: { serialize: (rows) => rowsToCsv(rows), mimeType: 'text/csv' },
  json: { serialize: (rows) => rowsToJson(rows), mimeType: 'application/json' },
};

/**
 * Serialize the loaded log rows, or report that there is nothing to export.
 * @param {'tsv'|'csv'|'json'} format
 * @returns {string|null}
 */
function serializeLoadedRows(format) {
  const rows = state.logsData;
  if (!rows || rows.length === 0) {
    showExportFeedback('No logs to export — open the Logs view first');
    return null;
  }
  return FORMATS[format].serialize(rows);
}

function rowCountLabel() {
  const n = state.logsData.length;
  return `${n.toLocaleString()} row${n === 1 ? '' : 's'}`;
}

/**
 * Download the currently loaded log rows (state.logsData) as TSV, CSV or JSON.
 * @param {'tsv'|'csv'|'json'} format
 */
export function exportLogs(format) {
  const content = serializeLoadedRows(format);
  if (content === null) { return; }
  downloadFile(buildFilename(format), content, FORMATS[format].mimeType);
  showExportFeedback(`Exported ${rowCountLabel()} as ${format.toUpperCase()}`);
}

/**
 * Copy the currently loaded log rows to the clipboard as TSV, CSV or JSON.
 * @param {'tsv'|'csv'|'json'} format
 * @returns {Promise<void>}
 */
export async function copyLogs(format) {
  const content = serializeLoadedRows(format);
  if (content === null) { return; }
  try {
    await navigator.clipboard.writeText(content);
    showExportFeedback(`Copied ${rowCountLabel()} as ${format.toUpperCase()}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to copy logs:', err);
    showExportFeedback('Copy failed — try Download instead');
  }
}

let exportMenu = null;
let exportMenuListeners = null;

export function closeExportMenu() {
  if (!exportMenu) { return; }
  exportMenu.anchor.setAttribute('aria-expanded', 'false');
  exportMenu.remove();
  exportMenu = null;
  exportMenuListeners.abort();
  exportMenuListeners = null;
}

function listenForMenuDismiss() {
  exportMenuListeners = new AbortController();
  const { signal } = exportMenuListeners;
  document.addEventListener('mousedown', (event) => {
    if (!exportMenu.contains(event.target) && !exportMenu.anchor.contains(event.target)) {
      closeExportMenu();
    }
  }, { capture: true, signal });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') { return; }
    event.stopPropagation();
    const { anchor } = exportMenu;
    closeExportMenu();
    anchor.focus();
  }, { capture: true, signal });
}

function menuItem(label, onSelect) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'menu-item';
  item.setAttribute('role', 'menuitem');
  item.textContent = label;
  item.addEventListener('click', (event) => {
    event.stopPropagation();
    closeExportMenu();
    onSelect();
  });
  return item;
}

/**
 * Toggle a format menu (TSV / CSV / JSON) below the Copy or Download button.
 * @param {'copy'|'download'} action
 * @param {HTMLElement} anchor - the clicked toolbar button
 */
export function openExportMenu(action, anchor) {
  const wasOpenForAnchor = exportMenu?.anchor === anchor;
  closeExportMenu();
  if (wasOpenForAnchor) { return; }

  const run = action === 'copy' ? copyLogs : exportLogs;
  exportMenu = document.createElement('div');
  exportMenu.className = 'logs-export-menu';
  exportMenu.setAttribute('role', 'menu');
  exportMenu.setAttribute('aria-label', action === 'copy' ? 'Copy as' : 'Download as');
  exportMenu.anchor = anchor;
  exportMenu.append(...Object.keys(FORMATS).map(
    (format) => menuItem(format.toUpperCase(), () => run(format)),
  ));
  document.body.appendChild(exportMenu);
  anchor.setAttribute('aria-expanded', 'true');

  const rect = anchor.getBoundingClientRect();
  exportMenu.style.top = `${rect.bottom + 4}px`;
  exportMenu.style.right = `${document.documentElement.clientWidth - rect.right}px`;

  listenForMenuDismiss();
  exportMenu.querySelector('.menu-item').focus();
}
