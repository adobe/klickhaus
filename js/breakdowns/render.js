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
import { escapeHtml, isSyntheticBucket } from '../utils.js';
import { formatNumber, formatQueryTime, formatBytes } from '../format.js';
import { state } from '../state.js';
import { TOP_N_OPTIONS } from '../constants.js';
import { buildBreakdownRow, buildOtherRow } from '../templates/breakdown-table.js';

// Get filters for a specific column
export function getFiltersForColumn(col) {
  return state.filters.filter((f) => f.col === col);
}

// Get next topN value for "show more" functionality
export function getNextTopN() {
  const currentIdx = TOP_N_OPTIONS.indexOf(state.topN);
  if (currentIdx === -1 || currentIdx >= TOP_N_OPTIONS.length - 1) return null;
  return TOP_N_OPTIONS[currentIdx + 1];
}

/**
 * Get speed class based on elapsed time (aligned with Google LCP thresholds)
 */
function getSpeedClass(elapsed) {
  if (elapsed < 2500) return 'fast';
  if (elapsed < 4000) return 'medium';
  return 'slow';
}

/**
 * Build header elements HTML for facet card
 */
function buildHeaderElements(id, elapsed, modeToggle, isBytes, summaryRatio, summaryLabel, summaryColor) {
  const speedClass = getSpeedClass(elapsed);
  const speedTitle = formatQueryTime(elapsed);
  const isPinned = state.pinnedFacets.includes(id);
  const pinTitle = isPinned ? 'Unpin facet' : 'Pin facet to top';

  const speedIndicator = `<span class="speed-indicator ${speedClass}" title="${speedTitle} - ${pinTitle}" `
    + `data-action="toggle-facet-pin" data-facet="${escapeHtml(id)}" role="button"></span>`;

  const modeToggleHtml = modeToggle
    ? `<button class="mode-toggle${isBytes ? ' active' : ''}" data-action="toggle-facet-mode" `
      + `data-mode="${escapeHtml(modeToggle)}" title="Toggle between request count and bytes">`
      + `${isBytes ? 'B' : '#'}</button>`
    : '';

  const copyBtnHtml = '<button class="copy-facet-btn" data-action="copy-facet-tsv" '
    + `data-facet="${escapeHtml(id)}" title="Copy data as TSV">copy</button>`;

  const summaryColorClass = summaryColor ? ` summary-${summaryColor}` : '';
  const summaryHtml = (summaryRatio !== null && summaryLabel)
    ? `<span class="summary-metric${summaryColorClass}" `
      + `title="${(summaryRatio * 100).toFixed(1)}% ${summaryLabel}">${Math.round(summaryRatio * 100)}%</span>`
    : '';

  return {
    speedIndicator, modeToggleHtml, copyBtnHtml, summaryHtml,
  };
}

/**
 * Store facet data on card element for copy functionality
 */
function storeFacetData(card, title, data, totals, isBytes) {
  const el = card;
  el.dataset.facetData = JSON.stringify({
    title,
    data: data.map((row) => ({
      dim: row.dim || '(empty)',
      cnt: parseInt(row.cnt, 10),
      cnt_ok: parseInt(row.cnt_ok, 10) || 0,
      cnt_4xx: parseInt(row.cnt_4xx, 10) || 0,
      cnt_5xx: parseInt(row.cnt_5xx, 10) || 0,
    })),
    totals: totals ? {
      cnt: parseInt(totals.cnt, 10),
      cnt_ok: parseInt(totals.cnt_ok, 10) || 0,
      cnt_4xx: parseInt(totals.cnt_4xx, 10) || 0,
      cnt_5xx: parseInt(totals.cnt_5xx, 10) || 0,
    } : null,
    mode: isBytes ? 'bytes' : 'count',
  });
}

/**
 * Calculate "Other" row from totals minus top-K sum
 */
function calculateOtherRow(data, totals) {
  if (!totals) return null;
  const topKSum = {
    cnt: data.reduce((sum, d) => sum + parseInt(d.cnt, 10), 0),
    cnt_ok: data.reduce((sum, d) => sum + (parseInt(d.cnt_ok, 10) || 0), 0),
    cnt_4xx: data.reduce((sum, d) => sum + (parseInt(d.cnt_4xx, 10) || 0), 0),
    cnt_5xx: data.reduce((sum, d) => sum + (parseInt(d.cnt_5xx, 10) || 0), 0),
  };
  return {
    cnt: parseInt(totals.cnt, 10) - topKSum.cnt,
    cnt_ok: (parseInt(totals.cnt_ok, 10) || 0) - topKSum.cnt_ok,
    cnt_4xx: (parseInt(totals.cnt_4xx, 10) || 0) - topKSum.cnt_4xx,
    cnt_5xx: (parseInt(totals.cnt_5xx, 10) || 0) - topKSum.cnt_5xx,
  };
}

export function renderBreakdownTable(
  id,
  data,
  totals,
  col,
  linkPrefix,
  linkSuffix,
  linkFn,
  elapsed,
  dimPrefixes,
  dimFormatFn,
  summaryRatio,
  summaryLabel,
  summaryColor,
  modeToggle,
  isContinuous,
  filterCol,
  filterValueFn,
  filterOp,
) {
  const card = document.getElementById(id);
  if (!card.dataset.title) card.dataset.title = card.querySelector('h3').textContent;
  const { title } = card.dataset;

  const columnFilters = getFiltersForColumn(col);
  const hasFilters = columnFilters.length > 0;
  const mode = modeToggle ? state[modeToggle] : 'count';
  const isBytes = mode === 'bytes';
  const valueFormatter = isBytes ? formatBytes : formatNumber;

  const headerParts = buildHeaderElements(
    id,
    elapsed,
    modeToggle,
    isBytes,
    summaryRatio,
    summaryLabel,
    summaryColor,
  );
  const {
    speedIndicator, modeToggleHtml, copyBtnHtml, summaryHtml,
  } = headerParts;

  if (data.length === 0) {
    let html = `<h3>${speedIndicator}${title}${modeToggleHtml}${summaryHtml}`;
    if (hasFilters) {
      html += ` <button class="clear-facet-btn" data-action="clear-facet" data-col="${escapeHtml(col)}">Clear</button>`;
    }
    html += '</h3><div class="empty">No data</div>';
    html += '<button class="facet-hide-btn" data-action="toggle-facet-hide" '
      + `data-facet="${escapeHtml(id)}" title="Hide facet"></button>`;
    card.innerHTML = html;
    card.classList.remove('facet-hidden');
    return;
  }

  storeFacetData(card, title, data, totals, isBytes);

  const otherRow = calculateOtherRow(data, totals);
  const hasOther = otherRow && otherRow.cnt > 0 && getNextTopN();

  // Exclude synthetic buckets like (same), (empty) from maxCount calculation
  // so they don't skew the 100% bar width for real values
  const realData = data.filter((d) => !isSyntheticBucket(d.dim));
  const maxCount = realData.length > 0 ? Math.max(...realData.map((d) => parseInt(d.cnt, 10))) : 1;

  let html = `<h3>${speedIndicator}${title}${copyBtnHtml}${modeToggleHtml}${summaryHtml}`;
  if (hasFilters) {
    html += ` <button class="clear-facet-btn" data-action="clear-facet" data-col="${escapeHtml(col)}">Clear</button>`;
  }
  html += `</h3><table class="breakdown-table" role="listbox" aria-label="${title} values">`;

  let rowIndex = 0;
  for (const row of data) {
    html += buildBreakdownRow({
      row,
      col,
      maxCount,
      columnFilters,
      valueFormatter,
      linkPrefix,
      linkSuffix,
      linkFn,
      dimPrefixes,
      dimFormatFn,
      filterCol,
      filterValueFn,
      filterOp,
      rowIndex,
    });
    rowIndex += 1;
  }

  // Add "Other" / "More" row
  const nextN = getNextTopN();
  html += buildOtherRow({
    otherRow: hasOther ? otherRow : null,
    maxCount,
    rowIndex,
    nextN,
    isContinuous,
    col,
    id,
    title,
    filterCol,
    valueFormatter,
  });

  html += '</table>';

  // Add hide button in bottom-right corner
  html += `<button class="facet-hide-btn" data-action="toggle-facet-hide" data-facet="${escapeHtml(id)}" title="Hide facet"></button>`;

  card.innerHTML = html;
  card.classList.remove('facet-hidden');
}

export function renderBreakdownError(id, details = {}) {
  const card = document.getElementById(id);
  const title = card.querySelector('h3')?.textContent || card.dataset.title || id;
  const label = details.label || 'Query failed';
  const message = details.message || 'Error loading data';
  const detail = details.detail && details.detail !== message ? details.detail : '';
  const metaParts = [];

  if (details.code) metaParts.push(`Code ${details.code}`);
  if (details.type) metaParts.push(details.type);
  if (details.status) metaParts.push(`HTTP ${details.status}`);

  const detailHtml = detail
    ? `<div class="facet-error-detail">${escapeHtml(detail)}</div>`
    : '';
  const metaHtml = metaParts.length > 0
    ? `<div class="facet-error-meta">${escapeHtml(metaParts.join(' | '))}</div>`
    : '';

  card.innerHTML = `
    <h3>${escapeHtml(title)}</h3>
    <div class="facet-error">
      <div class="facet-error-title">${escapeHtml(label)}</div>
      <div class="facet-error-message">${escapeHtml(message)}</div>
      ${detailHtml}${metaHtml}
    </div>
    <button class="facet-hide-btn" data-action="toggle-facet-hide" data-facet="${escapeHtml(id)}" title="Hide facet"></button>
  `;
}
