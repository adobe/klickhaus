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

export function getFilterForValue(col, value) {
  return state.filters.find((f) => f.col === col && f.value === value);
}

// Immediately update row styling when filter changes (before reload)
// This prevents the old filter state from being visible during the blur
function updateRowFilterStyling(col, value) {
  // Find all facet cards
  const cards = document.querySelectorAll('.breakdown-card');
  
  cards.forEach((card) => {
    const table = card.querySelector('.breakdown-table');
    if (!table) return;
    
    // Find rows matching this column and value
    const rows = table.querySelectorAll(`tr[data-dim]`);
    rows.forEach((row) => {
      const rowValue = row.dataset.dim;
      if (rowValue !== value) return;
      
      // Get the current filter state for this value
      const filter = state.filters.find((f) => f.col === col && f.value === value);
      const isIncluded = filter && !filter.exclude;
      const isExcluded = filter && filter.exclude;
      
      // Update row classes
      row.classList.remove('filter-included', 'filter-excluded');
      if (isIncluded) {
        row.classList.add('filter-included');
      } else if (isExcluded) {
        row.classList.add('filter-excluded');
      }
      
      // Update the dim cell content to show new tag styling
      const dimCell = row.querySelector('td.dim');
      if (!dimCell) return;
      
      // Extract the color indicator and formatted text
      const colorIndicator = dimCell.querySelector('.status-color');
      const colorHtml = colorIndicator ? colorIndicator.outerHTML : '';
      
      // Get text content (without color indicator)
      let textContent = '';
      const textNodes = [];
      const walker = document.createTreeWalker(dimCell, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while ((node = walker.nextNode())) {
        textNodes.push(node.textContent.trim());
      }
      textContent = textNodes.filter(t => t).join('');
      
      // Extract color from indicator for background
      let bgColor = 'var(--text)';
      if (colorIndicator) {
        const style = colorIndicator.getAttribute('style') || '';
        const match = style.match(/background:\s*([^;"]+)/);
        if (match) bgColor = match[1];
      }
      
      // Rebuild dim cell with new styling
      if (isIncluded) {
        dimCell.innerHTML = `<span class="filter-tag-indicator active" style="background: ${bgColor}"><span class="filter-icon">✓</span>${textContent}</span>`;
      } else if (isExcluded) {
        dimCell.innerHTML = `<span class="filter-tag-indicator exclude" style="background: ${bgColor}"><span class="filter-icon">×</span>${textContent}</span>`;
      } else {
        // Restore original content (no filter)
        const link = row.querySelector('td.dim a');
        if (link) {
          dimCell.innerHTML = `${colorHtml}<a href="${link.href}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${textContent}</a>`;
        } else {
          dimCell.innerHTML = `${colorHtml}${textContent}`;
        }
      }
      
      // Re-add the action attributes
      dimCell.classList.add('dim-clickable');
      const filterAttrs = row.querySelector('[data-filter-col]');
      if (filterAttrs) {
        dimCell.dataset.col = filterAttrs.dataset.col || col;
        dimCell.dataset.value = filterAttrs.dataset.value || value;
        dimCell.dataset.filterCol = filterAttrs.dataset.filterCol || '';
        dimCell.dataset.filterValue = filterAttrs.dataset.filterValue || '';
        dimCell.dataset.filterOp = filterAttrs.dataset.filterOp || '';
        
        if (isIncluded) {
          dimCell.dataset.action = 'remove-filter-value';
          dimCell.dataset.exclude = 'false';
        } else if (isExcluded) {
          dimCell.dataset.action = 'remove-filter-value';
          dimCell.dataset.exclude = 'true';
        } else {
          dimCell.dataset.action = 'add-filter';
          dimCell.dataset.exclude = 'false';
        }
      }
    });
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
    const breakdown = allBreakdowns.find((b) => b.col === col);
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

export function removeFilterByValue(col, value) {
  state.filters = state.filters.filter((f) => !(f.col === col && f.value === value));
  renderActiveFilters();
  updateRowFilterStyling(col, value); // Update UI immediately before reload
  if (saveStateToURL) saveStateToURL();
  if (loadDashboard) loadDashboard();
}
