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
import { DEFAULT_TIME_RANGE, DEFAULT_TOP_N } from './constants.js';

const storage = (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function')
  ? localStorage
  : {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };

export const state = {
  credentials: null,
  timeRange: DEFAULT_TIME_RANGE,
  hostFilter: '',
  ownerRepoFilter: '',
  ownerRepoFilterExact: false, // true = exact match (=), false = LIKE search
  topN: DEFAULT_TOP_N,
  filters: [], // [{col: '`request.url`', value: '/foo', exclude: false}]
  logsData: null,
  logsLoading: false,
  logsReady: false,
  viewMode: 'filters', // 'filters' | 'logs' | 'split' — loaded per-dashboard by loadViewMode()
  pinnedColumns: JSON.parse(storage.getItem('pinnedColumns') || '[]'),
  logColumnWidths: JSON.parse(storage.getItem('logColumnWidths') || '{}'),
  hiddenControls: [], // ['timeRange', 'topN', 'host', 'refresh', 'logout', 'logs']
  title: '', // Custom title from URL
  chartData: null, // Store chart data for redrawing when view changes
  contentTypeMode: 'count', // 'count' or 'bytes' for content-types facet
  pinnedFacets: [], // Facet IDs pinned to top
  hiddenFacets: [], // Facet IDs hidden at bottom
  additionalWhereClause: '', // Additional WHERE clause for queries (e.g., delivery exclusions)
  tableName: 'delivery', // Table to query (e.g. lambda_logs for Lambda dashboard)
  logsTableName: null, // Override table for logs queries (falls back to tableName)
  timeSeriesTemplate: 'time-series', // SQL template name for chart (e.g. time-series-lambda)
  weightColumn: null, // When set (e.g. 'weight'), counts use sum(weight) / sumIf(weight, ...)
  aggregations: null, // Optional { aggTotal, aggOk, agg4xx, agg5xx } for non-CDN tables
  hostFilterColumn: null, // Optional column for header filter (e.g. function_name for lambda)
  searchFilter: '', // Free-text search routed to requestIdColumn (UUID input) or messageColumn
  requestIdColumn: null, // Column to exact-match when input is a UUID (e.g. request_id)
  messageColumn: null, // Column to substring-match otherwise (e.g. message)
  breakdowns: null, // Optional override breakdown list (e.g. lambda facets)
  logColumnOrder: null, // Optional preferred column ordering for the logs table
  userLogColumnOrder: null, // User-customised column order (per-dashboard, localStorage)
  hiddenLogColumns: [], // User-hidden columns (per-dashboard, localStorage)
};

function getViewModeKey() {
  return state.title ? `viewMode_${state.title}` : 'viewMode';
}

export function loadViewMode() {
  state.viewMode = storage.getItem(getViewModeKey()) || 'filters';
}

export function saveViewMode(mode) {
  storage.setItem(getViewModeKey(), mode);
}

// Callback for re-rendering logs table when pinned columns change
// Set by logs.js to avoid circular dependencies
let onPinnedColumnsChange = null;

export function setOnPinnedColumnsChange(callback) {
  onPinnedColumnsChange = callback;
}

export function togglePinnedColumn(col) {
  const idx = state.pinnedColumns.indexOf(col);
  if (idx === -1) {
    state.pinnedColumns.push(col);
  } else {
    state.pinnedColumns.splice(idx, 1);
  }
  storage.setItem('pinnedColumns', JSON.stringify(state.pinnedColumns));
  if (onPinnedColumnsChange && state.logsData) {
    onPinnedColumnsChange(state.logsData);
  }
}

export function setLogColumnWidth(col, width) {
  state.logColumnWidths[col] = width;
  storage.setItem('logColumnWidths', JSON.stringify(state.logColumnWidths));
}

export function resetLogColumnWidth(col) {
  if (col in state.logColumnWidths) {
    delete state.logColumnWidths[col];
    storage.setItem('logColumnWidths', JSON.stringify(state.logColumnWidths));
    if (onPinnedColumnsChange && state.logsData) {
      onPinnedColumnsChange(state.logsData);
    }
  }
}

// Get localStorage key for facet preferences (keyed by title if present)
function getFacetPrefsKey() {
  return state.title ? `facetPrefs_${state.title}` : 'facetPrefs';
}

// Load facet preferences from localStorage
export function loadFacetPrefs() {
  const key = getFacetPrefsKey();
  try {
    const prefs = JSON.parse(storage.getItem(key) || '{}');
    state.pinnedFacets = prefs.pinned || [];
    state.hiddenFacets = prefs.hidden || [];
  } catch (e) {
    state.pinnedFacets = [];
    state.hiddenFacets = [];
  }
}

// Save facet preferences to localStorage
function saveFacetPrefs() {
  const key = getFacetPrefsKey();
  storage.setItem(key, JSON.stringify({
    pinned: state.pinnedFacets,
    hidden: state.hiddenFacets,
  }));
}

// Callback for facet order changes
let onFacetOrderChange = null;

export function setOnFacetOrderChange(callback) {
  onFacetOrderChange = callback;
}

// Toggle pinned state for a facet
export function togglePinnedFacet(facetId) {
  const idx = state.pinnedFacets.indexOf(facetId);
  if (idx === -1) {
    state.pinnedFacets.push(facetId);
    // If it was hidden, unhide it
    const hiddenIdx = state.hiddenFacets.indexOf(facetId);
    if (hiddenIdx !== -1) {
      state.hiddenFacets.splice(hiddenIdx, 1);
    }
  } else {
    state.pinnedFacets.splice(idx, 1);
  }
  saveFacetPrefs();
  if (onFacetOrderChange) {
    onFacetOrderChange();
  }
}

// Get localStorage key for log column preferences (keyed by title if present)
function getLogColumnPrefsKey() {
  return state.title ? `logColumnPrefs_${state.title}` : 'logColumnPrefs';
}

let onLogColumnPrefsChange = null;

export function setOnLogColumnPrefsChange(callback) {
  onLogColumnPrefsChange = callback;
}

export function loadLogColumnPrefs() {
  const key = getLogColumnPrefsKey();
  try {
    const prefs = JSON.parse(storage.getItem(key) || '{}');
    state.userLogColumnOrder = Array.isArray(prefs.order) ? prefs.order : null;
    state.hiddenLogColumns = Array.isArray(prefs.hidden) ? prefs.hidden : [];
  } catch (e) {
    state.userLogColumnOrder = null;
    state.hiddenLogColumns = [];
  }
}

export function saveLogColumnPrefs(order, hidden) {
  state.userLogColumnOrder = Array.isArray(order) && order.length > 0 ? order : null;
  state.hiddenLogColumns = Array.isArray(hidden) ? hidden : [];
  const key = getLogColumnPrefsKey();
  storage.setItem(key, JSON.stringify({
    order: state.userLogColumnOrder,
    hidden: state.hiddenLogColumns,
  }));
  if (onLogColumnPrefsChange && state.logsData) {
    onLogColumnPrefsChange(state.logsData);
  }
}

// Toggle hidden state for a facet
export function toggleHiddenFacet(facetId) {
  const idx = state.hiddenFacets.indexOf(facetId);
  const wasHidden = idx !== -1;

  if (!wasHidden) {
    state.hiddenFacets.push(facetId);
    // If it was pinned, unpin it
    const pinnedIdx = state.pinnedFacets.indexOf(facetId);
    if (pinnedIdx !== -1) {
      state.pinnedFacets.splice(pinnedIdx, 1);
    }
  } else {
    state.hiddenFacets.splice(idx, 1);
  }
  saveFacetPrefs();
  if (onFacetOrderChange) {
    onFacetOrderChange(facetId);
  }
}
