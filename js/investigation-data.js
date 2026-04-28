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
 * Data plane for anomaly investigation: caching, IDs, and stubs for facet queries.
 * ClickHouse investigation queries are stubbed; UI stubs live in anomaly-investigation.js.
 */

import { state } from './state.js';
import { getHostFilter, getTimeFilter } from './time.js';
import { compileFilters, isFilterSuperset } from './filter-sql.js';

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
 * STUB: breakdown-row investigation against ClickHouse is disabled.
 * See sql/queries/investigate-facet.sql when re-enabling.
 * @returns {Promise<[]>}
 */
export async function investigateFacet() {
  return [];
}

/**
 * STUB: drag-selection investigation disabled.
 * See sql/queries/investigate-selection.sql when re-enabling.
 * @returns {Promise<[]>}
 */
export async function investigateFacetForSelection() {
  return [];
}
