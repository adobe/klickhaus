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
import { formatNumber } from '../format.js';

/**
 * Render facet search results list HTML.
 * @param {Array<{dim: string, cnt: number}>} results - Search results
 * @param {number} selectedIndex - Currently selected index
 * @returns {string} HTML string
 */
export function renderFacetSearchResultsHtml(results, selectedIndex) {
  return results.map((row, i) => {
    const dim = row.dim || '(empty)';
    const selectedClass = i === selectedIndex ? ' selected' : '';
    return `
      <div class="facet-search-item${selectedClass}" data-index="${i}" role="option" aria-selected="${i === selectedIndex}">
        <span class="facet-search-value" title="${escapeHtml(dim)}">${escapeHtml(dim)}</span>
        <span class="facet-search-count">${formatNumber(row.cnt)}</span>
        <span class="facet-search-actions">
          <button class="facet-search-btn filter" data-index="${i}" data-exclude="false">Filter</button>
          <button class="facet-search-btn exclude" data-index="${i}" data-exclude="true">Exclude</button>
        </span>
      </div>
    `;
  }).join('');
}
