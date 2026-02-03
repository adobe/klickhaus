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
import { getColorForColumn } from '../colors/index.js';

/**
 * Render a single facet palette item.
 * @param {Object} params
 * @param {Object} params.facet - Facet object with id, title, isHidden
 * @param {string|null} params.matchedValue - Matched value text or null
 * @param {boolean} params.isSelected - Whether this item is selected
 * @param {number} params.index - Item index
 * @param {Record<string, string>} params.facetColumns - Map of facet ID to column name
 * @returns {string} HTML string
 */
export function renderFacetPaletteItem({
  facet, matchedValue, isSelected, index, facetColumns,
}) {
  const hiddenBadge = facet.isHidden ? '<span class="palette-hidden-badge">hidden</span>' : '';
  const mainText = matchedValue ? escapeHtml(matchedValue) : facet.title;
  const facetBadge = matchedValue ? `<span class="palette-facet-badge">${facet.title}</span>` : '';

  let colorStyle = '';
  if (matchedValue) {
    const col = facetColumns[facet.id];
    if (col) {
      const color = getColorForColumn(col, matchedValue);
      if (color) {
        colorStyle = `style="border-left: 3px solid ${color};"`;
      }
    }
  }

  return `
    <div class="palette-item${isSelected ? ' selected' : ''}${matchedValue ? ' value-match' : ''}" ${colorStyle} data-index="${index}" data-type="facet" data-facet-id="${facet.id}">
      <span class="palette-item-title">${mainText}</span>
      ${facetBadge}
      ${hiddenBadge}
    </div>
  `;
}

/**
 * Render a saved query palette item.
 * @param {Object} params
 * @param {Object} params.query - Query object with title, description, section, href
 * @param {boolean} params.isSelected - Whether this item is selected
 * @param {number} params.index - Item index
 * @returns {string} HTML string
 */
export function renderQueryPaletteItem({ query, isSelected, index }) {
  const shortSection = query.section
    .replace(/^Legacy Views\s*/i, '')
    .replace(/\(Migration from Coralogix\)/gi, '')
    .replace(/^\s*[-\u2013\u2014]\s*/, '')
    .trim();
  return `
    <div class="palette-item palette-query${isSelected ? ' selected' : ''}" data-index="${index}" data-type="query" data-href="${escapeHtml(query.href)}">
      <div class="palette-query-content">
        <span class="palette-item-title">${escapeHtml(query.title)}</span>
        <span class="palette-query-desc">${escapeHtml(query.description)}</span>
      </div>
      <span class="palette-query-badge">${escapeHtml(shortSection)}</span>
    </div>
  `;
}

/**
 * Render the full palette list HTML.
 * @param {Array} results - Array of result objects with type, facet/query, matchedValue
 * @param {number} selectedIndex - Currently selected index
 * @param {Record<string, string>} facetColumns - Map of facet ID to column name
 * @returns {string} HTML string
 */
export function renderPaletteListHtml(results, selectedIndex, facetColumns) {
  return results.map((r, i) => {
    const isSelected = i === selectedIndex;
    if (r.type === 'facet') {
      return renderFacetPaletteItem({
        facet: r.facet,
        matchedValue: r.matchedValue,
        isSelected,
        index: i,
        facetColumns,
      });
    } else if (r.type === 'query') {
      return renderQueryPaletteItem({
        query: r.query,
        isSelected,
        index: i,
      });
    }
    return '';
  }).join('');
}
