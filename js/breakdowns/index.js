// Breakdown loading and management
import { DATABASE } from '../config.js';
import { state } from '../state.js';
import { query } from '../api.js';
import { getTimeFilter, getHostFilter, getTable } from '../time.js';
import { allBreakdowns } from './definitions.js';
import { renderBreakdownTable, renderBreakdownError, getNextTopN } from './render.js';

// Track elapsed time per facet id for slowest detection
export let facetTimings = {};

export function resetFacetTimings() {
  facetTimings = {};
}

// Build facet filter SQL excluding a specific column
function buildFacetFilterSQL(filters) {
  if (filters.length === 0) return '';

  // Group filters by column (use filterCol for SQL if present)
  const byColumn = {};
  for (const f of filters) {
    const sqlCol = f.filterCol || f.col;
    const sqlValue = f.filterValue ?? f.value;
    if (!byColumn[f.col]) byColumn[f.col] = { sqlCol, includes: [], excludes: [] };
    // Use numeric comparison for integer filter values, string otherwise
    const isNumeric = typeof sqlValue === 'number';
    const escaped = isNumeric ? sqlValue : sqlValue.replace(/'/g, "\\'");
    const comparison = isNumeric ? escaped : `'${escaped}'`;
    if (f.exclude) {
      byColumn[f.col].excludes.push(`${sqlCol} != ${comparison}`);
    } else {
      byColumn[f.col].includes.push(`${sqlCol} = ${comparison}`);
    }
  }

  // Build SQL for each column group
  const columnClauses = [];
  for (const col of Object.keys(byColumn)) {
    const { includes, excludes } = byColumn[col];
    const parts = [];
    // Include filters: OR together (match any of these values)
    if (includes.length > 0) {
      parts.push(includes.length === 1 ? includes[0] : `(${includes.join(' OR ')})`);
    }
    // Exclude filters: AND together (exclude all of these values)
    if (excludes.length > 0) {
      parts.push(excludes.join(' AND '));
    }
    // Combine includes and excludes for this column with AND
    columnClauses.push(parts.length === 1 ? parts[0] : `(${parts.join(' AND ')})`);
  }

  // Combine all column clauses with AND
  return columnClauses.map(c => `AND ${c}`).join(' ');
}

export function getFacetFilters() {
  return buildFacetFilterSQL(state.filters);
}

export function getFacetFiltersExcluding(col) {
  return buildFacetFilterSQL(state.filters.filter(f => f.col !== col));
}

export async function loadAllBreakdowns() {
  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  await Promise.all(allBreakdowns.map(b => loadBreakdown(b, timeFilter, hostFilter)));
}

export async function loadBreakdown(b, timeFilter, hostFilter) {
  const card = document.getElementById(b.id);
  card.classList.add('updating');

  const extra = b.extraFilter || '';
  // Get filters excluding this facet's column to show all values for active facets
  const facetFilters = getFacetFiltersExcluding(b.col);
  const sql = `
    SELECT
      ${b.col} as dim,
      count() as cnt,
      countIf(\`response.status\` >= 100 AND \`response.status\` < 400) as cnt_ok,
      countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx,
      countIf(\`response.status\` >= 500) as cnt_5xx
    FROM ${DATABASE}.${getTable()}
    WHERE ${timeFilter} ${hostFilter} ${facetFilters} ${extra}
    GROUP BY dim WITH TOTALS
    ORDER BY cnt DESC
    LIMIT ${state.topN}
  `;

  const startTime = performance.now();
  try {
    const result = await query(sql);
    // Prefer actual network time from Resource Timing API, fallback to wall clock
    const elapsed = result._networkTime ?? (performance.now() - startTime);
    facetTimings[b.id] = elapsed; // Track timing for slowest detection
    renderBreakdownTable(b.id, result.data, result.totals, b.col, b.linkPrefix, b.linkSuffix, b.linkFn, elapsed, b.dimPrefixes, b.dimFormatFn);
  } catch (err) {
    console.error(`Breakdown error (${b.id}):`, err);
    renderBreakdownError(b.id, err.message);
  } finally {
    card.classList.remove('updating');
  }
}

// Mark the slowest facet with a glow
export function markSlowestFacet() {
  // Remove existing slowest markers
  document.querySelectorAll('.speed-indicator.slowest').forEach(el => {
    el.classList.remove('slowest');
  });

  // Find the slowest facet
  let slowestId = null;
  let slowestTime = 0;
  for (const [id, time] of Object.entries(facetTimings)) {
    if (time > slowestTime) {
      slowestTime = time;
      slowestId = id;
    }
  }

  // Add slowest class to the indicator
  if (slowestId) {
    const card = document.getElementById(slowestId);
    const indicator = card?.querySelector('.speed-indicator');
    if (indicator) {
      indicator.classList.add('slowest');
    }
  }
}

// Increase topN and reload breakdowns
export function increaseTopN(topNSelect, saveStateToURL, loadAllBreakdownsFn) {
  const next = getNextTopN();
  if (next) {
    state.topN = next;
    topNSelect.value = next;
    saveStateToURL();
    loadAllBreakdownsFn();
  }
}

// Re-export for convenience
export { allBreakdowns } from './definitions.js';
