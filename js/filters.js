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
import { getColorIndicatorHtml } from './colors/index.js';
import { allBreakdowns } from './breakdowns/definitions.js';
import { renderFilterTags } from './templates/filter-tags.js';

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
  const breakdowns = state.breakdowns?.length ? state.breakdowns : allBreakdowns;
  const breakdown = breakdowns.find((b) => b.col === col);
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
  const filterData = state.filters.map((f) => {
    let label;
    const facetTitle = getFacetTitle(f.col) || 'Empty';
    if (f.value === '') {
      // Empty value - show facet name with ! prefix
      label = f.exclude ? `NOT !${facetTitle}` : `!${facetTitle}`;
    } else {
      label = f.exclude ? `NOT ${f.value}` : f.value;
    }
    const colorIndicator = getColorIndicatorHtml(f.col, f.value, 'filter-color');
    return {
      label, exclude: f.exclude, colorIndicator, title: facetTitle,
    };
  });
  container.innerHTML = renderFilterTags(filterData);
  updateHeaderFixed();
}

export function getFiltersForColumn(col) {
  return state.filters.filter((f) => f.col === col);
}

export function getFilterForValue(col, value) {
  return state.filters.find((f) => f.col === col && f.value === value);
}

/**
 * Get filter icon character based on state
 */
function getFilterIcon(isIncluded, isExcluded) {
  if (isIncluded) return '\u2713';
  if (isExcluded) return '\u00D7';
  return '';
}

/**
 * Update filter tag styling
 */
function updateFilterTagStyling(tagEl, isIncluded, isExcluded, bgColor) {
  const el = tagEl;
  el.classList.toggle('active', !!isIncluded);
  el.classList.toggle('exclude', !!isExcluded);
  el.style.background = (isIncluded || isExcluded) ? bgColor : '';

  const icon = el.querySelector('.filter-icon');
  if (icon) icon.textContent = getFilterIcon(isIncluded, isExcluded);
}

/**
 * Update a single row's filter styling
 */
function updateSingleRowFilterStyling(row, col, value) {
  const dimCell = row.querySelector('td.dim');
  if (dimCell?.dataset.col !== col) return;

  const filter = state.filters.find((f) => f.col === col && f.value === value);
  const isIncluded = filter && !filter.exclude;
  const isExcluded = filter && filter.exclude;

  row.classList.toggle('filter-included', !!isIncluded);
  row.classList.toggle('filter-excluded', !!isExcluded);

  const tag = row.querySelector('.filter-tag-indicator');
  if (tag) {
    updateFilterTagStyling(tag, isIncluded, isExcluded, dimCell?.dataset.bgColor || 'var(--text)');
  }

  if (dimCell) {
    dimCell.dataset.action = (isIncluded || isExcluded) ? 'remove-filter-value' : 'add-filter';
    dimCell.dataset.exclude = isExcluded ? 'true' : 'false';
  }
}

// Immediately update row styling when filter changes (before reload).
function updateRowFilterStyling(col, value) {
  document.querySelectorAll('.breakdown-card .breakdown-table tr[data-dim]').forEach((row) => {
    if (row.dataset.dim === value) {
      updateSingleRowFilterStyling(row, col, value);
    }
  });
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

export function addFilter(col, value, exclude, filterCol, filterValue, filterOp, skipReload) {
  // Remove existing filter for same col+value
  state.filters = state.filters.filter((f) => !(f.col === col && f.value === value));

  const filter = { col, value, exclude };

  // Use passed filter parameters if provided, otherwise look up from breakdown definition
  if (filterCol) {
    filter.filterCol = filterCol;
    filter.filterValue = filterValue ?? value;
    if (filterOp && filterOp !== '=') {
      filter.filterOp = filterOp;
    }
  } else {
    // Fallback: look up breakdown to get filterCol and filterValueFn if defined
    const bkdns = state.breakdowns?.length ? state.breakdowns : allBreakdowns;
    const breakdown = bkdns.find((b) => b.col === col);
    if (breakdown?.filterCol) {
      filter.filterCol = breakdown.filterCol;
      filter.filterValue = breakdown.filterValueFn ? breakdown.filterValueFn(value) : value;
      if (breakdown.filterOp) {
        filter.filterOp = breakdown.filterOp;
      }
    }
  }

  state.filters.push(filter);
  renderActiveFilters();
  updateRowFilterStyling(col, value); // Update UI immediately before reload
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

export function removeFilterByValue(col, value, skipReload) {
  state.filters = state.filters.filter((f) => !(f.col === col && f.value === value));
  renderActiveFilters();
  updateRowFilterStyling(col, value);
  if (!skipReload) {
    if (saveStateToURL) saveStateToURL();
    if (loadDashboard) loadDashboard();
  }
}
