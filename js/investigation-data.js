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

/**
 * Data plane for anomaly investigation - handles queries, caching, and ID generation.
 * UI concerns (highlighting, DOM manipulation) are in anomaly-investigation.js.
 */

import { query } from './api.js';
import { DATABASE } from './config.js';
import { state } from './state.js';
import { getTable, getHostFilter, getTimeFilter } from './time.js';
import { getFacetFilters } from './breakdowns/index.js';
import { compileFilters, isFilterSuperset } from './filter-sql.js';
import { loadSql } from './sql-loader.js';

// Cache version - increment when cache format or algorithm changes
const CACHE_VERSION = 3;

// Number of contributors to cache vs highlight
export const CACHE_TOP_N = 30;
export const HIGHLIGHT_TOP_N = 3;

// Car-themed word lists for generating stable IDs
const CAR_ADJECTIVES = [
  'alpine', 'azure', 'blazing', 'bold', 'brilliant', 'chrome', 'classic',
  'coastal', 'cosmic', 'crimson', 'crystal', 'daring', 'dazzling', 'dusty',
  'electric', 'elegant', 'ember', 'emerald', 'fierce', 'fiery', 'flash',
  'forest', 'frozen', 'gentle', 'gilded', 'gleaming', 'golden', 'granite',
  'hidden', 'highland', 'icy', 'ivory', 'jade', 'jet', 'lunar', 'marble',
  'midnight', 'misty', 'moonlit', 'neon', 'noble', 'obsidian', 'ocean',
  'onyx', 'opulent', 'pearl', 'phantom', 'polar', 'pristine', 'radiant',
  'raven', 'royal', 'ruby', 'rustic', 'sable', 'sapphire', 'scarlet',
  'shadow', 'silent', 'silver', 'sleek', 'smoky', 'solar', 'sonic',
  'speedy', 'starlit', 'steel', 'storm', 'sunset', 'swift', 'teal',
  'thunder', 'titan', 'turbo', 'twilight', 'velvet', 'vintage', 'violet',
  'wild', 'winter', 'zephyr',
];

// Car colors organized by severity for anomaly ID generation
const CAR_COLORS_RED = [
  'burgundy', 'cardinal', 'carmine', 'cerise', 'cherry', 'claret', 'coral',
  'cranberry', 'crimson', 'garnet', 'magenta', 'maroon', 'raspberry', 'rose',
  'ruby', 'russet', 'rust', 'scarlet', 'vermillion', 'wine',
];

const CAR_COLORS_ORANGE = [
  'amber', 'apricot', 'bronze', 'burnt', 'butterscotch', 'caramel', 'carrot',
  'cinnamon', 'copper', 'flame', 'ginger', 'gold', 'honey', 'marigold',
  'melon', 'ochre', 'orange', 'papaya', 'peach', 'pumpkin', 'saffron',
  'sand', 'sienna', 'tan', 'tangerine', 'tawny', 'topaz', 'yellow',
];

const CAR_COLORS_COOL = [
  'aqua', 'azure', 'blue', 'cerulean', 'chartreuse', 'cobalt', 'cyan',
  'emerald', 'forest', 'green', 'hunter', 'indigo', 'jade', 'lagoon',
  'lime', 'mint', 'navy', 'olive', 'pacific', 'pine', 'sage', 'seafoam',
  'spruce', 'teal', 'turquoise', 'verdant', 'viridian',
];

const CAR_MODELS = [
  'accord', 'alpine', 'beetle', 'boxster', 'bronco', 'camaro', 'camry',
  'cayenne', 'challenger', 'charger', 'civic', 'cobra', 'continental',
  'corolla', 'corvette', 'defender', 'elantra', 'escort', 'explorer',
  'firebird', 'focus', 'frontier', 'fury', 'galaxie', 'giulia', 'gto',
  'impala', 'jetta', 'lancer', 'landcruiser', 'maverick', 'miata', 'monte',
  'mustang', 'navigator', 'nova', 'outback', 'panda', 'pantera', 'passat',
  'pathfinder', 'pinto', 'porsche', 'prelude', 'prius', 'quattro', 'rabbit',
  'ranger', 'raptor', 'roadster', 'safari', 'scirocco', 'senna', 'shelby',
  'sierra', 'skyline', 'solara', 'sonata', 'spark', 'spider', 'stingray',
  'supra', 'tacoma', 'tempest', 'tercel', 'thunderbird', 'tiguan', 'torino',
  'tundra', 'vantage', 'viper', 'wrangler', 'zephyr',
];

/**
 * Generate a simple hash from a string
 * @param {string} str - String to hash
 * @returns {number} Hash value
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    const char = str.charCodeAt(i);
    // eslint-disable-next-line no-bitwise
    hash = ((hash << 5) - hash) + char;
    // eslint-disable-next-line no-bitwise
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Round a date to the nearest minute for cache stability
 * @param {Date} date - Date to round
 * @returns {string} ISO string rounded to minute
 */
function roundToMinute(date) {
  const d = new Date(date);
  d.setSeconds(0, 0);
  // Round to nearest minute
  if (date.getSeconds() >= 30) {
    d.setMinutes(d.getMinutes() + 1);
  }
  return d.toISOString();
}

/**
 * Generate a stable car-themed ID for an anomaly
 * @param {string} baseTimeRange - The base time filter
 * @param {string} baseFilters - The active filters
 * @param {Date} anomalyStart - Anomaly start time
 * @param {Date} anomalyEnd - Anomaly end time
 * @param {string} category - Anomaly category: 'red' (5xx), 'yellow' (4xx), or 'green' (2xx/3xx)
 * @returns {string} Car-themed ID like "opulent-crimson-miata"
 */
export function generateAnomalyId(baseTimeRange, baseFilters, anomalyStart, anomalyEnd, category = 'green') {
  // Create a stable string from the inputs (round timestamps to minute for cache stability)
  const inputStr = [
    baseTimeRange,
    baseFilters,
    roundToMinute(anomalyStart),
    roundToMinute(anomalyEnd),
  ].join('|');

  const hash = simpleHash(inputStr);

  // Select color list based on anomaly category (severity)
  let colorList;
  switch (category) {
    case 'red':
      colorList = CAR_COLORS_RED;
      break;
    case 'yellow':
      colorList = CAR_COLORS_ORANGE;
      break;
    default:
      colorList = CAR_COLORS_COOL;
  }

  // Use different parts of the hash to select words
  const adjIdx = hash % CAR_ADJECTIVES.length;
  const colorIdx = Math.floor(hash / CAR_ADJECTIVES.length) % colorList.length;
  const modelIdx = Math.floor(
    hash / (CAR_ADJECTIVES.length * colorList.length),
  ) % CAR_MODELS.length;

  return `${CAR_ADJECTIVES[adjIdx]}-${colorList[colorIdx]}-${CAR_MODELS[modelIdx]}`;
}

/**
 * Get current query context as a structured object for cache comparison
 * @returns {Object} Query context with time, host, and filters
 */
export function getQueryContext() {
  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const { map: filterMap } = compileFilters(state.filters);

  return { timeFilter, hostFilter, filterMap };
}

/**
 * Generate cache key based only on time and host (base dataset)
 * @returns {string} Cache key
 */
export function generateCacheKey() {
  const { timeFilter, hostFilter } = getQueryContext();
  return simpleHash(`${timeFilter}|${hostFilter}`).toString(36);
}

/**
 * Check if current context is eligible to use a cached investigation
 * Eligible if: same time, same host, and current filters are a superset of cached filters
 * @param {Object} cachedContext - The cached query context
 * @returns {boolean} True if cache is eligible
 */
export function isCacheEligible(cachedContext) {
  const current = getQueryContext();

  // Time must match exactly
  if (current.timeFilter !== cachedContext.timeFilter) {
    // eslint-disable-next-line no-console
    console.log('Cache ineligible: time filter changed');
    return false;
  }

  // Host filter must match exactly
  if (current.hostFilter !== cachedContext.hostFilter) {
    // eslint-disable-next-line no-console
    console.log('Cache ineligible: host filter changed');
    return false;
  }

  // Current filters must be a superset of cached filters (drill-in allowed, drill-out not)
  if (!isFilterSuperset(current.filterMap, cachedContext.filterMap || {})) {
    // eslint-disable-next-line no-console
    console.log('Cache ineligible: filters changed or removed');
    return false;
  }

  // All checks passed - current is same or superset of cached
  const cachedFilterCount = Object.keys(cachedContext.filterMap || {}).length;
  const currentFilterCount = Object.keys(current.filterMap).length;
  if (currentFilterCount > cachedFilterCount) {
    // eslint-disable-next-line no-console
    console.log(`Cache eligible: drilled in (${cachedFilterCount} → ${currentFilterCount} filters)`);
  } else {
    // eslint-disable-next-line no-console
    console.log('Cache eligible: same context');
  }
  return true;
}

/**
 * Load cached investigation from localStorage
 * @param {string} cacheKey - Cache key
 * @returns {Object|null} Cached data or null (includes context for eligibility check)
 */
export function loadCachedInvestigation(cacheKey) {
  try {
    const cached = localStorage.getItem(`anomaly_investigation_${cacheKey}`);
    if (!cached) {
      // eslint-disable-next-line no-console
      console.log(`No cache found for key: ${cacheKey}`);
      return null;
    }
    const data = JSON.parse(cached);
    // Check cache version matches and cache is less than 1 hour old
    if (data.version !== CACHE_VERSION) {
      // eslint-disable-next-line no-console
      console.log(`Cache version mismatch: ${data.version} vs ${CACHE_VERSION}`);
      return null;
    }
    if (Date.now() - data.timestamp >= 60 * 60 * 1000) {
      // eslint-disable-next-line no-console
      console.log('Cache expired (older than 1 hour)');
      return null;
    }
    // Check if current context is eligible (same or drill-in from cached context)
    if (data.context && isCacheEligible(data.context)) {
      // eslint-disable-next-line no-console
      console.log(`Cache loaded: ${data.topContributors?.length || 0} contributors`);
      return data;
    } else if (!data.context) {
      // Old cache format without context - still usable if key matches exactly
      // eslint-disable-next-line no-console
      console.log('Cache eligible: old format (no context)');
      return data;
    }
    // Eligibility check failed - logged inside isCacheEligible
    return null;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Failed to load cached investigation:', e);
  }
  return null;
}

/**
 * Save investigation to localStorage cache
 * @param {string} cacheKey - Cache key
 * @param {Object} data - Investigation data
 */
export function saveCachedInvestigation(cacheKey, data) {
  try {
    const context = getQueryContext();
    localStorage.setItem(`anomaly_investigation_${cacheKey}`, JSON.stringify({
      ...data,
      context,
      version: CACHE_VERSION,
      timestamp: Date.now(),
    }));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Failed to cache investigation:', e);
  }
}

/**
 * Clear old investigation caches (keep last 10)
 */
export function cleanupOldCaches() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith('anomaly_investigation_')) {
        const data = JSON.parse(localStorage.getItem(key));
        keys.push({ key, timestamp: data.timestamp || 0 });
      }
    }
    // Sort by timestamp descending, remove all but the 10 most recent
    keys.sort((a, b) => b.timestamp - a.timestamp);
    keys.slice(10).forEach(({ key }) => localStorage.removeItem(key));
  } catch (_e) {
    // Ignore cleanup errors
  }
}

/**
 * Clear all investigation caches from localStorage
 */
export function clearAllInvestigationCaches() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith('anomaly_investigation_')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
    // eslint-disable-next-line no-console
    console.log(`Cleared ${keysToRemove.length} investigation caches from localStorage`);
  } catch (_e) {
    // Ignore cleanup errors
  }
}

/**
 * Build a time filter SQL clause for a specific time window.
 * Uses minute-aligned timestamps to enable projection usage.
 * @param {Date} start - Window start time
 * @param {Date} end - Window end time
 * @returns {string} SQL WHERE clause
 */
export function buildTimeFilter(start, end) {
  const startIso = start.toISOString().replace('T', ' ').slice(0, 19);
  const endIso = end.toISOString().replace('T', ' ').slice(0, 19);
  // Use minute-aligned filtering to enable projection usage (up to 1 minute imprecision)
  return `toStartOfMinute(timestamp) BETWEEN toStartOfMinute(toDateTime('${startIso}')) AND toStartOfMinute(toDateTime('${endIso}'))`;
}

/**
 * Get the status filter SQL based on anomaly category
 * @param {string} category - 'red' (5xx), 'yellow' (4xx), or 'green' (2xx/3xx)
 * @returns {string} SQL condition
 */
export function getCategoryFilter(category) {
  switch (category) {
    case 'red':
      return '`response.status` >= 500';
    case 'yellow':
      return '`response.status` >= 400 AND `response.status` < 500';
    case 'green':
      return '`response.status` < 400';
    default:
      return '1=1';
  }
}

/**
 * Build minute-aligned time filter for inner projection query
 * @param {Date} start - Window start time
 * @param {Date} end - Window end time
 * @returns {string} SQL condition for minute column
 */
function buildMinuteFilter(start, end) {
  const startIso = start.toISOString().replace('T', ' ').slice(0, 19);
  const endIso = end.toISOString().replace('T', ' ').slice(0, 19);
  return `minute BETWEEN toStartOfMinute(toDateTime('${startIso}')) AND toStartOfMinute(toDateTime('${endIso}'))`;
}

/**
 * Get the category count column based on anomaly category
 * @param {string} category - 'red' (5xx), 'yellow' (4xx), or 'green' (2xx/3xx)
 * @returns {string} Column expression for category count
 */
function getCategoryCountExpr(category) {
  switch (category) {
    case 'red':
      return 'cnt_5xx';
    case 'yellow':
      return 'cnt_4xx';
    case 'green':
      return 'cnt_ok';
    default:
      return 'cnt';
  }
}

/**
 * Query a single facet comparing anomaly window vs baseline.
 * Uses two-level aggregation to leverage minute-level projections.
 * @param {Object} breakdown - Breakdown definition
 * @param {Object} anomaly - Detected anomaly with time bounds
 * @param {Date} fullStart - Full time range start
 * @param {Date} fullEnd - Full time range end
 * @returns {Promise<Array>} Facet values with change analysis
 */
export async function investigateFacet(breakdown, anomaly, fullStart, fullEnd) {
  const col = typeof breakdown.col === 'function'
    ? breakdown.col(state.topN)
    : breakdown.col;

  const extra = breakdown.extraFilter || '';
  const hostFilter = getHostFilter();
  const facetFilters = getFacetFilters();
  const catCountExpr = getCategoryCountExpr(anomaly.category);

  // Minute-aligned filters for anomaly window detection in outer query
  const anomalyMinuteFilter = buildMinuteFilter(anomaly.startTime, anomaly.endTime);

  // Two-level aggregation:
  // 1. Inner query: aggregate by (minute, dim) with status counts - uses projection
  // 2. Outer query: sum across minutes, splitting anomaly vs baseline windows
  const sql = await loadSql('investigate-facet', {
    anomalyMinuteFilter,
    col,
    catCountExpr,
    database: DATABASE,
    table: getTable(),
    timeFilter: buildTimeFilter(fullStart, fullEnd),
    hostFilter,
    facetFilters,
    extra,
  });

  try {
    const result = await query(sql, { cacheTtl: 60 });

    // Calculate anomaly and baseline durations in ms
    const anomalyDurationMs = anomaly.endTime - anomaly.startTime;
    const baselineDurationMs = (fullEnd - fullStart) - anomalyDurationMs;

    // Normalize to rate per minute for fair comparison
    const anomalyMinutes = anomalyDurationMs / 60000;
    const baselineMinutes = baselineDurationMs / 60000;

    // Calculate totals for share computation
    const totalAnomalyCatCnt = result.data.reduce(
      (sum, r) => sum + parseInt(r.anomaly_cat_cnt || 0, 10),
      0,
    );
    const totalBaselineCatCnt = result.data.reduce(
      (sum, r) => sum + parseInt(r.baseline_cat_cnt || 0, 10),
      0,
    );

    // Analyze each facet value
    const analyzed = result.data.map((row) => {
      const anomalyCatCnt = parseInt(row.anomaly_cat_cnt, 10) || 0;
      const baselineCatCnt = parseInt(row.baseline_cat_cnt, 10) || 0;
      const anomalyTotalCnt = parseInt(row.anomaly_total_cnt, 10) || 0;
      const baselineTotalCnt = parseInt(row.baseline_total_cnt, 10) || 0;

      // Normalize to rate per minute
      const anomalyRate = anomalyMinutes > 0 ? anomalyCatCnt / anomalyMinutes : 0;
      const baselineRate = baselineMinutes > 0 ? baselineCatCnt / baselineMinutes : 0;

      // Calculate percentage change in rate
      let rateChange = 0;
      if (baselineRate > 0) {
        rateChange = ((anomalyRate - baselineRate) / baselineRate) * 100;
      } else if (anomalyRate > 0) {
        rateChange = Infinity; // New during anomaly
      }

      // Calculate share of category during anomaly vs baseline
      const anomalyShare = totalAnomalyCatCnt > 0
        ? (anomalyCatCnt / totalAnomalyCatCnt) * 100
        : 0;
      const baselineShare = totalBaselineCatCnt > 0
        ? (baselineCatCnt / totalBaselineCatCnt) * 100
        : 0;
      // Positive = over-represented during anomaly
      const shareChange = anomalyShare - baselineShare;

      // Calculate error rate for this dimension (category errors / total requests)
      const anomalyErrorRate = anomalyTotalCnt > 0
        ? (anomalyCatCnt / anomalyTotalCnt) * 100
        : 0;
      const baselineErrorRate = baselineTotalCnt > 0
        ? (baselineCatCnt / baselineTotalCnt) * 100
        : 0;
      const errorRateChange = anomalyErrorRate - baselineErrorRate;

      return {
        dim: row.dim,
        anomalyRate: Math.round(anomalyRate * 10) / 10,
        baselineRate: Math.round(baselineRate * 10) / 10,
        rateChange: Math.round(rateChange * 10) / 10,
        anomalyShare: Math.round(anomalyShare * 10) / 10,
        baselineShare: Math.round(baselineShare * 10) / 10,
        shareChange: Math.round(shareChange * 10) / 10,
        errorRateChange: Math.round(errorRateChange * 10) / 10,
      };
    });

    // Filter to meaningful results:
    // - Share increased by >5 percentage points (over-represented during anomaly)
    // - OR error rate increased by >5 percentage points
    // - Must have some volume (anomalyRate > 0.5/min)
    return analyzed
      .filter((r) => r.anomalyRate > 0.5 && (r.shareChange > 5 || r.errorRateChange > 5))
      .sort((a, b) => b.shareChange - a.shareChange)
      .slice(0, 5);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Investigation error for ${breakdown.id}:`, err.message);
    return [];
  }
}

/**
 * Query a facet for selection investigation (compares selection vs rest of time range).
 * Uses two-level aggregation to leverage minute-level projections.
 * Looks at error rates to find dimensions with changed behavior.
 * @param {Object} breakdown - Breakdown definition
 * @param {Object} selection - Selection with startTime/endTime
 * @param {Date} fullStart - Full time range start
 * @param {Date} fullEnd - Full time range end
 * @returns {Promise<Array>} Facet values with change analysis
 */
export async function investigateFacetForSelection(breakdown, selection, fullStart, fullEnd) {
  const col = typeof breakdown.col === 'function'
    ? breakdown.col(state.topN)
    : breakdown.col;

  const extra = breakdown.extraFilter || '';
  const hostFilter = getHostFilter();
  const facetFilters = getFacetFilters();

  // Minute-aligned filter for selection window detection in outer query
  const selectionMinuteFilter = buildMinuteFilter(selection.startTime, selection.endTime);

  // Two-level aggregation:
  // 1. Inner query: aggregate by (minute, dim) with status counts - uses projection
  // 2. Outer query: sum across minutes, splitting selection vs baseline windows
  const sql = await loadSql('investigate-selection', {
    selectionMinuteFilter,
    col,
    database: DATABASE,
    table: getTable(),
    timeFilter: buildTimeFilter(fullStart, fullEnd),
    hostFilter,
    facetFilters,
    extra,
  });

  try {
    const result = await query(sql, { cacheTtl: 60 });

    // Calculate durations for rate normalization
    const selectionDurationMs = selection.endTime - selection.startTime;
    const baselineDurationMs = (fullEnd - fullStart) - selectionDurationMs;
    const selectionMinutes = selectionDurationMs / 60000;
    const baselineMinutes = baselineDurationMs / 60000;

    // Calculate totals for share computation
    const totalSelectionCnt = result.data.reduce(
      (sum, r) => sum + parseInt(r.selection_cnt || 0, 10),
      0,
    );
    const totalBaselineCnt = result.data.reduce(
      (sum, r) => sum + parseInt(r.baseline_cnt || 0, 10),
      0,
    );
    const totalSelectionErrCnt = result.data.reduce(
      (sum, r) => sum + parseInt(r.selection_err_cnt || 0, 10),
      0,
    );
    const totalBaselineErrCnt = result.data.reduce(
      (sum, r) => sum + parseInt(r.baseline_err_cnt || 0, 10),
      0,
    );

    // Analyze each facet value
    const analyzed = result.data.map((row) => {
      const selectionCnt = parseInt(row.selection_cnt, 10) || 0;
      const baselineCnt = parseInt(row.baseline_cnt, 10) || 0;
      const selectionErrCnt = parseInt(row.selection_err_cnt, 10) || 0;
      const baselineErrCnt = parseInt(row.baseline_err_cnt, 10) || 0;

      // Normalize to rate per minute
      const selectionRate = selectionMinutes > 0 ? selectionCnt / selectionMinutes : 0;
      const baselineRate = baselineMinutes > 0 ? baselineCnt / baselineMinutes : 0;

      // Calculate percentage change in rate
      let rateChange = 0;
      if (baselineRate > 0) {
        rateChange = ((selectionRate - baselineRate) / baselineRate) * 100;
      } else if (selectionRate > 0) {
        rateChange = Infinity;
      }

      // Calculate traffic share during selection vs baseline
      const selectionShare = totalSelectionCnt > 0 ? (selectionCnt / totalSelectionCnt) * 100 : 0;
      const baselineShare = totalBaselineCnt > 0 ? (baselineCnt / totalBaselineCnt) * 100 : 0;
      const shareChange = selectionShare - baselineShare;

      // Calculate error share during selection vs baseline
      const selectionErrShare = totalSelectionErrCnt > 0
        ? (selectionErrCnt / totalSelectionErrCnt) * 100
        : 0;
      const baselineErrShare = totalBaselineErrCnt > 0
        ? (baselineErrCnt / totalBaselineErrCnt) * 100
        : 0;
      const errShareChange = selectionErrShare - baselineErrShare;

      // Calculate error rate change for this dimension
      const selectionErrRate = selectionCnt > 0 ? (selectionErrCnt / selectionCnt) * 100 : 0;
      const baselineErrRate = baselineCnt > 0 ? (baselineErrCnt / baselineCnt) * 100 : 0;
      const errRateChange = selectionErrRate - baselineErrRate;

      return {
        dim: row.dim,
        selectionRate: Math.round(selectionRate * 10) / 10,
        baselineRate: Math.round(baselineRate * 10) / 10,
        rateChange: Math.round(rateChange * 10) / 10,
        selectionShare: Math.round(selectionShare * 10) / 10,
        baselineShare: Math.round(baselineShare * 10) / 10,
        shareChange: Math.round(shareChange * 10) / 10,
        errShareChange: Math.round(errShareChange * 10) / 10,
        errRateChange: Math.round(errRateChange * 10) / 10,
      };
    });

    // Filter to meaningful changes in EITHER direction:
    // - Traffic share changed by >5pp, OR error share changed by >5pp,
    //   OR error rate changed by >5pp
    // - Must have some volume (selectionRate > 0.5/min OR baselineRate > 0.5/min)
    const filtered = analyzed
      .filter((r) => {
        const hasVolume = r.selectionRate > 0.5 || r.baselineRate > 0.5;
        const hasSignificantChange = Math.abs(r.shareChange) > 5
          || Math.abs(r.errShareChange) > 5
          || Math.abs(r.errRateChange) > 5;
        return hasVolume && hasSignificantChange;
      })
      .map((r) => ({
        ...r,
        // Use the maximum absolute change as the sort key
        maxChange: Math.max(
          Math.abs(r.shareChange),
          Math.abs(r.errShareChange),
          Math.abs(r.errRateChange),
        ),
        // Keep the actual change value with the largest magnitude for tooltip
        shareChange: [r.shareChange, r.errShareChange, r.errRateChange]
          .reduce((max, v) => (Math.abs(v) > Math.abs(max) ? v : max), 0),
      }))
      .sort((a, b) => b.maxChange - a.maxChange)
      .slice(0, 5);

    if (filtered.length === 0 && analyzed.length > 0) {
      const sorted = [...analyzed].sort((a, b) => {
        const aMax = Math.max(
          Math.abs(a.shareChange),
          Math.abs(a.errShareChange),
          Math.abs(a.errRateChange),
        );
        const bMax = Math.max(
          Math.abs(b.shareChange),
          Math.abs(b.errShareChange),
          Math.abs(b.errRateChange),
        );
        return bMax - aMax;
      });
      const top = sorted[0];
      // eslint-disable-next-line no-console
      console.log(
        `  ${breakdown.id}: ${analyzed.length} dims, `
        + `top share=${top?.shareChange}pp, errShare=${top?.errShareChange}pp`,
      );
    }

    return filtered;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Selection investigation error for ${breakdown.id}:`, err.message);
    return [];
  }
}
