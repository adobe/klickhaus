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
import { compileFilters, isFilterSuperset } from './filter-sql.js';

// Import from submodules
import {
  CACHE_VERSION,
  CACHE_TOP_N,
  generateAnomalyId,
  generateCacheKey as genCacheKey,
  loadCachedInvestigation as loadCache,
  saveCachedInvestigation as saveCache,
  cleanupOldCaches,
  buildTimeFilter,
  getCategoryFilter,
  storeAnomalyIdOnStep
} from './anomaly-detection.js';

import {
  HIGHLIGHT_TOP_N,
  clearHighlights as clearHighlightsImpl,
  clearSelectionHighlights as clearSelectionHighlightsImpl,
  applyHighlightsFromContributors,
  applyHighlights as applyHighlightsImpl,
  applySelectionHighlights as applySelectionHighlightsImpl,
  getHighlightedDimensions as getHighlightedDimensionsImpl
} from './anomaly-highlight.js';

// Module state
let lastInvestigationResults = [];
let currentCacheKey = null;
let currentCacheContext = null;
let cachedTopContributors = null;
let allContributors = [];
let selectionContributors = [];

// Store investigation results by anomaly ID for persistent access across zooms
const investigationsByAnomalyId = new Map();

/**
 * Get current query context as a structured object for cache comparison
 * @returns {Object} Query context with time, host, and filters
 */
function getQueryContext() {
  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const { map: filterMap } = compileFilters(state.filters);
  return { timeFilter, hostFilter, filterMap };
}

/**
 * Generate cache key for current context
 * @returns {string} Cache key
 */
function generateCacheKey() {
  const { timeFilter, hostFilter } = getQueryContext();
  return genCacheKey(timeFilter, hostFilter);
}

/**
 * Check if current context is eligible to use a cached investigation
 * @param {Object} cachedContext - The cached query context
 * @returns {boolean} True if cache is eligible
 */
function isCacheEligible(cachedContext) {
  const current = getQueryContext();

  if (current.timeFilter !== cachedContext.timeFilter) {
    console.log('Cache ineligible: time filter changed');
    return false;
  }

  if (current.hostFilter !== cachedContext.hostFilter) {
    console.log('Cache ineligible: host filter changed');
    return false;
  }

  if (!isFilterSuperset(current.filterMap, cachedContext.filterMap || {})) {
    console.log('Cache ineligible: filters changed or removed');
    return false;
  }

  const cachedFilterCount = Object.keys(cachedContext.filterMap || {}).length;
  const currentFilterCount = Object.keys(current.filterMap).length;
  if (currentFilterCount > cachedFilterCount) {
    console.log(`Cache eligible: drilled in (${cachedFilterCount} \u2192 ${currentFilterCount} filters)`);
  } else {
    console.log('Cache eligible: same context');
  }
  return true;
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
  const anomalyFilter = buildTimeFilter(anomaly.startTime, anomaly.endTime);

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

    const anomalyDurationMs = anomaly.endTime - anomaly.startTime;
    const baselineDurationMs = (fullEnd - fullStart) - anomalyDurationMs;
    const anomalyMinutes = anomalyDurationMs / 60000;
    const baselineMinutes = baselineDurationMs / 60000;

    const totalAnomalyCatCnt = result.data.reduce((sum, r) => sum + parseInt(r.anomaly_cat_cnt || 0), 0);
    const totalBaselineCatCnt = result.data.reduce((sum, r) => sum + parseInt(r.baseline_cat_cnt || 0), 0);

    const analyzed = result.data.map(row => {
      const anomalyCatCnt = parseInt(row.anomaly_cat_cnt) || 0;
      const baselineCatCnt = parseInt(row.baseline_cat_cnt) || 0;
      const anomalyTotalCnt = parseInt(row.anomaly_total_cnt) || 0;
      const baselineTotalCnt = parseInt(row.baseline_total_cnt) || 0;

      const anomalyRate = anomalyMinutes > 0 ? anomalyCatCnt / anomalyMinutes : 0;
      const baselineRate = baselineMinutes > 0 ? baselineCatCnt / baselineMinutes : 0;

      let rateChange = 0;
      if (baselineRate > 0) {
        rateChange = ((anomalyRate - baselineRate) / baselineRate) * 100;
      } else if (anomalyRate > 0) {
        rateChange = Infinity;
      }

      const anomalyShare = totalAnomalyCatCnt > 0 ? (anomalyCatCnt / totalAnomalyCatCnt) * 100 : 0;
      const baselineShare = totalBaselineCatCnt > 0 ? (baselineCatCnt / totalBaselineCatCnt) * 100 : 0;
      const shareChange = anomalyShare - baselineShare;

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

    return analyzed
      .filter(r => r.anomalyRate > 0.5 && (r.shareChange > 5 || r.errorRateChange > 5))
      .sort((a, b) => b.shareChange - a.shareChange)
      .slice(0, 5);
  } catch (err) {
    console.error(`Investigation error for ${breakdown.id}:`, err.message);
    return [];
  }
}

/**
 * Update highlights based on current top contributors
 */
function updateProgressiveHighlights() {
  const sorted = [...allContributors].sort((a, b) => b.shareChange - a.shareChange);
  applyHighlightsFromContributors(sorted, getFocusedAnomalyId());
}

/**
 * Main investigation function
 * @param {Array} anomalies - Array of detected anomalies
 * @param {Array} chartData - Time series data points
 * @returns {Promise<Array|string>} Investigation results or 'cached'
 */
export async function investigateAnomalies(anomalies, chartData) {
  if (!anomalies || anomalies.length === 0) {
    clearHighlights();
    return [];
  }

  const cacheKey = generateCacheKey();
  console.log(`Investigation cache key: ${cacheKey} (${window.location.pathname}${window.location.search})`);

  // Check memory cache
  if (cacheKey === currentCacheKey && lastInvestigationResults.length > 0 && currentCacheContext) {
    if (isCacheEligible(currentCacheContext)) {
      console.log('Memory cache eligible, applying highlights');
      let highlightCount = 0;
      if (cachedTopContributors && cachedTopContributors.length > 0) {
        highlightCount = applyHighlightsFromContributors(cachedTopContributors, getFocusedAnomalyId());
        console.log(`Applied ${highlightCount}/${HIGHLIGHT_TOP_N} highlights from memory cache`);
      } else {
        applyHighlightsImpl(lastInvestigationResults, getFocusedAnomalyId(), investigationsByAnomalyId);
        highlightCount = HIGHLIGHT_TOP_N;
      }
      if (highlightCount >= HIGHLIGHT_TOP_N) {
        console.log('Memory cache sufficient');
        return lastInvestigationResults;
      }
      console.log(`Only ${highlightCount}/${HIGHLIGHT_TOP_N} highlighted from memory cache, fetching fresh candidates`);
      currentCacheKey = null;
      currentCacheContext = null;
    } else {
      console.log('Memory cache key matches but context changed, checking localStorage');
    }
  }

  // Check localStorage cache
  const cached = loadCache(cacheKey, isCacheEligible);
  if (cached && cached.results) {
    currentCacheKey = cacheKey;
    currentCacheContext = cached.context || getQueryContext();
    lastInvestigationResults = cached.results;

    for (const result of lastInvestigationResults) {
      if (result.anomalyId) {
        investigationsByAnomalyId.set(result.anomalyId, result);
        if (result.anomaly?.rank) {
          storeAnomalyIdOnStep(result.anomaly.rank, result.anomalyId);
        }
      }
    }

    let highlightedFromCache = 0;
    if (cached.topContributors && cached.topContributors.length > 0) {
      cachedTopContributors = cached.topContributors;
      highlightedFromCache = applyHighlightsFromContributors(cachedTopContributors, getFocusedAnomalyId());
      console.log(`Applied ${highlightedFromCache}/${HIGHLIGHT_TOP_N} highlights from cache`);
    } else {
      cachedTopContributors = null;
      applyHighlightsImpl(lastInvestigationResults, getFocusedAnomalyId(), investigationsByAnomalyId);
      highlightedFromCache = HIGHLIGHT_TOP_N;
      console.log('Applied highlights from old cache format');
    }

    if (highlightedFromCache >= HIGHLIGHT_TOP_N) {
      console.log('Cache sufficient, skipping fresh investigation');
      return 'cached';
    }
    console.log(`Only ${highlightedFromCache}/${HIGHLIGHT_TOP_N} highlighted, fetching fresh candidates`);
    currentCacheKey = null;
    currentCacheContext = null;
  }

  // Fresh investigation
  const baseTimeFilter = getTimeFilter();
  const baseFacetFilters = getFacetFilters();
  console.log('Starting fresh investigation');

  lastInvestigationResults = [];
  allContributors = [];

  if (!chartData || chartData.length < 2) {
    console.log('No chart data for investigation');
    return [];
  }
  const fullStart = new Date(chartData[0].t);
  const fullEnd = new Date(chartData[chartData.length - 1].t);

  const facetsToInvestigate = allBreakdowns.filter(b =>
    ['breakdown-hosts', 'breakdown-forwarded-hosts', 'breakdown-paths',
     'breakdown-errors', 'breakdown-user-agents', 'breakdown-ips',
     'breakdown-asn', 'breakdown-datacenters', 'breakdown-cache',
     'breakdown-content-types', 'breakdown-backend-type'].includes(b.id)
  );

  for (const anomaly of anomalies) {
    const anomalyId = generateAnomalyId(
      baseTimeFilter,
      baseFacetFilters,
      anomaly.startTime,
      anomaly.endTime,
      anomaly.category
    );

    const result = { anomaly, anomalyId, facets: {} };
    result.anomaly.id = anomalyId;
    lastInvestigationResults.push(result);

    investigationsByAnomalyId.set(anomalyId, result);
    storeAnomalyIdOnStep(anomaly.rank, anomalyId);

    const facetPromises = facetsToInvestigate.map(async (breakdown) => {
      const analysis = await investigateFacet(breakdown, anomaly, fullStart, fullEnd);

      if (analysis.length > 0) {
        result.facets[breakdown.id] = analysis;

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

        updateProgressiveHighlights();
      }

      return { facetId: breakdown.id, analysis };
    });

    await Promise.all(facetPromises);
  }

  // Save to cache
  const sortedContributors = [...allContributors].sort((a, b) => b.shareChange - a.shareChange);
  const topForCache = sortedContributors.slice(0, CACHE_TOP_N);
  currentCacheKey = cacheKey;
  currentCacheContext = getQueryContext();
  cachedTopContributors = topForCache;
  saveCache(cacheKey, {
    results: lastInvestigationResults,
    topContributors: topForCache
  }, currentCacheContext);
  cleanupOldCaches();

  if (allContributors.length === 0) {
    clearHighlights();
  }

  return lastInvestigationResults;
}

/**
 * Get the focused anomaly ID from URL
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
 * @param {string} facetId - Facet ID
 * @returns {Set<string>} Set of dimension values to highlight
 */
export function getHighlightedDimensions(facetId) {
  return getHighlightedDimensionsImpl(facetId, lastInvestigationResults, getFocusedAnomalyId());
}

/**
 * Clear all investigation highlights
 */
export function clearHighlights() {
  clearHighlightsImpl();
}

/**
 * Invalidate the investigation cache
 */
export function invalidateInvestigationCache() {
  currentCacheKey = null;
  currentCacheContext = null;
  lastInvestigationResults = [];
  cachedTopContributors = null;
  clearHighlights();
}

/**
 * Get investigation results for a specific anomaly ID
 * @param {string} anomalyId - Anomaly ID
 * @returns {Object|null} Investigation result or null
 */
export function getInvestigationByAnomalyId(anomalyId) {
  return investigationsByAnomalyId.get(anomalyId) || null;
}

/**
 * Get anomaly ID by rank
 * @param {number} rank - Anomaly rank (1-5)
 * @returns {string|null} Anomaly ID or null
 */
export function getAnomalyIdByRank(rank) {
  const result = lastInvestigationResults.find(r => r.anomaly?.rank === rank);
  return result?.anomalyId || null;
}

/**
 * Get the last investigation results
 * @returns {Array} Last investigation results
 */
export function getLastInvestigationResults() {
  return lastInvestigationResults;
}

/**
 * Re-apply cached highlights after a facet finishes loading
 */
export function reapplyHighlightsIfCached() {
  if (cachedTopContributors && cachedTopContributors.length > 0) {
    applyHighlightsFromContributors(cachedTopContributors, getFocusedAnomalyId());
  }
}

/**
 * Check if we have cached investigation results ready
 * @returns {boolean} True if cached results are available
 */
export function hasCachedInvestigation() {
  const cacheKey = generateCacheKey();
  return cacheKey === currentCacheKey || loadCache(cacheKey, isCacheEligible) !== null;
}

/**
 * Clear selection investigation highlights only
 */
export function clearSelectionHighlights() {
  clearSelectionHighlightsImpl();
  selectionContributors = [];
}

/**
 * Query a facet for selection investigation
 */
async function investigateFacetForSelection(breakdown, selection, fullStart, fullEnd) {
  const col = typeof breakdown.col === 'function'
    ? breakdown.col(state.topN)
    : breakdown.col;

  const extra = breakdown.extraFilter || '';
  const hostFilter = getHostFilter();
  const facetFilters = getFacetFilters();
  const selectionFilter = buildTimeFilter(selection.startTime, selection.endTime);

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

    const selectionDurationMs = selection.endTime - selection.startTime;
    const baselineDurationMs = (fullEnd - fullStart) - selectionDurationMs;
    const selectionMinutes = selectionDurationMs / 60000;
    const baselineMinutes = baselineDurationMs / 60000;

    const totalSelectionCnt = result.data.reduce((sum, r) => sum + parseInt(r.selection_cnt || 0), 0);
    const totalBaselineCnt = result.data.reduce((sum, r) => sum + parseInt(r.baseline_cnt || 0), 0);
    const totalSelectionErrCnt = result.data.reduce((sum, r) => sum + parseInt(r.selection_err_cnt || 0), 0);
    const totalBaselineErrCnt = result.data.reduce((sum, r) => sum + parseInt(r.baseline_err_cnt || 0), 0);

    const analyzed = result.data.map(row => {
      const selectionCnt = parseInt(row.selection_cnt) || 0;
      const baselineCnt = parseInt(row.baseline_cnt) || 0;
      const selectionErrCnt = parseInt(row.selection_err_cnt) || 0;
      const baselineErrCnt = parseInt(row.baseline_err_cnt) || 0;

      const selectionRate = selectionMinutes > 0 ? selectionCnt / selectionMinutes : 0;
      const baselineRate = baselineMinutes > 0 ? baselineCnt / baselineMinutes : 0;

      let rateChange = 0;
      if (baselineRate > 0) {
        rateChange = ((selectionRate - baselineRate) / baselineRate) * 100;
      } else if (selectionRate > 0) {
        rateChange = Infinity;
      }

      const selectionShare = totalSelectionCnt > 0 ? (selectionCnt / totalSelectionCnt) * 100 : 0;
      const baselineShare = totalBaselineCnt > 0 ? (baselineCnt / totalBaselineCnt) * 100 : 0;
      const shareChange = selectionShare - baselineShare;

      const selectionErrShare = totalSelectionErrCnt > 0 ? (selectionErrCnt / totalSelectionErrCnt) * 100 : 0;
      const baselineErrShare = totalBaselineErrCnt > 0 ? (baselineErrCnt / totalBaselineErrCnt) * 100 : 0;
      const errShareChange = selectionErrShare - baselineErrShare;

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

    const filtered = analyzed
      .filter(r => {
        const hasVolume = r.selectionRate > 0.5 || r.baselineRate > 0.5;
        const hasSignificantChange = Math.abs(r.shareChange) > 5 || Math.abs(r.errShareChange) > 5 || Math.abs(r.errRateChange) > 5;
        return hasVolume && hasSignificantChange;
      })
      .map(r => ({
        ...r,
        maxChange: Math.max(Math.abs(r.shareChange), Math.abs(r.errShareChange), Math.abs(r.errRateChange)),
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
 * Investigate a user-selected time range
 * @param {Date} selectionStart - Start of selected time range
 * @param {Date} selectionEnd - End of selected time range
 * @param {Date} fullStart - Start of full visible time range
 * @param {Date} fullEnd - End of full visible time range
 * @returns {Promise<Array>} Array of top contributors
 */
export async function investigateTimeRange(selectionStart, selectionEnd, fullStart, fullEnd) {
  clearHighlights();
  clearSelectionHighlights();

  const facetsToInvestigate = allBreakdowns.filter(b =>
    ['breakdown-hosts', 'breakdown-forwarded-hosts', 'breakdown-paths',
     'breakdown-errors', 'breakdown-user-agents', 'breakdown-ips',
     'breakdown-asn', 'breakdown-datacenters', 'breakdown-cache',
     'breakdown-content-types', 'breakdown-backend-type'].includes(b.id)
  );

  const pseudoAnomaly = {
    startTime: selectionStart,
    endTime: selectionEnd,
    category: 'blue',
    type: 'selection',
    rank: 0
  };

  selectionContributors = [];

  const facetPromises = facetsToInvestigate.map(async (breakdown) => {
    const analysis = await investigateFacetForSelection(breakdown, pseudoAnomaly, fullStart, fullEnd);

    if (analysis.length > 0) {
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

  const sorted = [...selectionContributors].sort((a, b) => (b.maxChange || Math.abs(b.shareChange)) - (a.maxChange || Math.abs(a.shareChange)));

  console.log(`Selection investigation found ${selectionContributors.length} contributors, will highlight first ${HIGHLIGHT_TOP_N} found in DOM`);

  applySelectionHighlightsImpl(sorted);

  return sorted;
}
