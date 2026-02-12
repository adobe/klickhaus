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
import { state, loadFacetPrefs } from './state.js';
import {
  queryTimestamp, setQueryTimestamp, customTimeRange, setCustomTimeRange, clearCustomTimeRange,
} from './time.js';
import { renderActiveFilters } from './filters.js';
import {
  DEFAULT_TIME_RANGE, DEFAULT_TOP_N, TIME_RANGES, TOP_N_OPTIONS,
} from './constants.js';
import { isValidFilterColumn, isValidFilterOp } from './filter-sql.js';

// DOM elements (set by main.js)
let elements = {};

// Track last saved URL to detect real changes
let lastSavedURL = null;

// Callback to reload dashboard (set by main.js)
let onStateRestored = null;

// Callback to run before restoring state (e.g., invalidate caches)
let onBeforeRestore = null;

export function setOnBeforeRestore(callback) {
  onBeforeRestore = callback;
}

export function setOnStateRestored(callback) {
  onStateRestored = callback;
}

export function setUrlStateElements(els) {
  elements = els;
}

/**
 * Add basic state parameters to URL params
 */
function addBasicParams(params) {
  if (state.timeRange !== DEFAULT_TIME_RANGE) params.set('t', state.timeRange);
  if (state.hostFilter) params.set('host', state.hostFilter);
  if (state.topN !== DEFAULT_TOP_N) params.set('n', state.topN);
  if (state.showLogs) params.set('view', 'logs');
  if (state.title) params.set('title', state.title);
  if (state.contentTypeMode !== 'count') params.set('ctm', state.contentTypeMode);
}

/**
 * Add time range parameters to URL params
 */
function addTimeParams(params) {
  const ctr = customTimeRange();
  const qts = queryTimestamp();
  if (ctr) {
    params.set('ts', ctr.start.toISOString());
    params.set('te', ctr.end.toISOString());
  } else if (qts) {
    params.set('ts', qts.toISOString());
  }
}

/**
 * Add anomaly focus parameter to URL params
 */
function addAnomalyParam(params, newAnomalyId) {
  if (newAnomalyId !== undefined) {
    if (newAnomalyId) params.set('anomaly', newAnomalyId);
  } else {
    const currentAnomaly = new URLSearchParams(window.location.search).get('anomaly');
    if (currentAnomaly) params.set('anomaly', currentAnomaly);
  }
}

export function saveStateToURL(newAnomalyId = undefined) {
  const params = new URLSearchParams();

  addBasicParams(params);
  addTimeParams(params);

  if (state.filters.length > 0) {
    params.set('filters', JSON.stringify(state.filters));
  }

  addAnomalyParam(params, newAnomalyId);

  if (state.pinnedFacets.length > 0) params.set('pf', state.pinnedFacets.join(','));
  if (state.hiddenFacets.length > 0) params.set('hf', state.hiddenFacets.join(','));

  const newURL = params.toString()
    ? `${window.location.pathname}?${params}`
    : window.location.pathname;

  if (newURL !== lastSavedURL) {
    if (lastSavedURL === null) {
      window.history.replaceState({}, '', newURL);
    } else {
      window.history.pushState({}, '', newURL);
    }
    lastSavedURL = newURL;
  }
}

/**
 * Load basic state from URL params
 */
function loadBasicState(params) {
  if (params.has('t') && TIME_RANGES[params.get('t')]) {
    state.timeRange = params.get('t');
  }
  if (params.has('host')) state.hostFilter = params.get('host');
  if (params.has('n')) {
    const n = parseInt(params.get('n'), 10);
    if (TOP_N_OPTIONS.includes(n)) state.topN = n;
  }
  if (params.get('view') === 'logs') state.showLogs = true;
  if (params.has('title')) state.title = params.get('title');
  if (params.has('ctm') && ['count', 'bytes'].includes(params.get('ctm'))) {
    state.contentTypeMode = params.get('ctm');
  }
  if (params.has('hide')) {
    state.hiddenControls = params.get('hide').split(',').filter((c) => c);
  }
}

/**
 * Load time state from URL params
 */
function loadTimeState(params) {
  if (!params.has('ts')) return;

  const ts = new Date(params.get('ts'));
  if (Number.isNaN(ts.getTime())) return;

  if (params.has('te')) {
    const te = new Date(params.get('te'));
    if (!Number.isNaN(te.getTime())) setCustomTimeRange(ts, te);
  } else {
    setQueryTimestamp(ts);
  }
}

/**
 * Parse and validate a filter object
 */
function parseFilter(f) {
  if (!f.col || typeof f.value !== 'string' || typeof f.exclude !== 'boolean') {
    return null;
  }
  const filter = { col: f.col, value: f.value, exclude: f.exclude };
  if (f.filterCol) filter.filterCol = f.filterCol;
  if (f.filterValue !== undefined) filter.filterValue = f.filterValue;
  if (f.filterOp) filter.filterOp = f.filterOp;

  const sqlCol = filter.filterCol || filter.col;
  const sqlOp = filter.filterOp || '=';
  return isValidFilterColumn(sqlCol) && isValidFilterOp(sqlOp) ? filter : null;
}

/**
 * Load filters from URL params
 */
function loadFiltersState(params) {
  if (!params.has('filters')) return;

  try {
    const filters = JSON.parse(params.get('filters'));
    if (Array.isArray(filters)) {
      state.filters = filters.map(parseFilter).filter(Boolean);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to parse filters from URL:', e);
  }
}

export function loadStateFromURL() {
  const params = new URLSearchParams(window.location.search);

  loadBasicState(params);
  loadTimeState(params);
  loadFiltersState(params);

  if (params.has('pinned')) {
    const pinned = params.get('pinned').split(',').filter((c) => c);
    if (pinned.length > 0) state.pinnedColumns = pinned;
  }

  loadFacetPrefs();

  if (params.has('pf')) state.pinnedFacets = params.get('pf').split(',').filter((f) => f);
  if (params.has('hf')) state.hiddenFacets = params.get('hf').split(',').filter((f) => f);
}

export function syncUIFromState() {
  // Show "Custom" in dropdown when in custom time range, otherwise show predefined
  if (customTimeRange()) {
    elements.timeRangeSelect.value = 'custom';
  } else {
    elements.timeRangeSelect.value = state.timeRange;
  }
  elements.topNSelect.value = state.topN;
  document.body.dataset.topn = state.topN;
  elements.hostFilterInput.value = state.hostFilter;
  renderActiveFilters();

  // Update title if custom title is set
  const titleEl = document.getElementById('dashboardTitle');
  if (state.title) {
    titleEl.textContent = state.title;
    document.title = `${state.title} - CDN Analytics`;
  } else {
    titleEl.textContent = 'CDN Analytics';
    document.title = 'CDN Analytics';
  }

  // Update view toggle based on state
  if (state.showLogs) {
    elements.logsView.classList.add('visible');
    elements.filtersView.classList.remove('visible');
    elements.viewToggleBtn.querySelector('.menu-item-label').textContent = 'View Filters';
    // Activate flex layout for logs view
    const dc = document.getElementById('dashboardContent');
    if (dc) dc.classList.add('logs-active');
    // Restore chart collapse state from localStorage
    const chartSection = document.querySelector('.chart-section');
    if (chartSection && localStorage.getItem('chartCollapsed') === 'true') {
      chartSection.classList.add('chart-collapsed');
    }
  } else {
    elements.logsView.classList.remove('visible');
    elements.filtersView.classList.add('visible');
    elements.viewToggleBtn.querySelector('.menu-item-label').textContent = 'View Logs';
  }

  // Apply hidden controls from URL
  if (state.hiddenControls.includes('timeRange')) {
    elements.timeRangeSelect.style.display = 'none';
  }
  if (state.hiddenControls.includes('topN')) {
    elements.topNSelect.style.display = 'none';
  }
  if (state.hiddenControls.includes('host')) {
    elements.hostFilterInput.style.display = 'none';
  }
  if (state.hiddenControls.includes('refresh')) {
    elements.refreshBtn.style.display = 'none';
  }
  if (state.hiddenControls.includes('logout')) {
    elements.logoutBtn.style.display = 'none';
  }
  if (state.hiddenControls.includes('logs')) {
    elements.viewToggleBtn.style.display = 'none';
  }
}

// Handle browser back/forward navigation
window.addEventListener('popstate', () => {
  // Update lastSavedURL to current location to prevent pushState on reload
  lastSavedURL = window.location.pathname + window.location.search;
  if (lastSavedURL === window.location.pathname) {
    lastSavedURL = window.location.pathname;
  }

  // Clear custom time range before loading (will be restored if in URL)
  clearCustomTimeRange();

  // Clear caches before restoring state (e.g., investigation cache)
  if (onBeforeRestore) onBeforeRestore();

  // Reload state from the new URL
  loadStateFromURL();
  syncUIFromState();

  // Trigger dashboard reload if callback is set
  if (onStateRestored) {
    onStateRestored();
  }
});
