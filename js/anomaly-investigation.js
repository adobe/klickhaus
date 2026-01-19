/**
 * Anomaly root cause investigation module.
 *
 * When an anomaly is detected, this module queries facets to identify
 * which dimension values contributed most to the spike or drop.
 *
 * @module anomaly-investigation
 */

import { query } from './api.js';
import { DATABASE } from './config.js';
import { state } from './state.js';
import { allBreakdowns } from './breakdowns/definitions.js';
import { getTable, getHostFilter, getTimeFilter } from './time.js';
import { getFacetFilters } from './breakdowns/index.js';

// Store last investigation results for UI integration
let lastInvestigationResults = [];

// Cache key for current investigation context
let currentCacheKey = null;
// Store context for memory cache eligibility check
let currentCacheContext = null;

// Cache version - increment when cache format or algorithm changes
const CACHE_VERSION = 3;

// Number of contributors to cache vs highlight
const CACHE_TOP_N = 30;
const HIGHLIGHT_TOP_N = 3;

// Store cached top contributors for re-applying highlights as facets load
let cachedTopContributors = null;

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
  'wild', 'winter', 'zephyr'
];

// Car colors organized by severity for anomaly ID generation
const CAR_COLORS_RED = [
  'burgundy', 'cardinal', 'carmine', 'cerise', 'cherry', 'claret', 'coral',
  'cranberry', 'crimson', 'garnet', 'magenta', 'maroon', 'raspberry', 'rose',
  'ruby', 'russet', 'rust', 'scarlet', 'vermillion', 'wine'
];

const CAR_COLORS_ORANGE = [
  'amber', 'apricot', 'bronze', 'burnt', 'butterscotch', 'caramel', 'carrot',
  'cinnamon', 'copper', 'flame', 'ginger', 'gold', 'honey', 'marigold',
  'melon', 'ochre', 'orange', 'papaya', 'peach', 'pumpkin', 'saffron',
  'sand', 'sienna', 'tan', 'tangerine', 'tawny', 'topaz', 'yellow'
];

const CAR_COLORS_COOL = [
  'aqua', 'azure', 'blue', 'cerulean', 'chartreuse', 'cobalt', 'cyan',
  'emerald', 'forest', 'green', 'hunter', 'indigo', 'jade', 'lagoon',
  'lime', 'mint', 'navy', 'olive', 'pacific', 'pine', 'sage', 'seafoam',
  'spruce', 'teal', 'turquoise', 'verdant', 'viridian'
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
  'tundra', 'vantage', 'viper', 'wrangler', 'zephyr'
];

/**
 * Generate a simple hash from a string
 * @param {string} str - String to hash
 * @returns {number} Hash value
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
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
function generateAnomalyId(baseTimeRange, baseFilters, anomalyStart, anomalyEnd, category = 'green') {
  // Create a stable string from the inputs (round timestamps to minute for cache stability)
  const inputStr = [
    baseTimeRange,
    baseFilters,
    roundToMinute(anomalyStart),
    roundToMinute(anomalyEnd)
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
  const modelIdx = Math.floor(hash / (CAR_ADJECTIVES.length * colorList.length)) % CAR_MODELS.length;

  return `${CAR_ADJECTIVES[adjIdx]}-${colorList[colorIdx]}-${CAR_MODELS[modelIdx]}`;
}

/**
 * Get current query context as a structured object for cache comparison
 * @returns {Object} Query context with time, host, and filters
 */
function getQueryContext() {
  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const facetFilters = getFacetFilters();

  // Parse facet filters into a map of col -> value for comparison
  // getFacetFilters returns SQL like: AND col1 = 'val1' AND col2 = 'val2'
  const filterMap = {};
  if (facetFilters) {
    // Extract individual filters from the SQL string
    const matches = facetFilters.matchAll(/(`[^`]+`|[a-zA-Z_]+(?:\([^)]+\))?)\s*(?:=|!=)\s*'([^']+)'/g);
    for (const match of matches) {
      filterMap[match[1]] = match[2];
    }
  }

  return { timeFilter, hostFilter, filterMap };
}

/**
 * Generate cache key based only on time and host (base dataset)
 * @returns {string} Cache key
 */
function generateCacheKey() {
  const { timeFilter, hostFilter } = getQueryContext();
  return simpleHash(`${timeFilter}|${hostFilter}`).toString(36);
}

/**
 * Check if current context is eligible to use a cached investigation
 * Eligible if: same time, same host, and current filters are a superset of cached filters
 * @param {Object} cachedContext - The cached query context
 * @returns {boolean} True if cache is eligible
 */
function isCacheEligible(cachedContext) {
  const current = getQueryContext();

  // Time must match exactly
  if (current.timeFilter !== cachedContext.timeFilter) {
    console.log('Cache ineligible: time filter changed');
    return false;
  }

  // Host filter must match exactly
  if (current.hostFilter !== cachedContext.hostFilter) {
    console.log('Cache ineligible: host filter changed');
    return false;
  }

  // Current filters must be a superset of cached filters (drill-in allowed, drill-out not)
  for (const [col, value] of Object.entries(cachedContext.filterMap || {})) {
    if (current.filterMap[col] !== value) {
      console.log(`Cache ineligible: filter ${col} changed or removed`);
      return false;
    }
  }

  // All checks passed - current is same or superset of cached
  const cachedFilterCount = Object.keys(cachedContext.filterMap || {}).length;
  const currentFilterCount = Object.keys(current.filterMap).length;
  if (currentFilterCount > cachedFilterCount) {
    console.log(`Cache eligible: drilled in (${cachedFilterCount} → ${currentFilterCount} filters)`);
  } else {
    console.log('Cache eligible: same context');
  }
  return true;
}

/**
 * Load cached investigation from localStorage
 * @param {string} cacheKey - Cache key
 * @returns {Object|null} Cached data or null (includes context for eligibility check)
 */
function loadCachedInvestigation(cacheKey) {
  try {
    const cached = localStorage.getItem(`anomaly_investigation_${cacheKey}`);
    if (!cached) {
      console.log(`No cache found for key: ${cacheKey}`);
      return null;
    }
    const data = JSON.parse(cached);
    // Check cache version matches and cache is less than 1 hour old
    if (data.version !== CACHE_VERSION) {
      console.log(`Cache version mismatch: ${data.version} vs ${CACHE_VERSION}`);
      return null;
    }
    if (Date.now() - data.timestamp >= 60 * 60 * 1000) {
      console.log('Cache expired (older than 1 hour)');
      return null;
    }
    // Check if current context is eligible (same or drill-in from cached context)
    if (data.context && isCacheEligible(data.context)) {
      console.log(`Cache loaded: ${data.topContributors?.length || 0} contributors`);
      return data;
    } else if (!data.context) {
      // Old cache format without context - still usable if key matches exactly
      console.log('Cache eligible: old format (no context)');
      return data;
    }
    // Eligibility check failed - logged inside isCacheEligible
    return null;
  } catch (e) {
    console.warn('Failed to load cached investigation:', e);
  }
  return null;
}

/**
 * Save investigation to localStorage cache
 * @param {string} cacheKey - Cache key
 * @param {Object} data - Investigation data
 */
function saveCachedInvestigation(cacheKey, data) {
  try {
    const context = getQueryContext();
    localStorage.setItem(`anomaly_investigation_${cacheKey}`, JSON.stringify({
      ...data,
      context,
      version: CACHE_VERSION,
      timestamp: Date.now()
    }));
  } catch (e) {
    console.warn('Failed to cache investigation:', e);
  }
}

/**
 * Clear old investigation caches (keep last 10)
 */
function cleanupOldCaches() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('anomaly_investigation_')) {
        const data = JSON.parse(localStorage.getItem(key));
        keys.push({ key, timestamp: data.timestamp || 0 });
      }
    }
    // Sort by timestamp descending, remove all but the 10 most recent
    keys.sort((a, b) => b.timestamp - a.timestamp);
    keys.slice(10).forEach(({ key }) => localStorage.removeItem(key));
  } catch (e) {
    // Ignore cleanup errors
  }
}

/**
 * Build a time filter SQL clause for a specific time window
 * @param {Date} start - Window start time
 * @param {Date} end - Window end time
 * @returns {string} SQL WHERE clause
 */
function buildTimeFilter(start, end) {
  const startIso = start.toISOString().replace('T', ' ').slice(0, 19);
  const endIso = end.toISOString().replace('T', ' ').slice(0, 19);
  return `timestamp BETWEEN toDateTime('${startIso}') AND toDateTime('${endIso}')`;
}

/**
 * Get the status filter SQL based on anomaly category
 * @param {string} category - 'red' (5xx), 'yellow' (4xx), or 'green' (2xx/3xx)
 * @returns {string} SQL condition
 */
function getCategoryFilter(category) {
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
 * Query a single facet comparing anomaly window vs baseline
 * @param {Object} breakdown - Breakdown definition
 * @param {Object} anomaly - Detected anomaly with time bounds
 * @param {Date} fullStart - Full time range start
 * @param {Date} fullEnd - Full time range end
 * @returns {Promise<Array>} Facet values with change analysis
 */
async function investigateFacet(breakdown, anomaly, fullStart, fullEnd) {
  const col = typeof breakdown.col === 'function'
    ? breakdown.col(state.topN)
    : breakdown.col;

  const extra = breakdown.extraFilter || '';
  const hostFilter = getHostFilter();
  const facetFilters = getFacetFilters();
  const categoryFilter = getCategoryFilter(anomaly.category);

  // Query for anomaly window counts
  const anomalyFilter = buildTimeFilter(anomaly.startTime, anomaly.endTime);

  // Single query that calculates counts for both windows
  // We get BOTH category-filtered AND total counts to calculate share changes
  const sql = `
    SELECT
      ${col} as dim,
      countIf(${anomalyFilter} AND ${categoryFilter}) as anomaly_cat_cnt,
      countIf(NOT (${anomalyFilter}) AND ${categoryFilter}) as baseline_cat_cnt,
      countIf(${anomalyFilter}) as anomaly_total_cnt,
      countIf(NOT (${anomalyFilter})) as baseline_total_cnt
    FROM ${DATABASE}.${getTable()}
    WHERE (${buildTimeFilter(fullStart, fullEnd)})
      ${hostFilter} ${facetFilters} ${extra}
    GROUP BY dim
    HAVING anomaly_cat_cnt > 0 OR baseline_cat_cnt > 0
    ORDER BY anomaly_cat_cnt DESC
    LIMIT 50
  `;

  try {
    const result = await query(sql, { cacheTtl: 60 });

    // Calculate anomaly and baseline durations in ms
    const anomalyDurationMs = anomaly.endTime - anomaly.startTime;
    const baselineDurationMs = (fullEnd - fullStart) - anomalyDurationMs;

    // Normalize to rate per minute for fair comparison
    const anomalyMinutes = anomalyDurationMs / 60000;
    const baselineMinutes = baselineDurationMs / 60000;

    // Calculate totals for share computation
    const totalAnomalyCatCnt = result.data.reduce((sum, r) => sum + parseInt(r.anomaly_cat_cnt || 0), 0);
    const totalBaselineCatCnt = result.data.reduce((sum, r) => sum + parseInt(r.baseline_cat_cnt || 0), 0);

    // Analyze each facet value
    const analyzed = result.data.map(row => {
      const anomalyCatCnt = parseInt(row.anomaly_cat_cnt) || 0;
      const baselineCatCnt = parseInt(row.baseline_cat_cnt) || 0;
      const anomalyTotalCnt = parseInt(row.anomaly_total_cnt) || 0;
      const baselineTotalCnt = parseInt(row.baseline_total_cnt) || 0;

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
      const anomalyShare = totalAnomalyCatCnt > 0 ? (anomalyCatCnt / totalAnomalyCatCnt) * 100 : 0;
      const baselineShare = totalBaselineCatCnt > 0 ? (baselineCatCnt / totalBaselineCatCnt) * 100 : 0;
      const shareChange = anomalyShare - baselineShare; // Positive = over-represented during anomaly

      // Calculate error rate for this dimension (category errors / total requests)
      const anomalyErrorRate = anomalyTotalCnt > 0 ? (anomalyCatCnt / anomalyTotalCnt) * 100 : 0;
      const baselineErrorRate = baselineTotalCnt > 0 ? (baselineCatCnt / baselineTotalCnt) * 100 : 0;
      const errorRateChange = anomalyErrorRate - baselineErrorRate;

      return {
        dim: row.dim,
        anomalyRate: Math.round(anomalyRate * 10) / 10,
        baselineRate: Math.round(baselineRate * 10) / 10,
        rateChange: Math.round(rateChange * 10) / 10,
        anomalyShare: Math.round(anomalyShare * 10) / 10,
        baselineShare: Math.round(baselineShare * 10) / 10,
        shareChange: Math.round(shareChange * 10) / 10,
        errorRateChange: Math.round(errorRateChange * 10) / 10
      };
    });

    // Filter to meaningful results:
    // - Share increased by >5 percentage points (over-represented during anomaly)
    // - OR error rate increased by >5 percentage points
    // - Must have some volume (anomalyRate > 0.5/min)
    return analyzed
      .filter(r => r.anomalyRate > 0.5 && (r.shareChange > 5 || r.errorRateChange > 5))
      .sort((a, b) => b.shareChange - a.shareChange)
      .slice(0, 5);
  } catch (err) {
    console.error(`Investigation error for ${breakdown.id}:`, err.message);
    return [];
  }
}

// Track all contributors for progressive highlighting
let allContributors = [];

/**
 * Update highlights based on current top contributors
 * Called progressively as new investigation results come in
 */
function updateProgressiveHighlights() {
  // Sort by share change (most over-represented first)
  // Pass all to function - it will find first N that exist in DOM
  const sorted = [...allContributors].sort((a, b) => b.shareChange - a.shareChange);

  // Apply highlights - function will iterate through sorted list and highlight first N found in DOM
  applyHighlightsFromContributors(sorted);
}

/**
 * Main investigation function - call after anomalies detected and facets loaded
 * @param {Array} anomalies - Array of detected anomalies from detectSteps()
 * @param {Array} chartData - Time series data points
 */
export async function investigateAnomalies(anomalies, chartData) {
  if (!anomalies || anomalies.length === 0) {
    clearHighlights();
    return;
  }

  // Generate cache key for current context
  const cacheKey = generateCacheKey();
  console.log(`Investigation cache key: ${cacheKey} (${window.location.pathname}${window.location.search})`);

  // Check if we have cached results for this context (memory cache)
  // Must also verify context eligibility (drill-in allowed, drill-out not)
  if (cacheKey === currentCacheKey && lastInvestigationResults.length > 0 && currentCacheContext) {
    if (isCacheEligible(currentCacheContext)) {
      console.log('Memory cache eligible, applying highlights');
      // Use cached contributors if available, otherwise fall back to applyHighlights
      let highlightCount = 0;
      if (cachedTopContributors && cachedTopContributors.length > 0) {
        highlightCount = applyHighlightsFromContributors(cachedTopContributors);
        console.log(`Applied ${highlightCount}/${HIGHLIGHT_TOP_N} highlights from memory cache`);
      } else {
        applyHighlights();
        highlightCount = HIGHLIGHT_TOP_N; // Assume enough for old format
      }
      // If enough highlights, return cached results
      if (highlightCount >= HIGHLIGHT_TOP_N) {
        console.log('Memory cache sufficient');
        return lastInvestigationResults;
      }
      // Not enough highlights visible after drill-down, need fresh investigation
      console.log(`Only ${highlightCount}/${HIGHLIGHT_TOP_N} highlighted from memory cache, fetching fresh candidates`);
      currentCacheKey = null;
      currentCacheContext = null;
      // Fall through to fresh investigation
    } else {
      console.log('Memory cache key matches but context changed, checking localStorage');
    }
  }

  // Check localStorage cache - apply immediately if available
  const cached = loadCachedInvestigation(cacheKey);
  if (cached && cached.results) {
    currentCacheKey = cacheKey;
    currentCacheContext = cached.context || getQueryContext();
    lastInvestigationResults = cached.results;
    // Restore the anomaly ID mappings
    for (const result of lastInvestigationResults) {
      if (result.anomalyId) {
        investigationsByAnomalyId.set(result.anomalyId, result);
        if (result.anomaly?.rank) {
          storeAnomalyIdOnStep(result.anomaly.rank, result.anomalyId);
        }
      }
    }
    // Store top contributors for re-applying as facets load (keep all cached, function limits to HIGHLIGHT_TOP_N)
    let highlightedFromCache = 0;
    if (cached.topContributors && cached.topContributors.length > 0) {
      cachedTopContributors = cached.topContributors;
      // Apply highlights immediately (some facets may already be loaded)
      highlightedFromCache = applyHighlightsFromContributors(cachedTopContributors);
      console.log(`Applied ${highlightedFromCache}/${HIGHLIGHT_TOP_N} highlights from cache`);
    } else {
      cachedTopContributors = null;
      // Fallback for old cache format
      applyHighlights();
      highlightedFromCache = HIGHLIGHT_TOP_N; // Assume enough for old format
      console.log('Applied highlights from old cache format');
    }

    // If we couldn't highlight enough values (e.g., after drill-down filtered them out),
    // fall through to run a fresh investigation which will create a new cache entry
    if (highlightedFromCache >= HIGHLIGHT_TOP_N) {
      console.log('Cache sufficient, skipping fresh investigation');
      return 'cached';
    }
    console.log(`Only ${highlightedFromCache}/${HIGHLIGHT_TOP_N} highlighted, fetching fresh candidates`);
    // Clear stale cache data before fresh investigation
    currentCacheKey = null;
    currentCacheContext = null;
  }

  // Get base context for stable IDs
  const baseTimeFilter = getTimeFilter();
  const baseFacetFilters = getFacetFilters();
  console.log('Starting fresh investigation');

  // Reset state for new investigation
  lastInvestigationResults = [];
  allContributors = [];

  // Get full time range from chart data
  if (!chartData || chartData.length < 2) {
    console.log('No chart data for investigation');
    return [];
  }
  const fullStart = new Date(chartData[0].t);
  const fullEnd = new Date(chartData[chartData.length - 1].t);

  // Select facets to investigate
  const facetsToInvestigate = allBreakdowns.filter(b =>
    ['breakdown-hosts', 'breakdown-forwarded-hosts', 'breakdown-paths',
     'breakdown-errors', 'breakdown-user-agents', 'breakdown-ips',
     'breakdown-asn', 'breakdown-datacenters', 'breakdown-cache',
     'breakdown-content-types', 'breakdown-backend-type'].includes(b.id)
  );

  // Process each anomaly
  for (const anomaly of anomalies) {
    // Generate stable car-themed ID for this anomaly (color matches severity)
    const anomalyId = generateAnomalyId(
      baseTimeFilter,
      baseFacetFilters,
      anomaly.startTime,
      anomaly.endTime,
      anomaly.category
    );

    // Initialize result structure for this anomaly
    const result = { anomaly, anomalyId, facets: {} };
    result.anomaly.id = anomalyId;
    lastInvestigationResults.push(result);

    // Store for persistent access and set on detected step
    investigationsByAnomalyId.set(anomalyId, result);
    storeAnomalyIdOnStep(anomaly.rank, anomalyId);

    // Launch all facet investigations in parallel with callbacks
    const facetPromises = facetsToInvestigate.map(async (breakdown) => {
      const analysis = await investigateFacet(breakdown, anomaly, fullStart, fullEnd);

      if (analysis.length > 0) {
        // Store results in the result object
        result.facets[breakdown.id] = analysis;

        // Add to global contributors list
        for (const item of analysis) {
          allContributors.push({
            anomalyId,
            anomaly: `#${anomaly.rank} ${anomaly.category} ${anomaly.type}`,
            anomalyLabel: `${anomalyId.split('-').slice(0, 2).join('-')}`,
            facet: breakdown.id.replace('breakdown-', ''),
            facetId: breakdown.id,
            category: anomaly.category,
            rank: anomaly.rank,
            ...item
          });
        }

        // Progressive update - re-rank and highlight after each facet completes
        updateProgressiveHighlights();
      }

      return { facetId: breakdown.id, analysis };
    });

    // Wait for all facets for this anomaly to complete before moving to next anomaly
    await Promise.all(facetPromises);
  }

  // Store cache key and save to localStorage
  // Save top N contributors for fast highlighting on cache load
  const sortedContributors = [...allContributors].sort((a, b) => b.shareChange - a.shareChange);
  const topForCache = sortedContributors.slice(0, CACHE_TOP_N);
  currentCacheKey = cacheKey;
  currentCacheContext = getQueryContext();
  cachedTopContributors = topForCache; // Also set memory cache for drill-down
  saveCachedInvestigation(cacheKey, {
    results: lastInvestigationResults,
    topContributors: topForCache
  });
  cleanupOldCaches();

  if (allContributors.length === 0) {
    clearHighlights();
  }

  return lastInvestigationResults;
}

/**
 * Get the focused anomaly ID from URL or null
 * @returns {string|null} Anomaly ID or null
 */
export function getFocusedAnomalyId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('anomaly') || null;
}

/**
 * Set the focused anomaly ID in URL
 * @param {string|null} anomalyId - Anomaly ID or null to clear
 */
export function setFocusedAnomalyId(anomalyId) {
  const url = new URL(window.location);
  if (anomalyId) {
    url.searchParams.set('anomaly', anomalyId);
  } else {
    url.searchParams.delete('anomaly');
  }
  window.history.replaceState({}, '', url);
}

/**
 * Get highlighted dimensions for a specific facet
 * @param {string} facetId - Facet ID (e.g., 'breakdown-hosts')
 * @returns {Set<string>} Set of dimension values to highlight
 */
export function getHighlightedDimensions(facetId) {
  const focusedId = getFocusedAnomalyId();
  const highlighted = new Set();

  for (const result of lastInvestigationResults) {
    // If focused on a specific anomaly, only include its dimensions
    if (focusedId && result.anomalyId !== focusedId) {
      continue;
    }

    const facetResults = result.facets[facetId];
    if (facetResults) {
      for (const item of facetResults) {
        highlighted.add(item.dim);
      }
    }
  }

  return highlighted;
}

/**
 * Find a row in the breakdown table by dimension value
 * Tries exact match first, then case-insensitive match as fallback
 * @param {NodeList} rows - Table rows to search
 * @param {string} dim - Dimension value to find
 * @returns {Element|null} Matching row or null
 */
function findRowByDim(rows, dim) {
  const rowArray = Array.from(rows);
  // Try exact match first
  let row = rowArray.find(r => r.dataset.dim === dim);
  if (!row && dim) {
    // Fallback to case-insensitive match
    const dimLower = dim.toLowerCase();
    row = rowArray.find(r => r.dataset.dim?.toLowerCase() === dimLower);
  }
  return row || null;
}

/**
 * Apply highlights from a contributors array (for progressive highlighting)
 * Iterates through candidates in priority order, highlighting up to HIGHLIGHT_TOP_N that exist in DOM
 * @param {Array} contributors - Array of contributor objects with facetId, dim, category, etc. (sorted by priority)
 * @returns {number} Number of items actually highlighted
 */
function applyHighlightsFromContributors(contributors) {
  // Remove existing highlights and reset titles
  document.querySelectorAll('.investigation-highlight').forEach(el => {
    el.classList.remove('investigation-highlight', 'investigation-red', 'investigation-yellow', 'investigation-green', 'investigation-blue');
    const statusColor = el.querySelector('.status-color');
    if (statusColor) statusColor.removeAttribute('title');
  });

  const focusedId = getFocusedAnomalyId();

  // Iterate through contributors in priority order, highlight first N that exist in DOM
  let highlightedCount = 0;
  let checkedCount = 0;

  for (const c of contributors) {
    // Stop if we've highlighted enough
    if (highlightedCount >= HIGHLIGHT_TOP_N) {
      break;
    }

    // If focused on a specific anomaly, only include its dimensions
    if (focusedId && c.anomalyId !== focusedId) {
      continue;
    }

    checkedCount++;
    const card = document.getElementById(c.facetId);
    if (!card) continue;

    const rows = card.querySelectorAll('.breakdown-table tr');
    if (rows.length === 0) continue;

    // Try to find the row with matching dimension (case-insensitive fallback)
    const row = findRowByDim(rows, c.dim);
    if (row) {
      row.classList.add('investigation-highlight', `investigation-${c.category}`);
      highlightedCount++;
      console.log(`  Highlighted #${highlightedCount}: ${c.facetId} = "${c.dim}" (+${c.shareChange}pp)`);
      const statusColor = row.querySelector('.status-color');
      if (statusColor) {
        statusColor.title = `+${c.shareChange}pp share of #${c.rank} ${c.anomalyId}`;
      }
    }
  }

  return highlightedCount;
}

/**
 * Apply visual highlights to all facet values
 */
function applyHighlights() {
  // Remove existing highlights and reset titles
  document.querySelectorAll('.investigation-highlight').forEach(el => {
    el.classList.remove('investigation-highlight', 'investigation-red', 'investigation-yellow', 'investigation-green', 'investigation-blue');
    const statusColor = el.querySelector('.status-color');
    if (statusColor) statusColor.removeAttribute('title');
  });

  const focusedId = getFocusedAnomalyId();

  // Build a map of facetId -> dim -> { category, shareChange, anomalyId, rank }
  const highlightMap = new Map();

  // If we have a focused anomaly ID, try to get its results from the persistent map
  if (focusedId) {
    const persistedResult = investigationsByAnomalyId.get(focusedId);
    if (persistedResult) {
      const category = persistedResult.anomaly?.category || 'red';
      const anomalyId = persistedResult.anomalyId;
      const rank = persistedResult.anomaly?.rank || 1;
      for (const [facetId, facetResults] of Object.entries(persistedResult.facets)) {
        if (!highlightMap.has(facetId)) {
          highlightMap.set(facetId, new Map());
        }
        for (const item of facetResults) {
          highlightMap.get(facetId).set(item.dim, {
            category,
            shareChange: item.shareChange,
            anomalyId,
            rank
          });
        }
      }
    }
  } else {
    // No specific focus - highlight from all current results (use highest share change per dim)
    for (const result of lastInvestigationResults) {
      const category = result.anomaly?.category || 'red';
      const anomalyId = result.anomalyId;
      const rank = result.anomaly?.rank || 1;
      for (const [facetId, facetResults] of Object.entries(result.facets)) {
        if (!highlightMap.has(facetId)) {
          highlightMap.set(facetId, new Map());
        }
        for (const item of facetResults) {
          const existing = highlightMap.get(facetId).get(item.dim);
          // Keep the one with higher share change
          if (!existing || item.shareChange > existing.shareChange) {
            highlightMap.get(facetId).set(item.dim, {
              category,
              shareChange: item.shareChange,
              anomalyId,
              rank
            });
          }
        }
      }
    }
  }

  // Apply highlights to matching rows
  for (const [facetId, dimInfoMap] of highlightMap) {
    const card = document.getElementById(facetId);
    if (!card) continue;

    const rows = card.querySelectorAll('.breakdown-table tr');
    if (rows.length === 0) continue;

    for (const [expectedDim, info] of dimInfoMap) {
      const row = findRowByDim(rows, expectedDim);
      if (row) {
        row.classList.add('investigation-highlight', `investigation-${info.category}`);
        const statusColor = row.querySelector('.status-color');
        if (statusColor) {
          statusColor.title = `+${info.shareChange}pp share of #${info.rank} ${info.anomalyId}`;
        }
      }
    }
  }
}

/**
 * Clear all investigation highlights
 */
export function clearHighlights() {
  document.querySelectorAll('.investigation-highlight').forEach(el => {
    el.classList.remove('investigation-highlight');
  });
}

/**
 * Invalidate the investigation cache (call when time range changes)
 */
export function invalidateInvestigationCache() {
  currentCacheKey = null;
  currentCacheContext = null;
  lastInvestigationResults = [];
  cachedTopContributors = null;
  clearHighlights();
}

// Store investigation results by anomaly ID for persistent access across zooms
const investigationsByAnomalyId = new Map();

/**
 * Get investigation results for a specific anomaly ID
 * @param {string} anomalyId - Anomaly ID
 * @returns {Object|null} Investigation result or null
 */
export function getInvestigationByAnomalyId(anomalyId) {
  return investigationsByAnomalyId.get(anomalyId) || null;
}

/**
 * Get anomaly ID by rank (from last investigation)
 * @param {number} rank - Anomaly rank (1-5)
 * @returns {string|null} Anomaly ID or null
 */
export function getAnomalyIdByRank(rank) {
  const result = lastInvestigationResults.find(r => r.anomaly?.rank === rank);
  return result?.anomalyId || null;
}

/**
 * Store anomaly ID on detected step (called from investigation)
 * @param {number} rank - Step rank
 * @param {string} id - Anomaly ID
 */
function storeAnomalyIdOnStep(rank, id) {
  // This will be used by chart.js to access IDs when zooming
  window._anomalyIds = window._anomalyIds || {};
  window._anomalyIds[rank] = id;
}

/**
 * Get the last investigation results
 * @returns {Array} Last investigation results
 */
export function getLastInvestigationResults() {
  return lastInvestigationResults;
}

/**
 * Re-apply cached highlights after a facet finishes loading.
 * Call this after each facet completes to progressively show highlights.
 */
export function reapplyHighlightsIfCached() {
  if (cachedTopContributors && cachedTopContributors.length > 0) {
    applyHighlightsFromContributors(cachedTopContributors);
  }
}

/**
 * Check if we have cached investigation results ready
 * @returns {boolean} True if cached results are available
 */
export function hasCachedInvestigation() {
  const cacheKey = generateCacheKey();
  return cacheKey === currentCacheKey || loadCachedInvestigation(cacheKey) !== null;
}

// Store selection investigation contributors for highlighting
let selectionContributors = [];

/**
 * Clear selection investigation highlights only (preserve anomaly highlights)
 */
export function clearSelectionHighlights() {
  document.querySelectorAll('.investigation-highlight.investigation-blue').forEach(el => {
    el.classList.remove('investigation-highlight', 'investigation-blue');
    const statusColor = el.querySelector('.status-color');
    if (statusColor) statusColor.removeAttribute('title');
  });
  selectionContributors = [];
}

/**
 * Investigate a user-selected time range
 * Compares the selected window against the rest of the visible time range
 * to find dimension values that are over-represented in the selection.
 *
 * @param {Date} selectionStart - Start of selected time range
 * @param {Date} selectionEnd - End of selected time range
 * @param {Date} fullStart - Start of full visible time range
 * @param {Date} fullEnd - End of full visible time range
 * @returns {Promise<Array>} Array of top contributors
 */
export async function investigateTimeRange(selectionStart, selectionEnd, fullStart, fullEnd) {
  // Clear ALL highlights (both anomaly and previous selection)
  clearHighlights();
  clearSelectionHighlights();

  // Select facets to investigate (same as anomaly investigation)
  const facetsToInvestigate = allBreakdowns.filter(b =>
    ['breakdown-hosts', 'breakdown-forwarded-hosts', 'breakdown-paths',
     'breakdown-errors', 'breakdown-user-agents', 'breakdown-ips',
     'breakdown-asn', 'breakdown-datacenters', 'breakdown-cache',
     'breakdown-content-types', 'breakdown-backend-type'].includes(b.id)
  );

  // Create a pseudo-anomaly object for the investigateFacet function
  // Use 'blue' as a special category that investigates ALL traffic (not filtered by status)
  const pseudoAnomaly = {
    startTime: selectionStart,
    endTime: selectionEnd,
    category: 'blue',
    type: 'selection',
    rank: 0
  };

  selectionContributors = [];

  // Launch all facet investigations in parallel
  const facetPromises = facetsToInvestigate.map(async (breakdown) => {
    const analysis = await investigateFacetForSelection(breakdown, pseudoAnomaly, fullStart, fullEnd);

    if (analysis.length > 0) {
      // Add to contributors list
      for (const item of analysis) {
        selectionContributors.push({
          facet: breakdown.id.replace('breakdown-', ''),
          facetId: breakdown.id,
          category: 'blue',
          ...item
        });
      }
    }

    return { facetId: breakdown.id, analysis };
  });

  await Promise.all(facetPromises);

  // Sort by max change and apply highlights (pass all, function will find first N in DOM)
  const sorted = [...selectionContributors].sort((a, b) => (b.maxChange || Math.abs(b.shareChange)) - (a.maxChange || Math.abs(a.shareChange)));

  console.log(`Selection investigation found ${selectionContributors.length} contributors, will highlight first ${HIGHLIGHT_TOP_N} found in DOM`);

  applySelectionHighlights(sorted);

  return sorted;
}

/**
 * Query a facet for selection investigation (compares selection vs rest of time range)
 * Looks at error rates (like anomaly investigation) to find dimensions with changed behavior
 */
async function investigateFacetForSelection(breakdown, selection, fullStart, fullEnd) {
  const col = typeof breakdown.col === 'function'
    ? breakdown.col(state.topN)
    : breakdown.col;

  const extra = breakdown.extraFilter || '';
  const hostFilter = getHostFilter();
  const facetFilters = getFacetFilters();

  // Query for selection window counts - includes error breakdown
  const selectionFilter = buildTimeFilter(selection.startTime, selection.endTime);

  // Query comparing selection vs baseline with error counts
  const sql = `
    SELECT
      ${col} as dim,
      countIf(${selectionFilter}) as selection_cnt,
      countIf(NOT (${selectionFilter})) as baseline_cnt,
      countIf(${selectionFilter} AND \`response.status\` >= 400) as selection_err_cnt,
      countIf(NOT (${selectionFilter}) AND \`response.status\` >= 400) as baseline_err_cnt
    FROM ${DATABASE}.${getTable()}
    WHERE (${buildTimeFilter(fullStart, fullEnd)})
      ${hostFilter} ${facetFilters} ${extra}
    GROUP BY dim
    HAVING selection_cnt > 0 OR baseline_cnt > 0
    ORDER BY selection_cnt DESC
    LIMIT 50
  `;

  try {
    const result = await query(sql, { cacheTtl: 60 });

    // Calculate durations for rate normalization
    const selectionDurationMs = selection.endTime - selection.startTime;
    const baselineDurationMs = (fullEnd - fullStart) - selectionDurationMs;
    const selectionMinutes = selectionDurationMs / 60000;
    const baselineMinutes = baselineDurationMs / 60000;

    // Calculate totals for share computation
    const totalSelectionCnt = result.data.reduce((sum, r) => sum + parseInt(r.selection_cnt || 0), 0);
    const totalBaselineCnt = result.data.reduce((sum, r) => sum + parseInt(r.baseline_cnt || 0), 0);
    const totalSelectionErrCnt = result.data.reduce((sum, r) => sum + parseInt(r.selection_err_cnt || 0), 0);
    const totalBaselineErrCnt = result.data.reduce((sum, r) => sum + parseInt(r.baseline_err_cnt || 0), 0);

    // Analyze each facet value
    const analyzed = result.data.map(row => {
      const selectionCnt = parseInt(row.selection_cnt) || 0;
      const baselineCnt = parseInt(row.baseline_cnt) || 0;
      const selectionErrCnt = parseInt(row.selection_err_cnt) || 0;
      const baselineErrCnt = parseInt(row.baseline_err_cnt) || 0;

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
      const selectionErrShare = totalSelectionErrCnt > 0 ? (selectionErrCnt / totalSelectionErrCnt) * 100 : 0;
      const baselineErrShare = totalBaselineErrCnt > 0 ? (baselineErrCnt / totalBaselineErrCnt) * 100 : 0;
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
        errRateChange: Math.round(errRateChange * 10) / 10
      };
    });

    // Filter to meaningful changes in EITHER direction:
    // - Traffic share changed by >5pp, OR
    // - Error share changed by >5pp, OR
    // - Error rate changed by >5pp
    // Must have some volume (selectionRate > 0.5/min OR baselineRate > 0.5/min for under-represented)
    const filtered = analyzed
      .filter(r => {
        const hasVolume = r.selectionRate > 0.5 || r.baselineRate > 0.5;
        const hasSignificantChange = Math.abs(r.shareChange) > 5 || Math.abs(r.errShareChange) > 5 || Math.abs(r.errRateChange) > 5;
        return hasVolume && hasSignificantChange;
      })
      .map(r => ({
        ...r,
        // Use the maximum absolute change as the sort key, preserve sign for display
        maxChange: Math.max(Math.abs(r.shareChange), Math.abs(r.errShareChange), Math.abs(r.errRateChange)),
        // Keep the actual change value with the largest magnitude for tooltip
        shareChange: [r.shareChange, r.errShareChange, r.errRateChange]
          .reduce((max, v) => Math.abs(v) > Math.abs(max) ? v : max, 0)
      }))
      .sort((a, b) => b.maxChange - a.maxChange)
      .slice(0, 5);

    if (filtered.length === 0 && analyzed.length > 0) {
      const sorted = [...analyzed].sort((a, b) => {
        const aMax = Math.max(Math.abs(a.shareChange), Math.abs(a.errShareChange), Math.abs(a.errRateChange));
        const bMax = Math.max(Math.abs(b.shareChange), Math.abs(b.errShareChange), Math.abs(b.errRateChange));
        return bMax - aMax;
      });
      const top = sorted[0];
      console.log(`  ${breakdown.id}: ${analyzed.length} dims analyzed, top shareChange=${top?.shareChange}pp, errShareChange=${top?.errShareChange}pp, errRateChange=${top?.errRateChange}pp`);
    }

    return filtered;
  } catch (err) {
    console.error(`Selection investigation error for ${breakdown.id}:`, err.message);
    return [];
  }
}

/**
 * Apply blue highlights for selection investigation
 * Iterates through contributors in priority order, highlighting first HIGHLIGHT_TOP_N that exist in DOM
 */
function applySelectionHighlights(contributors) {
  let appliedCount = 0;

  for (const c of contributors) {
    // Stop if we've highlighted enough
    if (appliedCount >= HIGHLIGHT_TOP_N) {
      break;
    }

    const card = document.getElementById(c.facetId);
    if (!card) continue;

    const rows = card.querySelectorAll('.breakdown-table tr');
    if (rows.length === 0) continue;

    // Try to find the row with matching dimension (case-insensitive fallback)
    const row = findRowByDim(rows, c.dim);
    if (row) {
      row.classList.add('investigation-highlight', 'investigation-blue');
      const statusColor = row.querySelector('.status-color');
      if (statusColor) {
        const sign = c.shareChange >= 0 ? '+' : '';
        const direction = c.shareChange >= 0 ? 'over' : 'under';
        statusColor.title = `${sign}${c.shareChange}pp (${direction}-represented in selection)`;
      }
      appliedCount++;
      const sign = c.shareChange >= 0 ? '+' : '';
      console.log(`  ✓ Highlighted #${appliedCount}: ${c.facetId} = "${c.dim}" (${sign}${c.shareChange}pp)`);
    }
  }

  console.log(`  Applied ${appliedCount}/${HIGHLIGHT_TOP_N} selection highlights`);
  return appliedCount;
}
