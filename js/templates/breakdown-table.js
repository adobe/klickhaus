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
import { getColorIndicatorHtml } from '../colors/index.js';

/**
 * Format dimension value with dimmed prefix if applicable.
 * @param {string} dim
 * @param {string[]|undefined} dimPrefixes
 * @param {Function|undefined} dimFormatFn
 * @returns {string} HTML string
 */
export function formatDimWithPrefix(dim, dimPrefixes, dimFormatFn) {
  if (dimFormatFn) return dimFormatFn(dim);
  if (!dimPrefixes || dimPrefixes.length === 0) return escapeHtml(dim);
  for (const prefix of dimPrefixes) {
    if (dim.startsWith(prefix)) {
      return `<span class="dim-prefix">${escapeHtml(prefix)}</span>${escapeHtml(dim.slice(prefix.length))}`;
    }
  }
  return escapeHtml(dim);
}

/**
 * Build dimension parts (formatted text, link URL, color indicator).
 * @param {Object} params
 * @param {Object} params.row - Data row
 * @param {string} params.dim - Display dimension value
 * @param {string} params.col - Column name
 * @param {string|undefined} params.linkPrefix
 * @param {string|undefined} params.linkSuffix
 * @param {Function|undefined} params.linkFn
 * @param {string[]|undefined} params.dimPrefixes
 * @param {Function|undefined} params.dimFormatFn
 * @returns {{ formattedDim: string, linkUrl: string|null,
 *   colorIndicator: string }}
 */
export function buildDimParts({
  row, dim, col, linkPrefix, linkSuffix, linkFn, dimPrefixes, dimFormatFn,
}) {
  const isSynthetic = isSyntheticBucket(dim);
  const colorIndicator = getColorIndicatorHtml(col, row.dim);

  const formattedDim = isSynthetic
    ? `<span class="dim-prefix">${escapeHtml(dim)}</span>`
    : formatDimWithPrefix(dim, dimPrefixes, dimFormatFn);

  let linkUrl = null;
  if (!isSyntheticBucket(row.dim)) {
    if (linkFn && row.dim) {
      linkUrl = linkFn(row.dim);
    } else if (linkPrefix && row.dim) {
      const linkValue = row.dim.split(' ')[0];
      linkUrl = linkPrefix + linkValue + (linkSuffix || '');
    }
  }

  return { formattedDim, linkUrl, colorIndicator };
}

/**
 * Build a single data row for the breakdown table.
 * Uses the filter-tag-indicator pattern with clickable dim cells.
 * @param {Object} params
 * @param {Object} params.row - Data row
 * @param {string} params.col - Column name
 * @param {number} params.maxCount - Max count for bar width
 * @param {Array} params.columnFilters - Active filters
 * @param {Function} params.valueFormatter - Number formatter
 * @param {string|undefined} params.linkPrefix
 * @param {string|undefined} params.linkSuffix
 * @param {Function|undefined} params.linkFn
 * @param {string[]|undefined} params.dimPrefixes
 * @param {Function|undefined} params.dimFormatFn
 * @param {string|undefined} params.filterCol
 * @param {Function|undefined} params.filterValueFn
 * @param {string|undefined} params.filterOp
 * @param {number} params.rowIndex
 * @returns {string} HTML string
 */
export function buildBreakdownRow({
  row, col, maxCount, columnFilters, valueFormatter,
  linkPrefix, linkSuffix, linkFn, dimPrefixes, dimFormatFn,
  filterCol, filterValueFn, filterOp, rowIndex,
}) {
  const cnt = parseInt(row.cnt, 10);
  const cntOk = parseInt(row.cnt_ok, 10) || 0;
  const cnt4xx = parseInt(row.cnt_4xx, 10) || 0;
  const cnt5xx = parseInt(row.cnt_5xx, 10) || 0;
  const dim = row.dim || '(empty)';
  const isSynthetic = isSyntheticBucket(dim);

  const barWidth = (isSynthetic && cnt > maxCount)
    ? 100 : (cnt / maxCount) * 100;
  const overflowClass = isSynthetic ? ' bar-overflow' : '';
  const pct5xx = cnt > 0 ? (cnt5xx / cnt) * 100 : 0;
  const pct4xx = cnt > 0 ? (cnt4xx / cnt) * 100 : 0;
  const pctOk = cnt > 0 ? (cntOk / cnt) * 100 : 0;

  const activeFilter = columnFilters.find(
    (f) => f.value === (row.dim || ''),
  );
  const isIncluded = activeFilter && !activeFilter.exclude;
  const isExcluded = activeFilter && activeFilter.exclude;
  const isFilteredValue = row.isFilteredValue === true;

  let filterClass = '';
  if (isIncluded) filterClass = 'filter-included';
  else if (isExcluded) filterClass = 'filter-excluded';
  if (isFilteredValue) filterClass += ' filtered-value-row';
  const rowClass = isSynthetic
    ? `synthetic-row ${filterClass}` : filterClass.trim();

  const { formattedDim, linkUrl, colorIndicator } = buildDimParts({
    row, dim, col, linkPrefix, linkSuffix, linkFn, dimPrefixes, dimFormatFn,
  });

  const actualFilterCol = filterCol || col;
  const actualFilterValue = filterValueFn
    ? filterValueFn(row.dim || '') : (row.dim || '');
  const actualFilterOp = filterOp || '=';
  const filterAttrs = [
    `data-col="${escapeHtml(col)}"`,
    `data-value="${escapeHtml(row.dim || '')}"`,
    `data-filter-col="${escapeHtml(actualFilterCol)}"`,
    `data-filter-value="${escapeHtml(actualFilterValue)}"`,
    `data-filter-op="${escapeHtml(actualFilterOp)}"`,
  ].join(' ');

  // Extract background color from color indicator
  const colorMatch = colorIndicator.match(/background:\s*([^;"]+)/);
  const bgColor = colorMatch ? colorMatch[1] : '';

  // Build filter tag with consistent structure in all states
  let stateClass = '';
  let iconChar = '';
  let tagStyle = '';
  if (isIncluded) {
    stateClass = ' active';
    iconChar = '\u2713';
    tagStyle = ` style="background: ${bgColor || 'var(--text)'}"`;
  } else if (isExcluded) {
    stateClass = ' exclude';
    iconChar = '\u00D7';
    tagStyle = ` style="background: ${bgColor || 'var(--text)'}"`;
  }

  const indicatorSlot = '<span class="filter-indicator-slot">'
    + `<span class="filter-icon">${iconChar}</span>`
    + `${colorIndicator}</span>`;
  const textHtml = linkUrl
    ? `<a href="${linkUrl}" target="_blank" rel="noopener">`
      + `${formattedDim}</a>`
    : formattedDim;
  const filterTag = '<span class="filter-tag-indicator'
    + `${stateClass}"${tagStyle}>${indicatorSlot}${textHtml}</span>`;

  // Cycle filter state: none -> include -> exclude -> none
  const dimAction = (isIncluded || isExcluded)
    ? 'remove-filter-value' : 'add-filter';
  const dimExclude = isExcluded ? 'true' : 'false';

  const ariaSelected = isIncluded || isExcluded ? 'true' : 'false';
  const dimDataAttr = (row.dim || '').replace(/"/g, '&quot;');
  const bgAttr = escapeHtml(bgColor || 'var(--text)');

  return `
    <tr class="${rowClass}" tabindex="0" role="option" aria-selected="${ariaSelected}" data-value-index="${rowIndex}" data-dim="${dimDataAttr}">
      <td class="dim dim-clickable" title="${escapeHtml(dim)}" data-action="${dimAction}" ${filterAttrs} data-exclude="${dimExclude}" data-bg-color="${bgAttr}">${filterTag}</td>
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

/**
 * Build the "other" row for the breakdown table.
 * @param {Object} params
 * @param {Object|null} params.otherRow - Other row counts
 * @param {number} params.maxCount - Max count for bar width
 * @param {number} params.rowIndex - Current row index
 * @param {number|null} params.nextN - Next topN value
 * @param {boolean} params.isContinuous - Whether continuous range
 * @param {string} params.col - Column name
 * @param {string} params.id - Facet card ID
 * @param {string} params.title - Facet title
 * @param {string|undefined} params.filterCol
 * @param {Function} params.valueFormatter - Number formatter
 * @returns {string} HTML string
 */
export function buildOtherRow({
  otherRow, maxCount, rowIndex, nextN, isContinuous,
  col, id, title, filterCol, valueFormatter,
}) {
  if (isContinuous && nextN) {
    return `
      <tr class="other-row" tabindex="0" role="option" aria-selected="false" data-value-index="${rowIndex}" data-action="increase-topn" title="Click to show ${nextN} buckets with finer granularity">
        <td class="dim"><span class="dim-prefix">(more)</span></td>
        <td class="count"></td>
        <td class="bar"></td>
      </tr>
    `;
  }

  if (!otherRow || otherRow.cnt <= 0 || !nextN) return '';

  const { cnt } = otherRow;
  const cntOk = otherRow.cnt_ok;
  const cnt4xx = otherRow.cnt_4xx;
  const cnt5xx = otherRow.cnt_5xx;
  const isOverflow = cnt > maxCount;
  const barWidth = isOverflow ? 100 : (cnt / maxCount) * 100;
  const pct5xx = cnt > 0 ? (cnt5xx / cnt) * 100 : 0;
  const pct4xx = cnt > 0 ? (cnt4xx / cnt) * 100 : 0;
  const pctOk = cnt > 0 ? (cntOk / cnt) * 100 : 0;
  const overflowClass = isOverflow ? ' bar-overflow' : '';

  const actualFilterCol = filterCol || col;
  const searchAttrs = [
    `data-col="${escapeHtml(col)}"`,
    `data-facet-id="${escapeHtml(id)}"`,
    `data-filter-col="${escapeHtml(actualFilterCol)}"`,
    `data-title="${escapeHtml(title)}"`,
  ].join(' ');

  return `
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
