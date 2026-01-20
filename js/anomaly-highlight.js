/**
 * Anomaly highlighting module.
 * Handles DOM manipulation for highlighting investigation results in facet tables.
 *
 * @module anomaly-highlight
 */

// Number of contributors to highlight in the UI
export const HIGHLIGHT_TOP_N = 3;

/**
 * Find a row in the breakdown table by dimension value
 * Tries exact match first, then case-insensitive match as fallback
 * @param {NodeList} rows - Table rows to search
 * @param {string} dim - Dimension value to find
 * @returns {Element|null} Matching row or null
 */
export function findRowByDim(rows, dim) {
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
 * Clear all investigation highlights from the DOM
 */
export function clearHighlights() {
  document.querySelectorAll('.investigation-highlight').forEach(el => {
    el.classList.remove('investigation-highlight', 'investigation-red', 'investigation-yellow', 'investigation-green', 'investigation-blue');
    const statusColor = el.querySelector('.status-color');
    if (statusColor) statusColor.removeAttribute('title');
  });
}

/**
 * Clear selection investigation highlights only (preserve anomaly highlights)
 */
export function clearSelectionHighlights() {
  document.querySelectorAll('.investigation-highlight.investigation-blue').forEach(el => {
    el.classList.remove('investigation-highlight', 'investigation-blue');
    const statusColor = el.querySelector('.status-color');
    if (statusColor) statusColor.removeAttribute('title');
  });
}

/**
 * Apply highlights from a contributors array
 * Iterates through candidates in priority order, highlighting up to HIGHLIGHT_TOP_N that exist in DOM
 * @param {Array} contributors - Array of contributor objects sorted by priority
 * @param {string|null} focusedAnomalyId - Optional anomaly ID to filter by
 * @returns {number} Number of items actually highlighted
 */
export function applyHighlightsFromContributors(contributors, focusedAnomalyId = null) {
  // Remove existing highlights and reset titles
  clearHighlights();

  let highlightedCount = 0;

  for (const c of contributors) {
    // Stop if we've highlighted enough
    if (highlightedCount >= HIGHLIGHT_TOP_N) {
      break;
    }

    // If focused on a specific anomaly, only include its dimensions
    if (focusedAnomalyId && c.anomalyId !== focusedAnomalyId) {
      continue;
    }

    const card = document.getElementById(c.facetId);
    if (!card) continue;

    const rows = card.querySelectorAll('.breakdown-table tr');
    if (rows.length === 0) continue;

    // Try to find the row with matching dimension
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
 * Apply highlights from investigation results
 * @param {Array} investigationResults - Array of investigation result objects
 * @param {string|null} focusedAnomalyId - Optional anomaly ID to filter by
 * @param {Map} investigationsByAnomalyId - Map of anomaly ID to investigation results
 */
export function applyHighlights(investigationResults, focusedAnomalyId = null, investigationsByAnomalyId = null) {
  // Remove existing highlights and reset titles
  clearHighlights();

  // Build a map of facetId -> dim -> { category, shareChange, anomalyId, rank }
  const highlightMap = new Map();

  // If focused on a specific anomaly, try to get its results from the persistent map
  if (focusedAnomalyId && investigationsByAnomalyId) {
    const persistedResult = investigationsByAnomalyId.get(focusedAnomalyId);
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
    for (const result of investigationResults) {
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
 * Apply blue highlights for selection investigation
 * Iterates through contributors in priority order, highlighting first HIGHLIGHT_TOP_N that exist in DOM
 * @param {Array} contributors - Array of contributor objects sorted by priority
 * @returns {number} Number of items actually highlighted
 */
export function applySelectionHighlights(contributors) {
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

    // Try to find the row with matching dimension
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
      console.log(`  Highlighted #${appliedCount}: ${c.facetId} = "${c.dim}" (${sign}${c.shareChange}pp)`);
    }
  }

  console.log(`  Applied ${appliedCount}/${HIGHLIGHT_TOP_N} selection highlights`);
  return appliedCount;
}

/**
 * Get highlighted dimensions for a specific facet
 * @param {string} facetId - Facet ID (e.g., 'breakdown-hosts')
 * @param {Array} investigationResults - Investigation results
 * @param {string|null} focusedAnomalyId - Optional anomaly ID to filter by
 * @returns {Set<string>} Set of dimension values to highlight
 */
export function getHighlightedDimensions(facetId, investigationResults, focusedAnomalyId = null) {
  const highlighted = new Set();

  for (const result of investigationResults) {
    // If focused on a specific anomaly, only include its dimensions
    if (focusedAnomalyId && result.anomalyId !== focusedAnomalyId) {
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
