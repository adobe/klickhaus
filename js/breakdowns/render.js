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
import { getColorIndicatorHtml } from '../colors/index.js';
import { state } from '../state.js';
import { TOP_N_OPTIONS } from '../constants.js';

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

// Format dimension value with dimmed prefix if applicable
function formatDimWithPrefix(dim, dimPrefixes, dimFormatFn) {
  // Use custom format function if provided
  if (dimFormatFn) return dimFormatFn(dim);
  if (!dimPrefixes || dimPrefixes.length === 0) return escapeHtml(dim);
  for (const prefix of dimPrefixes) {
    if (dim.startsWith(prefix)) {
      return `<span class="dim-prefix">${escapeHtml(prefix)}</span>${escapeHtml(dim.slice(prefix.length))}`;
    }
  }
  return escapeHtml(dim);
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
  // Store original title in data attribute, or read from h3 if first render
  if (!card.dataset.title) {
    card.dataset.title = card.querySelector('h3').textContent;
  }
  const { title } = card.dataset;

  // Get active filters for this column
  const columnFilters = getFiltersForColumn(col);
  const hasFilters = columnFilters.length > 0;

  // Check mode for this facet (count vs bytes)
  const mode = modeToggle ? state[modeToggle] : 'count';
  const isBytes = mode === 'bytes';
  const valueFormatter = isBytes ? formatBytes : formatNumber;

  // Speed indicator based on elapsed time (aligned with Google LCP thresholds)
  let speedClass;
  if (elapsed < 2500) {
    speedClass = 'fast';
  } else if (elapsed < 4000) {
    speedClass = 'medium';
  } else {
    speedClass = 'slow';
  }
  const speedTitle = formatQueryTime(elapsed);
  const isPinned = state.pinnedFacets.includes(id);
  const pinTitle = isPinned ? 'Unpin facet' : 'Pin facet to top';
  const speedIndicator = `<span class="speed-indicator ${speedClass}" title="${speedTitle} - ${pinTitle}" data-action="toggle-facet-pin" data-facet="${escapeHtml(id)}" role="button"></span>`;

  // Mode toggle for facets that support it (e.g., content-types: count vs bytes)
  const modeToggleHtml = modeToggle
    ? `<button class="mode-toggle${isBytes ? ' active' : ''}" data-action="toggle-facet-mode" data-mode="${escapeHtml(modeToggle)}" title="Toggle between request count and bytes transferred">${isBytes ? 'B' : '#'}</button>`
    : '';

  // Copy to clipboard button (TSV format for spreadsheets)
  const copyBtnHtml = `<button class="copy-facet-btn" data-action="copy-facet-tsv" data-facet="${escapeHtml(id)}" title="Copy data as TSV (paste into spreadsheet)">copy</button>`;

  // Summary metric display (e.g., "87% efficiency")
  const summaryColorClass = summaryColor ? ` summary-${summaryColor}` : '';
  const summaryHtml = (summaryRatio !== null && summaryLabel)
    ? `<span class="summary-metric${summaryColorClass}" title="${(summaryRatio * 100).toFixed(1)}% ${summaryLabel}">${Math.round(summaryRatio * 100)}%</span>`
    : '';

  if (data.length === 0) {
    let html = `<h3>${speedIndicator}${title}${modeToggleHtml}${summaryHtml}`;
    if (hasFilters) {
      html += ` <button class="clear-facet-btn" data-action="clear-facet" data-col="${escapeHtml(col)}">Clear</button>`;
    }
    html += '</h3><div class="empty">No data</div>';
    html += `<button class="facet-hide-btn" data-action="toggle-facet-hide" data-facet="${escapeHtml(id)}" title="Hide facet"></button>`;
    card.innerHTML = html;
    card.classList.remove('facet-hidden');
    return;
  }

  // Store data on card for copy functionality (stored as JSON for easy access)
  card.dataset.facetData = JSON.stringify({
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

  // Calculate "Other" from totals
  const topKSum = {
    cnt: data.reduce((sum, d) => sum + parseInt(d.cnt, 10), 0),
    cnt_ok: data.reduce((sum, d) => sum + (parseInt(d.cnt_ok, 10) || 0), 0),
    cnt_4xx: data.reduce((sum, d) => sum + (parseInt(d.cnt_4xx, 10) || 0), 0),
    cnt_5xx: data.reduce((sum, d) => sum + (parseInt(d.cnt_5xx, 10) || 0), 0),
  };
  const otherRow = totals ? {
    cnt: parseInt(totals.cnt, 10) - topKSum.cnt,
    cnt_ok: (parseInt(totals.cnt_ok, 10) || 0) - topKSum.cnt_ok,
    cnt_4xx: (parseInt(totals.cnt_4xx, 10) || 0) - topKSum.cnt_4xx,
    cnt_5xx: (parseInt(totals.cnt_5xx, 10) || 0) - topKSum.cnt_5xx,
  } : null;
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
    const cnt = parseInt(row.cnt, 10);
    const cntOk = parseInt(row.cnt_ok, 10) || 0;
    const cnt4xx = parseInt(row.cnt_4xx, 10) || 0;
    const cnt5xx = parseInt(row.cnt_5xx, 10) || 0;

    const dim = row.dim || '(empty)';
    const isSynthetic = isSyntheticBucket(dim);

    // For synthetic buckets, cap bar at 100% and always show fading gradient
    // to visually distinguish them from real dimension values
    const barWidth = (isSynthetic && cnt > maxCount) ? 100 : (cnt / maxCount) * 100;
    const overflowClass = isSynthetic ? ' bar-overflow' : '';

    // Calculate percentages within this row (for stacked segments)
    const pct5xx = cnt > 0 ? (cnt5xx / cnt) * 100 : 0;
    const pct4xx = cnt > 0 ? (cnt4xx / cnt) * 100 : 0;
    const pctOk = cnt > 0 ? (cntOk / cnt) * 100 : 0;

    // Check if this value is currently filtered
    const activeFilter = columnFilters.find((f) => f.value === (row.dim || ''));
    const isIncluded = activeFilter && !activeFilter.exclude;
    const isExcluded = activeFilter && activeFilter.exclude;
    // Check if this row was added because it's a filtered value not in topN
    const isFilteredValue = row.isFilteredValue === true;
    let filterClass = '';
    if (isIncluded) {
      filterClass = 'filter-included';
    } else if (isExcluded) {
      filterClass = 'filter-excluded';
    }
    if (isFilteredValue) {
      filterClass += ' filtered-value-row';
    }
    const rowClass = isSynthetic ? `synthetic-row ${filterClass}` : filterClass.trim();

    // Build dimension cell content - with optional link and dimmed prefix
    // Synthetic buckets like (same), (empty) don't get links
    let linkUrl = null;
    if (!isSyntheticBucket(row.dim)) {
      if (linkFn && row.dim) {
        linkUrl = linkFn(row.dim);
      } else if (linkPrefix && row.dim) {
        // For ASN links, extract just the number (before first space)
        const linkValue = row.dim.split(' ')[0];
        linkUrl = linkPrefix + linkValue + (linkSuffix || '');
      }
    }
    // Synthetic buckets get dimmed styling like (other)
    const formattedDim = isSynthetic
      ? `<span class="dim-prefix">${escapeHtml(dim)}</span>`
      : formatDimWithPrefix(dim, dimPrefixes, dimFormatFn);

    // Get color indicator using unified color system (already skips synthetic buckets)
    const colorIndicator = getColorIndicatorHtml(col, row.dim);

    // Compute filter attributes (may differ from display col/value for grouped facets)
    const actualFilterCol = filterCol || col;
    const actualFilterValue = filterValueFn ? filterValueFn(row.dim || '') : (row.dim || '');
    const actualFilterOp = filterOp || '=';
    const filterAttrs = `data-col="${escapeHtml(col)}" data-value="${escapeHtml(row.dim || '')}" data-filter-col="${escapeHtml(actualFilterCol)}" data-filter-value="${escapeHtml(actualFilterValue)}" data-filter-op="${escapeHtml(actualFilterOp)}"`;

    // Extract background color from color indicator
    const colorMatch = colorIndicator.match(/background:\s*([^;"]+)/);
    const bgColor = colorMatch ? colorMatch[1] : '';

    // Build filter tag with consistent structure in all states (prevents layout shift)
    // Always: indicator slot (icon + color bar) + text content
    let stateClass = '';
    let iconChar = '';
    let tagStyle = '';
    if (isIncluded) {
      stateClass = ' active';
      iconChar = '✓';
      tagStyle = ` style="background: ${bgColor || 'var(--text)'}"`;
    } else if (isExcluded) {
      stateClass = ' exclude';
      iconChar = '×';
      tagStyle = ` style="background: ${bgColor || 'var(--text)'}"`;
    }

    const indicatorSlot = `<span class="filter-indicator-slot"><span class="filter-icon">${iconChar}</span>${colorIndicator}</span>`;
    const textHtml = linkUrl
      ? `<a href="${linkUrl}" target="_blank" rel="noopener">${formattedDim}</a>`
      : formattedDim;
    const filterTag = `<span class="filter-tag-indicator${stateClass}"${tagStyle}>${indicatorSlot}${textHtml}</span>`;

    // Cycle filter state: none → include → exclude → none
    const dimAction = (isIncluded || isExcluded) ? 'remove-filter-value' : 'add-filter';
    const dimExclude = isExcluded ? 'true' : 'false';

    const ariaSelected = isIncluded || isExcluded ? 'true' : 'false';
    const dimDataAttr = (row.dim || '').replace(/"/g, '&quot;');
    html += `
      <tr class="${rowClass}" tabindex="0" role="option" aria-selected="${ariaSelected}" data-value-index="${rowIndex}" data-dim="${dimDataAttr}">
        <td class="dim dim-clickable" title="${escapeHtml(dim)}" data-action="${dimAction}" ${filterAttrs} data-exclude="${dimExclude}" data-bg-color="${escapeHtml(bgColor || 'var(--text)')}">${filterTag}</td>
        <td class="count">
          <span class="value">${valueFormatter(cnt)}</span>
        </td>
        <td class="bar">
          <div class="bar-inner${overflowClass}" style="width: ${barWidth}%">
            <div class="bar-segment bar-5xx" style="width: ${pct5xx}%"></div>
            <div class="bar-segment bar-4xx" style="width: ${pct4xx}%"></div>
            <div class="bar-segment bar-ok" style="width: ${pctOk}%"></div>
          </div>
        </td>
      </tr>
    `;
    rowIndex += 1;
  }

  // Add "Other" row if there are more values beyond topN (for non-continuous facets)
  // Or add "More" row for continuous facets (always shown if next topN is available)
  const nextN = getNextTopN();
  if (isContinuous && nextN) {
    // Continuous facets: show "(more)" to get finer-grained buckets
    html += `
      <tr class="other-row" tabindex="0" role="option" aria-selected="false" data-value-index="${rowIndex}" data-action="increase-topn" title="Click to show ${nextN} buckets with finer granularity">
        <td class="dim"><span class="dim-prefix">(more)</span></td>
        <td class="count"></td>
        <td class="bar"></td>

      </tr>
    `;
  } else if (hasOther) {
    const { cnt } = otherRow;
    const cntOk = otherRow.cnt_ok;
    const cnt4xx = otherRow.cnt_4xx;
    const cnt5xx = otherRow.cnt_5xx;
    // Cap bar width at 100% (same as top value) to prevent layout explosion
    const isOverflow = cnt > maxCount;
    const barWidth = isOverflow ? 100 : (cnt / maxCount) * 100;
    const pct5xx = cnt > 0 ? (cnt5xx / cnt) * 100 : 0;
    const pct4xx = cnt > 0 ? (cnt4xx / cnt) * 100 : 0;
    const pctOk = cnt > 0 ? (cntOk / cnt) * 100 : 0;
    const overflowClass = isOverflow ? ' bar-overflow' : '';

    // Build data attributes for facet search link
    const actualFilterCol = filterCol || col;
    const searchAttrs = `data-col="${escapeHtml(col)}" data-facet-id="${escapeHtml(id)}" data-filter-col="${escapeHtml(actualFilterCol)}" data-title="${escapeHtml(title)}"`;

    html += `
      <tr class="other-row" tabindex="0" role="option" aria-selected="false" data-value-index="${rowIndex}" title="Click to show top ${nextN}">
        <td class="dim">
          <span class="dim-prefix">(<a href="#" class="other-link" data-action="increase-topn">other</a>/<a href="#" class="facet-search-link" data-action="open-facet-search" ${searchAttrs}>search</a>)</span>
        </td>
        <td class="count">
          <span class="value">${valueFormatter(cnt)}</span>
        </td>
        <td class="bar">
          <div class="bar-inner${overflowClass}" style="width: ${barWidth}%">
            <div class="bar-segment bar-5xx" style="width: ${pct5xx}%"></div>
            <div class="bar-segment bar-4xx" style="width: ${pct4xx}%"></div>
            <div class="bar-segment bar-ok" style="width: ${pctOk}%"></div>
          </div>
        </td>

      </tr>
    `;
  }

  html += '</table>';

  // Add hide button in bottom-right corner
  html += `<button class="facet-hide-btn" data-action="toggle-facet-hide" data-facet="${escapeHtml(id)}" title="Hide facet"></button>`;

  card.innerHTML = html;
  card.classList.remove('facet-hidden');
}

export function renderBreakdownError(id, _) {
  const card = document.getElementById(id);
  const title = card.querySelector('h3').textContent;
  card.innerHTML = `<h3>${title}</h3><div class="empty">Error loading data</div>`;
}
