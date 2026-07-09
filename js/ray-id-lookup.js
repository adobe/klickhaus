/*
 * Copyright 2026 Adobe. All rights reserved.
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
import { query } from './api.js';
import { loadSql } from './sql-loader.js';
import { escapeHtml } from './utils.js';
import { state } from './state.js';

/**
 * ray_id joins two tables in opposite directions depending on which dashboard is
 * open. Each side lists only the fields not already visible on the *other* side's
 * row (e.g. request.method/url are redundant when resolving from `da`, since the
 * access-log row already shows them).
 */
const RESOLVE_TARGETS = {
  da_worker_logs: {
    sqlTemplate: 'ray-id-lookup',
    label: 'CDN access log (da)',
    fields: [
      { key: 'request.host', label: 'Host' },
      { key: 'request.url', label: 'URL' },
      { key: 'request.method', label: 'Method' },
      { key: 'response.status', label: 'Status' },
      { key: 'cdn.script_name', label: 'Worker' },
      { key: 'cdn.time_elapsed_msec', label: 'Elapsed (ms)' },
      { key: 'response.headers.x_error', label: 'Error' },
    ],
  },
  da: {
    sqlTemplate: 'ray-id-lookup-worker',
    label: 'worker log (da_worker_logs)',
    fields: [
      { key: 'script_name', label: 'Worker' },
      { key: 'outcome', label: 'Outcome' },
      { key: 'response.status', label: 'Status' },
      { key: 'cpu_ms', label: 'CPU (ms)' },
      { key: 'wall_ms', label: 'Wall (ms)' },
      { key: 'logs', label: 'Logs' },
      { key: 'exceptions', label: 'Exceptions' },
    ],
  },
};

function getResolveTarget() {
  return RESOLVE_TARGETS[state.tableName];
}

/**
 * "0" marks an internal service-binding call (da-collab -> da-admin, etc.) that never
 * appears in the `da` CDN access-log table, so it's never worth offering to resolve it.
 * @param {string} col
 * @param {unknown} value
 * @returns {boolean}
 */
export function shouldShowResolveButton(col, value) {
  return col === 'ray_id' && !!value && value !== '0' && !!getResolveTarget();
}

/**
 * Build the "resolve" button HTML shown next to a ray_id value in the log detail modal.
 * @param {string} rayId
 * @returns {string}
 */
export function buildResolveButtonHtml(rayId) {
  const target = getResolveTarget();
  const title = target ? `Find the matching ${target.label}` : 'Find the matching row';
  return ' <button type="button" class="detail-filter-btn" data-action="resolve-ray-id" '
    + `data-value="${escapeHtml(rayId)}" title="${escapeHtml(title)}">resolve</button>`;
}

const RESULT_ROW_ID = 'rayIdResolveResult';

function formatFieldValue(value) {
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' | ');
  }
  if (value === undefined || value === null || value === '') {
    return '';
  }
  return String(value);
}

function defaultFieldsFromRow(row) {
  return Object.keys(row).filter((key) => key !== 'timestamp').map((key) => ({ key, label: key }));
}

/**
 * Render the matched rows from the other table (or an empty-state message) as a
 * tbody to append after the ray_id row in the log detail table.
 * @param {Array<Object>} rows
 * @returns {string}
 */
export function renderRayIdResultHtml(rows) {
  const target = getResolveTarget();
  const label = target ? target.label : 'row';

  if (!rows || rows.length === 0) {
    return `<tbody class="log-detail-group" id="${RESULT_ROW_ID}">`
      + `<tr><td colspan="2" class="empty-value">No matching ${escapeHtml(label)} found</td></tr>`
      + '</tbody>';
  }

  const fields = target ? target.fields : defaultFieldsFromRow(rows[0]);
  const headerHtml = ['Time', ...fields.map((f) => f.label)]
    .map((h) => `<th>${escapeHtml(h)}</th>`).join('');

  const bodyRowsHtml = rows.map((row) => {
    const cells = [
      new Date(row.timestamp).toLocaleString(),
      ...fields.map((f) => formatFieldValue(row[f.key])),
    ].map((v) => `<td>${escapeHtml(v)}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return `<tbody class="log-detail-group" id="${RESULT_ROW_ID}">`
    + `<tr><td colspan="2" class="log-detail-group-title">Matched ${escapeHtml(label)}</td></tr>`
    + '<tr><td colspan="2"><table class="ray-id-result-table">'
    + `<thead><tr>${headerHtml}</tr></thead><tbody>${bodyRowsHtml}</tbody></table></td></tr>`
    + '</tbody>';
}

function renderLoadingHtml() {
  return `<tbody class="log-detail-group" id="${RESULT_ROW_ID}">`
    + '<tr><td colspan="2">Resolving…</td></tr></tbody>';
}

function renderErrorHtml(message) {
  return `<tbody class="log-detail-group" id="${RESULT_ROW_ID}">`
    + `<tr><td colspan="2" class="empty-value">Lookup failed: ${escapeHtml(message)}</td></tr></tbody>`;
}

async function resolveRayId(rayId) {
  const target = getResolveTarget();
  const escaped = rayId.replace(/'/g, "''");
  const sql = await loadSql(target.sqlTemplate, { database: DATABASE, rayId: escaped });
  const result = await query(sql);
  return result.data;
}

/**
 * Wire up the "resolve" button inside the log detail modal: on click, query the
 * other ray_id-joinable table (da <-> da_worker_logs, per state.tableName) for rows
 * matching the clicked ray_id and append the result inline.
 * @param {HTMLElement} modal - the #logDetailModal dialog element
 */
export function initRayIdLookup(modal) {
  modal.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="resolve-ray-id"]');
    if (!btn) { return; }

    const table = document.getElementById('logDetailTable');
    if (!table) { return; }

    document.getElementById(RESULT_ROW_ID)?.remove();
    table.insertAdjacentHTML('beforeend', renderLoadingHtml());

    try {
      const rows = await resolveRayId(btn.dataset.value);
      document.getElementById(RESULT_ROW_ID)?.remove();
      table.insertAdjacentHTML('beforeend', renderRayIdResultHtml(rows));
    } catch (err) {
      document.getElementById(RESULT_ROW_ID)?.remove();
      table.insertAdjacentHTML('beforeend', renderErrorHtml(err.message || String(err)));
    }
  });
}
