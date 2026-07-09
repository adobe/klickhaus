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

/**
 * "0" marks an internal service-binding call (da-collab -> da-admin, etc.) that never
 * appears in the `da` CDN access-log table, so it's never worth offering to resolve it.
 * @param {string} col
 * @param {unknown} value
 * @returns {boolean}
 */
export function shouldShowResolveButton(col, value) {
  return col === 'ray_id' && !!value && value !== '0';
}

/**
 * Build the "resolve" button HTML shown next to a ray_id value in the log detail modal.
 * @param {string} rayId
 * @returns {string}
 */
export function buildResolveButtonHtml(rayId) {
  return ' <button type="button" class="detail-filter-btn" data-action="resolve-ray-id" '
    + `data-value="${escapeHtml(rayId)}" title="Find the matching CDN access log">resolve</button>`;
}

const RESULT_ROW_ID = 'rayIdResolveResult';

/**
 * Render the matched `da` rows (or an empty-state message) as a tbody to append
 * after the ray_id row in the log detail table.
 * @param {Array<Object>} rows
 * @returns {string}
 */
export function renderRayIdResultHtml(rows) {
  if (!rows || rows.length === 0) {
    return `<tbody class="log-detail-group" id="${RESULT_ROW_ID}">`
      + '<tr><td colspan="2" class="empty-value">No matching CDN access log found</td></tr>'
      + '</tbody>';
  }

  const rowsHtml = rows.map((row) => {
    const fields = [
      new Date(row.timestamp).toLocaleString(),
      row['request.method'],
      row['request.host'],
      row['request.url'],
      row['response.status'],
      row['cdn.cache_status'],
      row['cdn.script_name'],
    ].filter((v) => v !== undefined && v !== null && v !== '');
    return `<tr><td colspan="2">${escapeHtml(fields.join(' · '))}</td></tr>`;
  }).join('');

  return `<tbody class="log-detail-group" id="${RESULT_ROW_ID}">`
    + '<tr><td colspan="2" class="log-detail-group-title">Matched CDN access log (da)</td></tr>'
    + `${rowsHtml}</tbody>`;
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
  const escaped = rayId.replace(/'/g, "''");
  const sql = await loadSql('ray-id-lookup', { database: DATABASE, rayId: escaped });
  const result = await query(sql);
  return result.data;
}

/**
 * Wire up the "resolve" button inside the log detail modal: on click, query the `da`
 * table for rows matching the clicked ray_id and append the result inline.
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
