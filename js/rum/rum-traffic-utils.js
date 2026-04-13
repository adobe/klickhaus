/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * Utility functions for the RUM traffic view.
 * Extracted from the entry point for testability.
 */

import { TIME_RANGES } from '../constants.js';
import { formatNumber } from '../format.js';

/**
 * RUM-specific time range options (subset of TIME_RANGES).
 * Only these appear in the time range selector for RUM pages.
 */
const RUM_TIME_RANGE_ORDER = ['7d', '30d', '365d'];

/**
 * RUM breakdown facet definitions.
 * Maps DataChunks facet names to breakdown card IDs.
 */
export const RUM_BREAKDOWNS = [
  { id: 'breakdown-url', facetName: 'url', col: 'url' },
  { id: 'breakdown-userAgent', facetName: 'userAgent', col: 'userAgent' },
  { id: 'breakdown-checkpoint', facetName: 'checkpoint', col: 'checkpoint' },
];

/**
 * Compute start and end dates for RUM data fetching.
 * @param {string} timeRange - Current time range key (e.g., '7d', '30d', '365d')
 * @returns {{ startDate: Date, endDate: Date }}
 */
export function getRumDateRange(timeRange) {
  const end = new Date();
  const range = TIME_RANGES[timeRange];
  const periodMs = range ? range.periodMs : TIME_RANGES['7d'].periodMs;
  const start = new Date(end.getTime() - periodMs);
  return { startDate: start, endDate: end };
}

/**
 * Convert filter array to DataChunks filter format.
 * Only include filters (not excludes) as DataChunks only supports include.
 * @param {Array<{col: string, value: string, exclude: boolean}>} filters
 * @returns {object} e.g. { url: ['page1'], userAgent: ['desktop:windows'] }
 */
export function buildDataChunksFilters(filters) {
  const result = {};
  for (const f of filters) {
    if (!f.exclude) {
      if (!result[f.col]) {
        result[f.col] = [];
      }
      result[f.col].push(f.value);
    }
  }
  return result;
}

/**
 * Format LCP value for display.
 * @param {number} ms - LCP value in milliseconds
 * @returns {string}
 */
function formatLcp(ms) {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${Math.round(ms)}ms`;
}

/**
 * Render key metrics into the overlay element.
 * @param {object|null} totals - Totals from fetchRumData
 * @param {HTMLElement|null} overlay - The overlay DOM element
 */
export function renderKeyMetrics(totals, overlay) {
  if (!overlay) {
    return;
  }
  const el = overlay;
  if (!totals) {
    el.classList.remove('visible');
    return;
  }

  const bounceRate = totals.visits > 0
    ? Math.round((totals.bounces / totals.visits) * 100)
    : 0;

  el.innerHTML = `
    <div class="key-metric">
      <span class="key-metric-value">${formatNumber(totals.pageViews)}</span>
      <span class="key-metric-label">Page Views</span>
    </div>
    <div class="key-metric">
      <span class="key-metric-value">${formatNumber(totals.visits)}</span>
      <span class="key-metric-label">Visits</span>
    </div>
    <div class="key-metric">
      <span class="key-metric-value">${bounceRate}%</span>
      <span class="key-metric-label">Bounce Rate</span>
    </div>
    <div class="key-metric">
      <span class="key-metric-value">${formatLcp(totals.lcpP75)}</span>
      <span class="key-metric-label">LCP p75</span>
    </div>
    <div class="key-metric">
      <span class="key-metric-value">${totals.clsP75.toFixed(2)}</span>
      <span class="key-metric-label">CLS p75</span>
    </div>
    <div class="key-metric">
      <span class="key-metric-value">${Math.round(totals.inpP75)}ms</span>
      <span class="key-metric-label">INP p75</span>
    </div>
  `;
  el.classList.add('visible');
}

/**
 * Replace the time range select options with RUM-specific ranges.
 * @param {HTMLSelectElement|null} select
 * @param {string} currentTimeRange - Current state.timeRange value
 * @returns {string} Validated time range (may fall back to '7d')
 */
export function populateRumTimeRangeSelect(selectEl, currentTimeRange) {
  if (!selectEl) {
    return currentTimeRange;
  }
  const sel = selectEl;
  sel.innerHTML = '';
  for (const key of RUM_TIME_RANGE_ORDER) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = TIME_RANGES[key].label;
    sel.appendChild(option);
  }
  const validRange = RUM_TIME_RANGE_ORDER.includes(currentTimeRange) ? currentTimeRange : '7d';
  sel.value = validRange;
  return validRange;
}
