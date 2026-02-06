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
  topN: DEFAULT_TOP_N,
  filters: [], // [{col: '`request.url`', value: '/foo', exclude: false}]
  logsData: null,
  logsLoading: false,
  logsReady: false,
  showLogs: false,
  pinnedColumns: JSON.parse(storage.getItem('pinnedColumns') || '[]'),
  hiddenControls: [], // ['timeRange', 'topN', 'host', 'refresh', 'logout', 'logs']
  title: '', // Custom title from URL
  chartData: null, // Store chart data for redrawing when view changes
  contentTypeMode: 'count', // 'count' or 'bytes' for content-types facet
  pinnedFacets: [], // Facet IDs pinned to top
  hiddenFacets: [], // Facet IDs hidden at bottom
  additionalWhereClause: '', // Additional WHERE clause for queries (e.g., delivery exclusions)
  tableName: 'cdn_requests_v2', // Table to query (e.g. lambda_logs for Lambda dashboard)
  timeSeriesTemplate: 'time-series', // SQL template name for chart (e.g. time-series-lambda)
  aggregations: null, // Optional { aggTotal, aggOk, agg4xx, agg5xx } for non-CDN tables
  hostFilterColumn: null, // Optional column for header filter (e.g. function_name for lambda)
  breakdowns: null, // Optional override breakdown list (e.g. lambda facets)
};

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
  if (onFacetOrderChange) onFacetOrderChange();
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
  if (onFacetOrderChange) onFacetOrderChange(facetId);
}
