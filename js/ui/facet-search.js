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
import { query } from '../api.js';
import { DATABASE } from '../config.js';
import { getTimeFilter, getHostFilter, getTable } from '../time.js';
import { escapeHtml } from '../utils.js';
import { formatNumber } from '../format.js';
import { getFacetFiltersExcluding } from '../breakdowns/index.js';
import { state } from '../state.js';

// State
let currentCol = null;
let currentFilterCol = null;
let selectedIndex = -1;
let searchResults = [];
let debounceTimer = null;

// Callbacks set by init
let addFilterCallback = null;

/**
 * Render search results
 */
function renderResults() {
  const container = document.getElementById('facetSearchResults');

  if (searchResults.length === 0) {
    container.innerHTML = '<div class="facet-search-empty">No matching values found</div>';
    return;
  }

  container.innerHTML = searchResults.map((row, i) => {
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

/**
 * Load initial results (next values after topN)
 */
async function loadInitialResults() {
  const results = document.getElementById('facetSearchResults');
  results.innerHTML = '<div class="facet-search-loading">Loading...</div>';

  try {
    const timeFilter = getTimeFilter();
    const hostFilter = getHostFilter();
    const facetFilters = getFacetFiltersExcluding(currentCol);
    const searchCol = currentFilterCol || currentCol;

    // Fetch next 20 values after the currently displayed topN
    const sql = `
      SELECT ${searchCol} as dim, count() as cnt
      FROM ${DATABASE}.${getTable()}
      WHERE ${timeFilter} ${hostFilter} ${facetFilters}
      GROUP BY dim
      ORDER BY cnt DESC
      LIMIT 20 OFFSET ${state.topN}
    `;

    const result = await query(sql);
    searchResults = result.data || [];
    selectedIndex = -1;

    if (searchResults.length === 0) {
      results.innerHTML = '<div class="facet-search-hint">Type to search values...</div>';
    } else {
      renderResults();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Facet search initial load error:', err);
    results.innerHTML = '<div class="facet-search-hint">Type to search values...</div>';
  }
}

/**
 * Search for facet values matching the pattern
 * @param {string} pattern - The search pattern
 */
async function searchFacetValues(pattern) {
  const results = document.getElementById('facetSearchResults');

  if (!pattern || pattern.length < 2) {
    // When cleared, reload initial results
    loadInitialResults();
    return;
  }

  results.innerHTML = '<div class="facet-search-loading">Searching...</div>';

  try {
    const timeFilter = getTimeFilter();
    const hostFilter = getHostFilter();
    const facetFilters = getFacetFiltersExcluding(currentCol);

    // Escape pattern for LIKE query (escape %, _, \, and ')
    const escapedPattern = pattern
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_')
      .replace(/'/g, "\\'");

    // Use the filterCol for searching since it's the raw column
    const searchCol = currentFilterCol || currentCol;

    const sql = `
      SELECT ${searchCol} as dim, count() as cnt
      FROM ${DATABASE}.${getTable()}
      WHERE ${timeFilter} ${hostFilter} ${facetFilters}
        AND ${searchCol} LIKE '%${escapedPattern}%'
      GROUP BY dim
      ORDER BY cnt DESC
      LIMIT 20
    `;

    const result = await query(sql);
    searchResults = result.data || [];

    renderResults();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Facet search error:', err);
    results.innerHTML = '<div class="facet-search-error">Search failed</div>';
    searchResults = [];
  }
}

/**
 * Close the facet search popover
 */
export function closeFacetSearch() {
  const dialog = document.getElementById('facetSearchPopover');
  dialog.close();
  currentCol = null;
  currentFilterCol = null;
  selectedIndex = -1;
  searchResults = [];
}

/**
 * Navigate through results with keyboard
 * @param {number} direction - 1 for down, -1 for up
 */
function navigateResults(direction) {
  if (searchResults.length === 0) return;

  selectedIndex += direction;

  // Wrap around
  if (selectedIndex < 0) {
    selectedIndex = searchResults.length - 1;
  } else if (selectedIndex >= searchResults.length) {
    selectedIndex = 0;
  }

  renderResults();

  // Scroll selected item into view
  const container = document.getElementById('facetSearchResults');
  const selectedItem = container.querySelector('.facet-search-item.selected');
  if (selectedItem) {
    selectedItem.scrollIntoView({ block: 'nearest' });
  }
}

/**
 * Apply filter for a result
 * @param {number} index - The result index
 * @param {boolean} exclude - Whether to exclude instead of include
 */
function applyFilter(index, exclude) {
  if (index < 0 || index >= searchResults.length) return;

  const selected = searchResults[index];
  const value = selected.dim || '';

  // Save values before closing (closeFacetSearch clears them)
  const col = currentCol;
  const filterCol = currentFilterCol;

  // Close the popover
  closeFacetSearch();

  // Apply filter using the display column for col parameter
  // and filterCol for the actual SQL filter
  if (addFilterCallback) {
    addFilterCallback(
      col,
      value,
      exclude,
      filterCol,
      value,
      '=', // exact match for searched values
    );
  }
}

/**
 * Initialize facet search with callbacks
 * @param {Object} callbacks - { addFilter }
 */
export function initFacetSearch(callbacks) {
  addFilterCallback = callbacks.addFilter;

  const dialog = document.getElementById('facetSearchPopover');
  const input = document.getElementById('facetSearchInput');

  // Handle input changes with debounce
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      searchFacetValues(input.value.trim());
    }, 300);
  });

  // Handle keyboard navigation
  input.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'j':
        // j only navigates if input is empty (not typing)
        if (e.key === 'ArrowDown' || input.value === '') {
          e.preventDefault();
          navigateResults(1);
        }
        break;
      case 'ArrowUp':
      case 'k':
        // k only navigates if input is empty (not typing)
        if (e.key === 'ArrowUp' || input.value === '') {
          e.preventDefault();
          navigateResults(-1);
        }
        break;
      case 'Enter':
      case 'i':
        // i only filters if input is empty and item selected
        if (e.key === 'Enter' || (input.value === '' && selectedIndex >= 0)) {
          e.preventDefault();
          applyFilter(selectedIndex, e.shiftKey);
        }
        break;
      case 'e':
      case 'x':
        // e/x only excludes if input is empty and item selected
        if (input.value === '' && selectedIndex >= 0) {
          e.preventDefault();
          applyFilter(selectedIndex, true);
        }
        break;
      case 'Escape':
        e.preventDefault();
        closeFacetSearch();
        break;
      default:
        break;
    }
  });

  // Close on click outside
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      closeFacetSearch();
    }
  });

  // Handle result clicks using event delegation
  const resultsContainer = document.getElementById('facetSearchResults');
  resultsContainer.addEventListener('click', (e) => {
    // Check if a button was clicked
    const btn = e.target.closest('.facet-search-btn');
    if (btn) {
      const index = parseInt(btn.dataset.index, 10);
      const exclude = btn.dataset.exclude === 'true';
      if (!Number.isNaN(index)) {
        applyFilter(index, exclude);
      }
      return;
    }

    // Otherwise, clicking on item selects it (for keyboard follow-up)
    const item = e.target.closest('.facet-search-item');
    if (item) {
      const index = parseInt(item.dataset.index, 10);
      if (!Number.isNaN(index)) {
        selectedIndex = index;
        renderResults();
      }
    }
  });
}

/**
 * Open the facet search popover
 * @param {string} col - The column expression used for display
 * @param {string} _ - The facet card ID (unused)
 * @param {string} filterCol - The column to filter on (may differ from col)
 * @param {string} title - The facet title to display
 */
export function openFacetSearch(col, _, filterCol, title) {
  currentCol = col;
  currentFilterCol = filterCol;
  selectedIndex = -1;
  searchResults = [];

  const dialog = document.getElementById('facetSearchPopover');
  const input = document.getElementById('facetSearchInput');
  const results = document.getElementById('facetSearchResults');
  const titleEl = document.getElementById('facetSearchTitle');

  // Set title
  if (titleEl) {
    titleEl.textContent = title || 'Search';
  }

  // Clear previous state
  input.value = '';
  input.placeholder = `Search ${title || 'values'}...`;
  results.innerHTML = '<div class="facet-search-loading">Loading...</div>';

  // Show dialog
  dialog.showModal();
  input.focus();

  // Load initial results (next values after topN)
  loadInitialResults();
}
