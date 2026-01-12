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

  // Support dynamic col expressions that depend on topN
  const col = typeof b.col === 'function' ? b.col(state.topN) : b.col;

  const extra = b.extraFilter || '';
  // Get filters excluding this facet's column to show all values for active facets
  const facetFilters = getFacetFiltersExcluding(col);
  // Add summary countIf if defined for this breakdown
  const summaryCol = b.summaryCountIf ? `,\n      countIf(${b.summaryCountIf}) as summary_cnt` : '';

  // Check for mode toggle (e.g., count vs bytes for content-types)
  const mode = b.modeToggle ? state[b.modeToggle] : 'count';
  const isBytes = mode === 'bytes';

  // Aggregation functions depend on mode
  // Note: Using `< 400` instead of `>= 100 AND < 400` to match projection definitions
  // (HTTP status codes are always >= 100, so the >= 100 check is redundant)
  const aggTotal = isBytes ? 'sum(`response.headers.content_length`)' : 'count()';
  const aggOk = isBytes
    ? 'sumIf(`response.headers.content_length`, `response.status` < 400)'
    : 'countIf(`response.status` < 400)';
  const agg4xx = isBytes
    ? 'sumIf(`response.headers.content_length`, `response.status` >= 400 AND `response.status` < 500)'
    : 'countIf(`response.status` >= 400 AND `response.status` < 500)';
  const agg5xx = isBytes
    ? 'sumIf(`response.headers.content_length`, `response.status` >= 500)'
    : 'countIf(`response.status` >= 500)';

  // Custom orderBy or default to count descending
  const orderBy = b.orderBy || 'cnt DESC';
  const sql = `
    SELECT
      ${col} as dim,
      ${aggTotal} as cnt,
      ${aggOk} as cnt_ok,
      ${agg4xx} as cnt_4xx,
      ${agg5xx} as cnt_5xx${summaryCol}
    FROM ${DATABASE}.${getTable()}
    WHERE ${timeFilter} ${hostFilter} ${facetFilters} ${extra}
    GROUP BY dim WITH TOTALS
    ORDER BY ${orderBy}
    LIMIT ${state.topN}
  `;

  const startTime = performance.now();
  try {
    const result = await query(sql);
    // Prefer actual network time from Resource Timing API, fallback to wall clock
    const elapsed = result._networkTime ?? (performance.now() - startTime);
    facetTimings[b.id] = elapsed; // Track timing for slowest detection
    // Calculate summary ratio from totals if summaryCountIf is defined
    const summaryRatio = (b.summaryCountIf && result.totals && result.totals.cnt > 0)
      ? parseInt(result.totals.summary_cnt) / parseInt(result.totals.cnt)
      : null;
    renderBreakdownTable(b.id, result.data, result.totals, col, b.linkPrefix, b.linkSuffix, b.linkFn, elapsed, b.dimPrefixes, b.dimFormatFn, summaryRatio, b.summaryLabel, b.summaryColor, b.modeToggle);
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
