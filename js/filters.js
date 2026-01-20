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
import { escapeHtml } from './utils.js';
import { getColorIndicatorHtml } from './colors/index.js';
import { allBreakdowns } from './breakdowns/definitions.js';

// Callbacks set by main.js to avoid circular dependencies
let saveStateToURL = null;
let loadDashboard = null;

export function setFilterCallbacks(saveUrl, loadDash) {
  saveStateToURL = saveUrl;
  loadDashboard = loadDash;
}

// Fix header position when in keyboard mode or with 2+ filters
export function updateHeaderFixed() {
  const shouldFix = document.body.classList.contains('keyboard-mode') || state.filters.length >= 2;
  document.body.classList.toggle('header-fixed', shouldFix);
}

// Get facet title from breakdown column
function getFacetTitle(col) {
  const breakdown = allBreakdowns.find((b) => b.col === col);
  if (!breakdown) return null;
  const card = document.getElementById(breakdown.id);
  if (!card) return null;
  const h3 = card.querySelector('h3');
  if (!h3) return null;
  // Get only direct text nodes (ignore badges/buttons)
  let title = '';
  for (const node of h3.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      title += node.textContent;
    }
  }
  return title.trim() || null;
}

export function renderActiveFilters() {
  const container = document.getElementById('activeFilters');
  if (state.filters.length === 0) {
    container.innerHTML = '';
    updateHeaderFixed();
    return;
  }
  container.innerHTML = state.filters.map((f, i) => {
    let label;
    if (f.value === '') {
      // Empty value - show facet name with ! prefix
      const facetTitle = getFacetTitle(f.col) || 'Empty';
      label = f.exclude ? `NOT !${facetTitle}` : `!${facetTitle}`;
    } else {
      label = f.exclude ? `NOT ${f.value}` : f.value;
    }
    // Get color indicator using unified color system
    const colorIndicator = getColorIndicatorHtml(f.col, f.value, 'filter-color');
    return `<span class="filter-tag ${f.exclude ? 'exclude' : ''}" data-action="remove-filter" data-index="${i}">${colorIndicator}${escapeHtml(label)}</span>`;
  }).join('');
  updateHeaderFixed();
}

export function getFiltersForColumn(col) {
  return state.filters.filter((f) => f.col === col);
}

export function clearFiltersForColumn(col) {
  state.filters = state.filters.filter((f) => f.col !== col);
  renderActiveFilters();
  if (saveStateToURL) saveStateToURL();
  if (loadDashboard) loadDashboard();
}

export function clearAllFilters() {
  if (state.filters.length === 0) return;
  state.filters = [];
  renderActiveFilters();
  if (saveStateToURL) saveStateToURL();
  if (loadDashboard) loadDashboard();
}

export function addFilter(col, value, exclude, skipReload = false) {
  // Remove existing filter for same col+value
  state.filters = state.filters.filter((f) => !(f.col === col && f.value === value));

  // Look up breakdown to get filterCol and filterValueFn if defined
  const breakdown = allBreakdowns.find((b) => b.col === col);
  const filter = { col, value, exclude };
  if (breakdown?.filterCol) {
    filter.filterCol = breakdown.filterCol;
    filter.filterValue = breakdown.filterValueFn ? breakdown.filterValueFn(value) : value;
  }

  state.filters.push(filter);
  renderActiveFilters();
  if (!skipReload) {
    if (saveStateToURL) saveStateToURL();
    if (loadDashboard) loadDashboard();
  }
}

export function removeFilter(index) {
  state.filters.splice(index, 1);
  renderActiveFilters();
  if (saveStateToURL) saveStateToURL();
  if (loadDashboard) loadDashboard();
}

export function removeFilterByValue(col, value) {
  state.filters = state.filters.filter((f) => !(f.col === col && f.value === value));
  renderActiveFilters();
  if (saveStateToURL) saveStateToURL();
  if (loadDashboard) loadDashboard();
}
