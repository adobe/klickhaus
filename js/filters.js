// Filter management
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

export function getFiltersForColumn(col) {
  return state.filters.filter(f => f.col === col);
}

export function clearFiltersForColumn(col) {
  state.filters = state.filters.filter(f => f.col !== col);
  renderActiveFilters();
  if (saveStateToURL) saveStateToURL();
  if (loadDashboard) loadDashboard();
}

export function addFilter(col, value, exclude) {
  // Remove existing filter for same col+value
  state.filters = state.filters.filter(f => !(f.col === col && f.value === value));

  // Look up breakdown to get filterCol and filterValueFn if defined
  const breakdown = allBreakdowns.find(b => b.col === col);
  const filter = { col, value, exclude };
  if (breakdown?.filterCol) {
    filter.filterCol = breakdown.filterCol;
    filter.filterValue = breakdown.filterValueFn ? breakdown.filterValueFn(value) : value;
  }

  state.filters.push(filter);
  renderActiveFilters();
  if (saveStateToURL) saveStateToURL();
  if (loadDashboard) loadDashboard();
}

export function removeFilter(index) {
  state.filters.splice(index, 1);
  renderActiveFilters();
  if (saveStateToURL) saveStateToURL();
  if (loadDashboard) loadDashboard();
}

export function removeFilterByValue(col, value) {
  state.filters = state.filters.filter(f => !(f.col === col && f.value === value));
  renderActiveFilters();
  if (saveStateToURL) saveStateToURL();
  if (loadDashboard) loadDashboard();
}

export function renderActiveFilters() {
  const container = document.getElementById('activeFilters');
  if (state.filters.length === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = state.filters.map((f, i) => {
    const label = f.exclude ? `NOT ${f.value}` : f.value;
    // Get color indicator using unified color system
    const colorIndicator = getColorIndicatorHtml(f.col, f.value, 'filter-color');
    return `<span class="filter-tag ${f.exclude ? 'exclude' : ''}">${colorIndicator}${escapeHtml(label)}<button onclick="removeFilter(${i})">×</button></span>`;
  }).join('');
}
