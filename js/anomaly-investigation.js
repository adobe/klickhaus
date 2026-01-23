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
 * UI plane for anomaly investigation - handles highlighting and DOM manipulation.
 * Data/query concerns are in investigation-data.js.
 */

import { getTimeFilter } from './time.js';
import { getFacetFilters } from './breakdowns/index.js';
import { allBreakdowns } from './breakdowns/definitions.js';
import { parseUTC } from './chart-state.js';
import {
  CACHE_TOP_N,
  HIGHLIGHT_TOP_N,
  generateAnomalyId,
  generateCacheKey,
  getQueryContext,
  isCacheEligible,
  loadCachedInvestigation,
  saveCachedInvestigation,
  cleanupOldCaches,
  investigateFacet,
  investigateFacetForSelection,
} from './investigation-data.js';

// Store last investigation results for UI integration
let lastInvestigationResults = [];

// Cache key for current investigation context
let currentCacheKey = null;
// Store context for memory cache eligibility check
let currentCacheContext = null;

// Store cached top contributors for re-applying highlights as facets load
let cachedTopContributors = null;

// Store investigation results by anomaly ID for persistent access across zooms
const investigationsByAnomalyId = new Map();

// Track all contributors for progressive highlighting
let allContributors = [];

// Store selection investigation contributors for highlighting
let selectionContributors = [];

/**
 * Store anomaly ID on detected step (called from investigation)
 * @param {number} rank - Step rank
 * @param {string} id - Anomaly ID
 */
function storeAnomalyIdOnStep(rank, id) {
  // This will be used by chart.js to access IDs when zooming
  window.anomalyIdsByRank = window.anomalyIdsByRank || {};
  window.anomalyIdsByRank[rank] = id;
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
 * Find a row in the breakdown table by dimension value
 * Tries exact match first, then case-insensitive match as fallback
 * @param {NodeList} rows - Table rows to search
 * @param {string} dim - Dimension value to find
 * @returns {Element|null} Matching row or null
 */
function findRowByDim(rows, dim) {
  const rowArray = Array.from(rows);
  // Try exact match first
  let row = rowArray.find((r) => r.dataset.dim === dim);
  if (!row && dim) {
    // Fallback to case-insensitive match
    const dimLower = dim.toLowerCase();
    row = rowArray.find((r) => r.dataset.dim?.toLowerCase() === dimLower);
  }
  return row || null;
}

/**
 * Apply highlights from a contributors array (for progressive highlighting)
 * Iterates through candidates in priority order, highlighting up to
 * HIGHLIGHT_TOP_N that exist in DOM
 * @param {Array} contributors - Array of contributor objects with facetId,
 *   dim, category, etc. (sorted by priority)
 * @returns {number} Number of items actually highlighted
 */
function applyHighlightsFromContributors(contributors) {
  // Remove existing highlights and reset titles
  document.querySelectorAll('.investigation-highlight').forEach((el) => {
    el.classList.remove(
      'investigation-highlight',
      'investigation-red',
      'investigation-yellow',
      'investigation-green',
      'investigation-blue',
    );
    const statusColor = el.querySelector('.status-color');
    if (statusColor) statusColor.removeAttribute('title');
  });

  const focusedId = getFocusedAnomalyId();

  // Iterate through contributors in priority order, highlight first N that exist in DOM
  let highlightedCount = 0;

  for (const c of contributors) {
    // Stop if we've highlighted enough
    if (highlightedCount >= HIGHLIGHT_TOP_N) {
      break;
    }

    // Skip if focused on a specific anomaly and this isn't it
    const shouldProcess = !focusedId || c.anomalyId === focusedId;
    if (shouldProcess) {
      const card = document.getElementById(c.facetId);
      if (card) {
        const rows = card.querySelectorAll('.breakdown-table tr');
        if (rows.length > 0) {
          // Try to find the row with matching dimension (case-insensitive fallback)
          const row = findRowByDim(rows, c.dim);
          if (row) {
            row.classList.add('investigation-highlight', `investigation-${c.category}`);
            highlightedCount += 1;
            // eslint-disable-next-line no-console
            console.log(`  Highlighted #${highlightedCount}: ${c.facetId} = "${c.dim}" (+${c.shareChange}pp)`);
            const statusColor = row.querySelector('.status-color');
            if (statusColor) {
              statusColor.title = `+${c.shareChange}pp share of #${c.rank} ${c.anomalyId}`;
            }
          }
        }
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
  document.querySelectorAll('.investigation-highlight').forEach((el) => {
    el.classList.remove(
      'investigation-highlight',
      'investigation-red',
      'investigation-yellow',
      'investigation-green',
      'investigation-blue',
    );
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
      const { anomalyId } = persistedResult;
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
            rank,
          });
        }
      }
    }
  } else {
    // No specific focus - highlight from all current results (use highest share change per dim)
    for (const result of lastInvestigationResults) {
      const category = result.anomaly?.category || 'red';
      const { anomalyId } = result;
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
              rank,
            });
          }
        }
      }
    }
  }

  // Apply highlights to matching rows
  for (const [facetId, dimInfoMap] of highlightMap) {
    const card = document.getElementById(facetId);
    if (card) {
      const rows = card.querySelectorAll('.breakdown-table tr');
      if (rows.length > 0) {
        for (const [expectedDim, info] of dimInfoMap) {
          const row = findRowByDim(rows, expectedDim);
          if (row) {
            row.classList.add('investigation-highlight', `investigation-${info.category}`);
            const statusColor = row.querySelector('.status-color');
            if (statusColor) {
              const title = `+${info.shareChange}pp share of #${info.rank} ${info.anomalyId}`;
              statusColor.title = title;
            }
          }
        }
      }
    }
  }
}

/**
 * Clear all investigation highlights
 */
export function clearHighlights() {
  document.querySelectorAll('.investigation-highlight').forEach((el) => {
    el.classList.remove('investigation-highlight');
  });
}

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
    return [];
  }

  // Generate cache key for current context
  const cacheKey = generateCacheKey();
  // eslint-disable-next-line no-console
  console.log(`Investigation cache key: ${cacheKey} (${window.location.pathname}${window.location.search})`);

  // Check if we have cached results for this context (memory cache)
  // Must also verify context eligibility (drill-in allowed, drill-out not)
  if (cacheKey === currentCacheKey && lastInvestigationResults.length > 0 && currentCacheContext) {
    if (isCacheEligible(currentCacheContext)) {
      // eslint-disable-next-line no-console
      console.log('Memory cache eligible, applying highlights');
      // Use cached contributors if available, otherwise fall back to applyHighlights
      let highlightCount = 0;
      if (cachedTopContributors && cachedTopContributors.length > 0) {
        highlightCount = applyHighlightsFromContributors(cachedTopContributors);
        // eslint-disable-next-line no-console
        console.log(`Applied ${highlightCount}/${HIGHLIGHT_TOP_N} highlights from memory cache`);
      } else {
        applyHighlights();
        highlightCount = HIGHLIGHT_TOP_N; // Assume enough for old format
      }
      // If enough highlights, return cached results
      if (highlightCount >= HIGHLIGHT_TOP_N) {
        // eslint-disable-next-line no-console
        console.log('Memory cache sufficient');
        return lastInvestigationResults;
      }
      // Not enough highlights visible after drill-down, need fresh investigation
      // eslint-disable-next-line no-console
      console.log(`Only ${highlightCount}/${HIGHLIGHT_TOP_N} highlighted from memory cache, fetching fresh candidates`);
      currentCacheKey = null;
      currentCacheContext = null;
      // Fall through to fresh investigation
    } else {
      // eslint-disable-next-line no-console
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
    // Store top contributors for re-applying as facets load
    // (keep all cached, function limits to HIGHLIGHT_TOP_N)
    let highlightedFromCache = 0;
    if (cached.topContributors && cached.topContributors.length > 0) {
      cachedTopContributors = cached.topContributors;
      // Apply highlights immediately (some facets may already be loaded)
      highlightedFromCache = applyHighlightsFromContributors(cachedTopContributors);
      // eslint-disable-next-line no-console
      console.log(`Applied ${highlightedFromCache}/${HIGHLIGHT_TOP_N} highlights from cache`);
    } else {
      cachedTopContributors = null;
      // Fallback for old cache format
      applyHighlights();
      highlightedFromCache = HIGHLIGHT_TOP_N; // Assume enough for old format
      // eslint-disable-next-line no-console
      console.log('Applied highlights from old cache format');
    }

    // If we couldn't highlight enough values (e.g., after drill-down filtered them out),
    // fall through to run a fresh investigation which will create a new cache entry
    if (highlightedFromCache >= HIGHLIGHT_TOP_N) {
      // eslint-disable-next-line no-console
      console.log('Cache sufficient, skipping fresh investigation');
      return lastInvestigationResults;
    }
    // eslint-disable-next-line no-console
    console.log(`Only ${highlightedFromCache}/${HIGHLIGHT_TOP_N} highlighted, fetching fresh candidates`);
    // Clear stale cache data before fresh investigation
    currentCacheKey = null;
    currentCacheContext = null;
  }

  // Get base context for stable IDs
  const baseTimeFilter = getTimeFilter();
  const baseFacetFilters = getFacetFilters();
  // eslint-disable-next-line no-console
  console.log('Starting fresh investigation');

  // Reset state for new investigation
  lastInvestigationResults = [];
  allContributors = [];

  // Get full time range from chart data
  if (!chartData || chartData.length < 2) {
    // eslint-disable-next-line no-console
    console.log('No chart data for investigation');
    return [];
  }
  const fullStart = parseUTC(chartData[0].t);
  const fullEnd = parseUTC(chartData[chartData.length - 1].t);

  // Select facets to investigate
  const facetsToInvestigate = allBreakdowns.filter((b) => ['breakdown-hosts', 'breakdown-forwarded-hosts', 'breakdown-paths',
    'breakdown-errors', 'breakdown-user-agents', 'breakdown-ips',
    'breakdown-asn', 'breakdown-datacenters', 'breakdown-cache',
    'breakdown-content-types', 'breakdown-backend-type'].includes(b.id));

  // Helper to process a single facet investigation
  const processFacetInvestigation = async (breakdown, anomaly, anomalyId, result) => {
    const analysis = await investigateFacet(breakdown, anomaly, fullStart, fullEnd);

    if (analysis.length > 0) {
      // Store results in the result object (intentional mutation)
      // eslint-disable-next-line no-param-reassign
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
          ...item,
        });
      }

      // Progressive update - re-rank and highlight after each facet completes
      updateProgressiveHighlights();
    }

    return { facetId: breakdown.id, analysis };
  };

  // Process each anomaly sequentially (results depend on order)
  for (const anomaly of anomalies) {
    // Generate stable car-themed ID for this anomaly (color matches severity)
    const anomalyId = generateAnomalyId(
      baseTimeFilter,
      baseFacetFilters,
      anomaly.startTime,
      anomaly.endTime,
      anomaly.category,
    );

    // Initialize result structure for this anomaly
    const result = { anomaly, anomalyId, facets: {} };
    result.anomaly.id = anomalyId;
    lastInvestigationResults.push(result);

    // Store for persistent access and set on detected step
    investigationsByAnomalyId.set(anomalyId, result);
    storeAnomalyIdOnStep(anomaly.rank, anomalyId);

    // Launch all facet investigations in parallel with callbacks
    const facetPromises = facetsToInvestigate.map(
      (breakdown) => processFacetInvestigation(breakdown, anomaly, anomalyId, result),
    );

    // Wait for all facets for this anomaly to complete before moving to next
    // eslint-disable-next-line no-await-in-loop
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
    topContributors: topForCache,
  });
  cleanupOldCaches();

  if (allContributors.length === 0) {
    clearHighlights();
  }

  return lastInvestigationResults;
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
    // Only include dimensions if not focused or this is the focused anomaly
    const shouldInclude = !focusedId || result.anomalyId === focusedId;
    if (shouldInclude) {
      const facetResults = result.facets[facetId];
      if (facetResults) {
        for (const item of facetResults) {
          highlighted.add(item.dim);
        }
      }
    }
  }

  return highlighted;
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
  const result = lastInvestigationResults.find((r) => r.anomaly?.rank === rank);
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

/**
 * Clear selection investigation highlights only (preserve anomaly highlights)
 */
export function clearSelectionHighlights() {
  document.querySelectorAll('.investigation-highlight.investigation-blue').forEach((el) => {
    el.classList.remove('investigation-highlight', 'investigation-blue');
    const statusColor = el.querySelector('.status-color');
    if (statusColor) statusColor.removeAttribute('title');
  });
  selectionContributors = [];
}

/**
 * Apply blue highlights for selection investigation
 * Iterates through contributors in priority order, highlighting first
 * HIGHLIGHT_TOP_N that exist in DOM
 * @param {Array} contributors - Sorted array of contributors
 * @returns {number} Number applied
 */
function applySelectionHighlights(contributors) {
  let appliedCount = 0;

  for (const c of contributors) {
    // Stop if we've highlighted enough
    if (appliedCount >= HIGHLIGHT_TOP_N) {
      break;
    }

    const card = document.getElementById(c.facetId);
    if (card) {
      const rows = card.querySelectorAll('.breakdown-table tr');
      if (rows.length > 0) {
        // Try to find row with matching dimension (case-insensitive fallback)
        const row = findRowByDim(rows, c.dim);
        if (row) {
          row.classList.add('investigation-highlight', 'investigation-blue');
          const statusColor = row.querySelector('.status-color');
          if (statusColor) {
            const sign = c.shareChange >= 0 ? '+' : '';
            const direction = c.shareChange >= 0 ? 'over' : 'under';
            const title = `${sign}${c.shareChange}pp (${direction}-represented)`;
            statusColor.title = title;
          }
          appliedCount += 1;
          const sign = c.shareChange >= 0 ? '+' : '';
          // eslint-disable-next-line no-console
          console.log(`  ✓ Highlighted #${appliedCount}: ${c.facetId} = "${c.dim}" (${sign}${c.shareChange}pp)`);
        }
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(`  Applied ${appliedCount}/${HIGHLIGHT_TOP_N} selection highlights`);
  return appliedCount;
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
  const facetsToInvestigate = allBreakdowns.filter((b) => ['breakdown-hosts', 'breakdown-forwarded-hosts', 'breakdown-paths',
    'breakdown-errors', 'breakdown-user-agents', 'breakdown-ips',
    'breakdown-asn', 'breakdown-datacenters', 'breakdown-cache',
    'breakdown-content-types', 'breakdown-backend-type'].includes(b.id));

  // Create a pseudo-anomaly object for the investigateFacet function
  // Use 'blue' as a special category that investigates ALL traffic (not filtered by status)
  const pseudoAnomaly = {
    startTime: selectionStart,
    endTime: selectionEnd,
    category: 'blue',
    type: 'selection',
    rank: 0,
  };

  selectionContributors = [];

  // Launch all facet investigations in parallel
  const facetPromises = facetsToInvestigate.map(async (breakdown) => {
    const analysis = await investigateFacetForSelection(
      breakdown,
      pseudoAnomaly,
      fullStart,
      fullEnd,
    );

    if (analysis.length > 0) {
      // Add to contributors list
      for (const item of analysis) {
        selectionContributors.push({
          facet: breakdown.id.replace('breakdown-', ''),
          facetId: breakdown.id,
          category: 'blue',
          ...item,
        });
      }
    }

    return { facetId: breakdown.id, analysis };
  });

  await Promise.all(facetPromises);

  // Sort by max change and apply highlights
  // (pass all, function will find first N in DOM)
  const sorted = [...selectionContributors].sort((a, b) => {
    const aVal = b.maxChange || Math.abs(b.shareChange);
    const bVal = a.maxChange || Math.abs(a.shareChange);
    return aVal - bVal;
  });

  // eslint-disable-next-line no-console
  console.log(
    `Selection investigation found ${selectionContributors.length} contributors,`
    + ` will highlight first ${HIGHLIGHT_TOP_N} found in DOM`,
  );

  applySelectionHighlights(sorted);

  return sorted;
}
