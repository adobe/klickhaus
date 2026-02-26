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
import { DATABASE } from '../config.js';
import { state } from '../state.js';
import { query, getQueryErrorDetails, isAbortError } from '../api.js';
import {
  startRequestContext, getRequestContext, isRequestCurrent, mergeAbortSignals,
} from '../request-context.js';
import {
  getTimeFilter, getHostFilter, getTable, getSamplingConfig, getFacetTimeFilter,
} from '../time.js';
import { allBreakdowns as defaultBreakdowns } from './definitions.js';
import { renderBreakdownTable, renderBreakdownError, getNextTopN } from './render.js';
import { compileFilters } from '../filter-sql.js';
import { getFiltersForColumn } from '../filters.js';
import { loadSql } from '../sql-loader.js';
import { createLimiter } from '../concurrency-limiter.js';
import {
  fetchBreakdownData as fetchCoralogixBreakdown,
} from '../coralogix/adapter.js';

// Intentionally limits only breakdown queries: breakdowns fan out 20+ parallel
// queries (one per facet), the only code path with bulk parallelism. Chart, logs,
// and autocomplete each fire 1-2 queries and don't need limiting.
const queryLimiter = createLimiter(1);

export function getBreakdowns() {
  return state.breakdowns?.length ? state.breakdowns : defaultBreakdowns;
}

// Track elapsed time per facet id for slowest detection
export const facetTimings = {};

/**
 * Check whether a breakdown can use the pre-aggregated cdn_facet_minutes table.
 * Requires: facetName set, no active filters, no bytes mode, not bucketed.
 */
export function canUseFacetTable(b) {
  if (!b.facetName) return false;
  if (b.rawCol) return false; // bucketed facets need raw table
  if (b.highCardinality) return false; // sampled raw table is faster
  if (state.hostFilter) return false;
  if (state.filters && state.filters.length > 0) return false;
  if (state.additionalWhereClause) return false;
  const mode = b.modeToggle ? state[b.modeToggle] : 'count';
  if (mode === 'bytes') return false;
  // ASN uses dictGet which produces different dim values than the facet table
  if (b.id === 'breakdown-asn') return false;
  return true;
}

export function resetFacetTimings() {
  Object.keys(facetTimings).forEach((key) => {
    delete facetTimings[key];
  });
}

export function getFacetFilters() {
  return compileFilters(state.filters).sql;
}

export function getFacetFiltersExcluding(col) {
  return compileFilters(state.filters.filter((f) => f.col !== col)).sql;
}

/**
 * Render hidden facet as minimal pill
 */
function renderHiddenFacet(cardEl, b) {
  const el = cardEl;
  if (!el.dataset.title) {
    const h3 = el.querySelector('h3');
    el.dataset.title = h3 ? h3.textContent.trim() : b.id.replace('breakdown-', '');
  }
  el.innerHTML = `<h3>${el.dataset.title}</h3>`
    + '<button class="facet-hide-btn" data-action="toggle-facet-hide" '
    + `data-facet="${b.id}" title="Show facet"></button>`;
  el.classList.add('facet-hidden');
  el.classList.remove('updating');
  el.dataset.action = 'toggle-facet-hide';
  el.dataset.facet = b.id;
}

/**
 * Build aggregation SQL expressions based on mode
 * @param {boolean} isBytes - Whether to aggregate bytes instead of counts
 * @param {string} mult - Multiplier suffix for sampling
 * @returns {Object} Aggregation expressions
 */
function buildAggregations(isBytes, mult) {
  if (state.aggregations) {
    return {
      aggTotal: state.aggregations.aggTotal + mult,
      aggOk: state.aggregations.aggOk + mult,
      agg4xx: state.aggregations.agg4xx + mult,
      agg5xx: state.aggregations.agg5xx + mult,
    };
  }
  return {
    aggTotal: isBytes ? `sum(\`response.headers.content_length\`)${mult}` : `count()${mult}`,
    aggOk: isBytes
      ? `sumIf(\`response.headers.content_length\`, \`response.status\` < 400)${mult}`
      : `countIf(\`response.status\` < 400)${mult}`,
    agg4xx: isBytes
      ? `sumIf(\`response.headers.content_length\`, \`response.status\` >= 400 AND \`response.status\` < 500)${mult}`
      : `countIf(\`response.status\` >= 400 AND \`response.status\` < 500)${mult}`,
    agg5xx: isBytes
      ? `sumIf(\`response.headers.content_length\`, \`response.status\` >= 500)${mult}`
      : `countIf(\`response.status\` >= 500)${mult}`,
  };
}

/**
 * Fill in missing buckets for continuous range facets
 */
function fillExpectedLabels(data, b) {
  if (!b.getExpectedLabels) return data;

  const expectedLabels = b.getExpectedLabels(state.topN);
  const existingByLabel = new Map(data.map((row) => [row.dim, row]));
  return expectedLabels.map((label) => existingByLabel.get(label) || {
    dim: label, cnt: 0, cnt_ok: 0, cnt_4xx: 0, cnt_5xx: 0,
  });
}

/**
 * Fetch and append missing filtered values to data
 */
async function appendMissingFilteredValues(data, b, col, aggs, queryParams, requestStatus) {
  const { isCurrent, signal } = requestStatus || {};
  const shouldApply = () => (typeof isCurrent === 'function' ? isCurrent() : true);
  const { originalCol, isBytes, mult } = queryParams;
  const filtersForCol = getFiltersForColumn(originalCol);
  if (filtersForCol.length === 0 || b.getExpectedLabels) return data;

  const existingDims = new Set(data.map((row) => row.dim));
  const missingFilterValues = filtersForCol
    .map((f) => f.value)
    .filter((v) => v !== '' && !existingDims.has(v));

  if (missingFilterValues.length === 0) return data;

  const searchCol = b.filterCol || col;
  const valuesList = missingFilterValues
    .map((v) => `'${v.replace(/'/g, "''")}'`)
    .join(', ');

  const missingValuesSql = await loadSql('breakdown-missing', {
    col,
    aggTotal: isBytes ? `sum(\`response.headers.content_length\`)${mult}` : `count()${mult}`,
    aggOk: aggs.aggOk,
    agg4xx: aggs.agg4xx,
    agg5xx: aggs.agg5xx,
    database: DATABASE,
    table: getTable(),
    sampleClause: queryParams.sampleClause,
    timeFilter: queryParams.timeFilter,
    hostFilter: queryParams.hostFilter,
    extra: queryParams.extra,
    additionalWhereClause: state.additionalWhereClause,
    searchCol,
    valuesList,
  });

  try {
    if (!shouldApply()) return data;
    const missingResult = await query(missingValuesSql, { signal });
    if (!shouldApply()) return data;
    if (missingResult.data && missingResult.data.length > 0) {
      const markedRows = missingResult.data.map((row) => ({
        ...row,
        isFilteredValue: true,
      }));
      return [...data, ...markedRows];
    }
  } catch (err) {
    if (!shouldApply()) return data;
    if (isAbortError(err)) return data;
    // Silently ignore errors fetching filtered values
  }
  return data;
}

/**
 * Build SQL query parameters for breakdown
 */
function buildBreakdownQueryParams(b, col, timeFilter, hostFilter, samplingOverride) {
  const originalCol = typeof b.col === 'function' ? b.col(state.topN) : b.col;
  const hasActiveFilter = b.filterOp === 'LIKE' && b.filterCol
    && state.filters.some((f) => f.col === originalCol);
  const actualCol = hasActiveFilter ? b.filterCol : col;

  const mode = b.modeToggle ? state[b.modeToggle] : 'count';
  const isBytes = mode === 'bytes';
  const { sampleClause, multiplier } = samplingOverride || getSamplingConfig();
  const mult = multiplier > 1 ? ` * ${multiplier}` : '';

  return {
    col: actualCol,
    originalCol,
    hasActiveFilter,
    isBytes,
    sampleClause,
    mult,
    extra: b.extraFilter || '',
    facetFilters: getFacetFiltersExcluding(originalCol),
    timeFilter,
    hostFilter,
  };
}

/**
 * Build the WHERE clause, appending a dedup-defeating condition when
 * a refinement pass overrides sampling to full fidelity (multiplier === 1).
 */
function buildDedupClause(samplingOverride) {
  const base = state.additionalWhereClause || '';
  if (!samplingOverride || samplingOverride.multiplier !== 1 || samplingOverride.sampleClause) {
    return base;
  }
  return base
    ? `${base}\n  AND sample_hash >= 0`
    : 'AND sample_hash >= 0';
}

function createRequestStatus(requestContext) {
  const globalContext = getRequestContext('facets');
  const activeContext = requestContext || globalContext;
  const combinedSignal = mergeAbortSignals([activeContext.signal, globalContext.signal]);
  const isCurrent = () => isRequestCurrent(activeContext.requestId, activeContext.scope)
    && isRequestCurrent(globalContext.requestId, globalContext.scope);
  return { isCurrent, signal: combinedSignal };
}

function prepareBreakdownCard(card, b) {
  if (state.hiddenFacets.includes(b.id)) {
    renderHiddenFacet(card, b);
    return false;
  }

  card.removeAttribute('data-action');
  card.removeAttribute('data-facet');
  card.classList.remove('facet-hidden');
  card.classList.add('updating');
  return true;
}

/**
 * Check whether a refinement pass should use the approx_top_count template.
 * High-cardinality GROUP BY over the full dataset can OOM; approx_top_count
 * finds top-N candidates in bounded memory, then computes exact counts.
 */
function isApproxTopRefinement(b, samplingOverride) {
  if (!b.highCardinality) return false;
  if (!samplingOverride) return false;
  // Refinement pass: no SAMPLE clause, multiplier === 1
  return samplingOverride.multiplier === 1 && !samplingOverride.sampleClause;
}

async function buildApproxTopSql(b, params, aggs, dedupClause, timeFilter, hostFilter) {
  const summaryCol = b.summaryCountIf
    ? `,\n  countIf(${b.summaryCountIf}) as summary_cnt`
    : '';

  const sql = await loadSql('breakdown-approx-top', {
    col: params.col,
    ...aggs,
    summaryCol,
    database: DATABASE,
    table: getTable(),
    sampleClause: params.sampleClause || '',
    timeFilter,
    hostFilter,
    facetFilters: params.facetFilters,
    extra: params.extra,
    additionalWhereClause: dedupClause,
    topN: String(state.topN),
  });

  return {
    sql, params, aggs, approxTop: true,
  };
}

// Legacy ClickHouse query builder - kept for reference
// eslint-disable-next-line no-unused-vars
async function buildBreakdownSql(b, timeFilter, hostFilter, samplingOverride) {
  const baseCol = typeof b.col === 'function' ? b.col(state.topN) : b.col;

  // Use pre-aggregated facet table when no filters are active
  if (canUseFacetTable(b)) {
    const { startTime, endTime } = getFacetTimeFilter();
    const dimFilter = b.extraFilter ? "AND dim != ''" : '';
    const hasSummary = !!b.summaryDimCondition;
    const sql = await loadSql('breakdown-facet', {
      database: DATABASE,
      facetName: b.facetName,
      startTime,
      endTime,
      dimFilter,
      innerSummaryCol: hasSummary
        ? `,\n    if(${b.summaryDimCondition}, cnt, 0) as summary_cnt`
        : '',
      summaryCol: hasSummary
        ? ',\n  sum(summary_cnt) as summary_cnt'
        : '',
      orderBy: b.orderBy || 'cnt DESC',
      topN: String(state.topN),
    });

    const params = {
      col: baseCol,
      originalCol: baseCol,
      hasActiveFilter: false,
      isBytes: false,
      sampleClause: '',
      mult: '',
      extra: '',
      facetFilters: '',
      timeFilter,
      hostFilter,
    };
    return { sql, params, aggs: buildAggregations(false, '') };
  }

  const params = buildBreakdownQueryParams(b, baseCol, timeFilter, hostFilter, samplingOverride);
  const aggs = buildAggregations(params.isBytes, params.mult);

  const dedupClause = buildDedupClause(samplingOverride);

  // Two-level query for bucket facets with rawCol (hits raw-value projection)
  if (b.rawCol && typeof b.col === 'function') {
    const bucketExpr = b.col(state.topN, 'val');
    const innerSummary = b.summaryCountIf
      ? `,\n    countIf(${b.summaryCountIf})${params.mult} as summary_cnt`
      : '';
    const outerSummary = b.summaryCountIf
      ? ',\n  sum(summary_cnt) as summary_cnt'
      : '';

    const sql = await loadSql('breakdown-bucketed', {
      bucketExpr,
      rawCol: b.rawCol,
      ...aggs,
      innerSummaryCol: innerSummary,
      outerSummaryCol: outerSummary,
      database: DATABASE,
      table: getTable(),
      sampleClause: params.sampleClause,
      timeFilter,
      hostFilter,
      facetFilters: params.facetFilters,
      extra: params.extra,
      additionalWhereClause: dedupClause,
      topN: String(state.topN),
    });

    return { sql, params, aggs };
  }

  // High-cardinality refinement: use approx_top_count to avoid OOM
  if (isApproxTopRefinement(b, samplingOverride)) {
    return buildApproxTopSql(b, params, aggs, dedupClause, timeFilter, hostFilter);
  }

  const summaryColWithMult = b.summaryCountIf
    ? `,\n      countIf(${b.summaryCountIf})${params.mult} as summary_cnt`
    : '';

  const sql = await loadSql('breakdown', {
    col: params.col,
    ...aggs,
    summaryCol: summaryColWithMult,
    database: DATABASE,
    table: getTable(),
    sampleClause: params.sampleClause,
    timeFilter,
    hostFilter,
    facetFilters: params.facetFilters,
    extra: params.extra,
    additionalWhereClause: dedupClause,
    orderBy: b.orderBy || 'cnt DESC',
    topN: String(state.topN),
  });

  return { sql, params, aggs };
}

function getSummaryRatio(b, totals) {
  if (!b.summaryCountIf || !totals || totals.cnt <= 0) return null;
  if (totals.summary_cnt === undefined) return null;
  return parseInt(totals.summary_cnt, 10) / parseInt(totals.cnt, 10);
}

/**
 * Extract the synthetic totals row from an approx_top_count UNION ALL result.
 * The last row has dim === '' and contains aggregate totals over the full dataset.
 */
// eslint-disable-next-line no-unused-vars
function extractApproxTopTotals(result) {
  const { data } = result;
  if (!data || data.length === 0) return { data: [], totals: {} };

  const lastRow = data[data.length - 1];
  if (lastRow.dim === '') {
    return { data: data.slice(0, -1), totals: lastRow };
  }
  // Fallback: no totals row found (shouldn't happen with correct template)
  return { data, totals: result.totals || {} };
}

async function fetchBreakdownData(b, timeFilter, hostFilter, requestStatus) {
  const { isCurrent, signal } = requestStatus;

  // Note: samplingOverride parameter removed - Coralogix handles sampling internally

  // Get facet column name (handle function-based columns)
  const facetCol = typeof b.col === 'function' ? b.col(state.topN) : b.col;

  // Build params object for compatibility with appendMissingFilteredValues
  const params = {
    col: facetCol,
    originalCol: facetCol,
    hasActiveFilter: false,
    isBytes: false,
    sampleClause: '',
    mult: '',
    extra: b.extraFilter || '',
    facetFilters: getFacetFiltersExcluding(facetCol),
    timeFilter,
    hostFilter,
  };

  const startTime = performance.now();

  // Call Coralogix adapter
  const result = await queryLimiter(() => fetchCoralogixBreakdown({
    facet: facetCol,
    topN: state.topN,
    filters: state.filters,
    hostFilter: state.hostFilter,
    timeRange: state.timeRange,
    extraFilter: b.extraFilter || '',
    orderBy: b.orderBy || 'cnt DESC',
    signal,
  }));

  if (!isCurrent()) return null;

  const elapsed = result.networkTime ?? (performance.now() - startTime);
  facetTimings[b.id] = elapsed;

  const { data: resultData, totals } = result;
  const summaryRatio = getSummaryRatio(b, totals);

  const data = fillExpectedLabels(resultData, b);
  // Note: appendMissingFilteredValues uses ClickHouse queries - skip for now with Coralogix
  // data = await appendMissingFilteredValues(data, b, params.col, aggs, params, requestStatus);
  if (!isCurrent()) return null;

  return {
    data,
    totals,
    params,
    elapsed,
    summaryRatio,
  };
}

function shouldIgnoreBreakdownError(requestStatus, err) {
  return !requestStatus.isCurrent() || isAbortError(err);
}

export async function loadBreakdown(
  b,
  timeFilter,
  hostFilter,
  requestContext = null,
  samplingOverride = null,
) {
  const requestStatus = createRequestStatus(requestContext);
  const card = document.getElementById(b.id);

  if (!prepareBreakdownCard(card, b)) return;

  try {
    const result = await fetchBreakdownData(
      b,
      timeFilter,
      hostFilter,
      requestStatus,
      samplingOverride,
    );
    if (!result) return;

    renderBreakdownTable(
      b.id,
      result.data,
      result.totals,
      result.params.col,
      b.linkPrefix,
      b.linkSuffix,
      b.linkFn,
      result.elapsed,
      b.dimPrefixes,
      b.dimFormatFn,
      result.summaryRatio,
      b.summaryLabel,
      b.summaryColor,
      b.modeToggle,
      !!b.getExpectedLabels,
      result.params.hasActiveFilter ? null : b.filterCol,
      result.params.hasActiveFilter ? null : b.filterValueFn,
      result.params.hasActiveFilter ? null : b.filterOp,
    );
  } catch (err) {
    if (shouldIgnoreBreakdownError(requestStatus, err)) return;
    const details = getQueryErrorDetails(err);
    // eslint-disable-next-line no-console
    console.error(`Breakdown error (${b.id}):`, err);
    renderBreakdownError(b.id, details);
  } finally {
    if (requestStatus.isCurrent()) {
      card.classList.remove('updating');
    }
  }
}

export async function loadAllBreakdowns(
  requestContext = getRequestContext('facets'),
  samplingOverride = null,
) {
  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const breakdowns = getBreakdowns();

  // Load all facets individually via the Coralogix adapter
  await Promise.all(
    breakdowns.map(
      (b) => loadBreakdown(b, timeFilter, hostFilter, requestContext, samplingOverride),
    ),
  );
}

export async function loadAllBreakdownsRefined(requestContext = getRequestContext('facets')) {
  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const breakdowns = getBreakdowns();
  const refinedSampling = { sampleClause: '', multiplier: 1 };
  await Promise.all(
    breakdowns
      .filter((b) => !canUseFacetTable(b))
      .map((b) => loadBreakdown(b, timeFilter, hostFilter, requestContext, refinedSampling)),
  );
}

// Mark the slowest facet in the toolbar timer tooltip
export function markSlowestFacet() {
  const queryTimerEl = document.getElementById('queryTimer');
  if (!queryTimerEl) return;

  // Find the slowest facet
  let slowestId = null;
  let slowestTime = 0;
  for (const [id, time] of Object.entries(facetTimings)) {
    if (time > slowestTime) {
      slowestTime = time;
      slowestId = id;
    }
  }

  // Update the timer's title attribute with slowest facet info
  if (slowestId) {
    const card = document.getElementById(slowestId);
    // Use stored title to avoid picking up summary tags inside h3
    const title = card?.dataset.title || slowestId;
    queryTimerEl.title = `Slowest: ${title} (${Math.round(slowestTime)}ms)`;
  } else {
    queryTimerEl.title = '';
  }
}

// Increase topN and reload breakdowns
export function increaseTopN(topNSelectEl, saveStateToURL, loadAllBreakdownsFn) {
  const next = getNextTopN();
  if (next) {
    state.topN = next;
    const el = topNSelectEl;
    el.value = next;
    saveStateToURL();
    loadAllBreakdownsFn();
  }
}

// --- Preview breakdowns during time range selection ---

const HOUR_MS = 60 * 60 * 1000;

function formatPreviewDateTime(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function getPreviewTimeFilter(start, end) {
  const startIso = formatPreviewDateTime(start);
  const endIso = formatPreviewDateTime(end);
  return `toStartOfMinute(timestamp) BETWEEN toStartOfMinute(toDateTime('${startIso}')) AND toStartOfMinute(toDateTime('${endIso}'))`;
}

function getPreviewSamplingConfig(durationMs) {
  if (durationMs <= HOUR_MS) {
    return { sampleClause: '', multiplier: 1 };
  }
  const ratio = HOUR_MS / durationMs;
  const sampleRate = Math.max(Math.round(ratio * 10000) / 10000, 0.0001);
  const multiplier = Math.round(1 / sampleRate);
  return { sampleClause: `SAMPLE ${sampleRate}`, multiplier };
}

function buildPreviewQueryParams(b, col, timeFilter, hostFilter, sampling) {
  const originalCol = typeof b.col === 'function' ? b.col(state.topN) : b.col;
  const hasActiveFilter = b.filterOp === 'LIKE' && b.filterCol
    && state.filters.some((f) => f.col === originalCol);
  const actualCol = hasActiveFilter ? b.filterCol : col;

  const mode = b.modeToggle ? state[b.modeToggle] : 'count';
  const isBytes = mode === 'bytes';
  const { sampleClause, multiplier } = sampling;
  const mult = multiplier > 1 ? ` * ${multiplier}` : '';

  return {
    col: actualCol,
    originalCol,
    hasActiveFilter,
    isBytes,
    sampleClause,
    mult,
    extra: b.extraFilter || '',
    facetFilters: getFacetFiltersExcluding(originalCol),
    timeFilter,
    hostFilter,
  };
}

async function buildPreviewBreakdownSql(b, timeFilter, hostFilter, facetTimes, sampling) {
  const baseCol = typeof b.col === 'function' ? b.col(state.topN) : b.col;

  if (canUseFacetTable(b)) {
    const { startTime, endTime } = facetTimes;
    const dimFilter = b.extraFilter ? "AND dim != ''" : '';
    const hasSummary = !!b.summaryDimCondition;
    const sql = await loadSql('breakdown-facet', {
      database: DATABASE,
      facetName: b.facetName,
      startTime,
      endTime,
      dimFilter,
      innerSummaryCol: hasSummary
        ? `,\n    if(${b.summaryDimCondition}, cnt, 0) as summary_cnt`
        : '',
      summaryCol: hasSummary
        ? ',\n  sum(summary_cnt) as summary_cnt'
        : '',
      orderBy: b.orderBy || 'cnt DESC',
      topN: String(state.topN),
    });

    const params = {
      col: baseCol,
      originalCol: baseCol,
      hasActiveFilter: false,
      isBytes: false,
      sampleClause: '',
      mult: '',
      extra: '',
      facetFilters: '',
      timeFilter,
      hostFilter,
    };
    return { sql, params, aggs: buildAggregations(false, '') };
  }

  const params = buildPreviewQueryParams(b, baseCol, timeFilter, hostFilter, sampling);
  const aggs = buildAggregations(params.isBytes, params.mult);

  if (b.rawCol && typeof b.col === 'function') {
    const bucketExpr = b.col(state.topN, 'val');
    const innerSummary = b.summaryCountIf
      ? `,\n    countIf(${b.summaryCountIf})${params.mult} as summary_cnt`
      : '';
    const outerSummary = b.summaryCountIf
      ? ',\n  sum(summary_cnt) as summary_cnt'
      : '';

    const sql = await loadSql('breakdown-bucketed', {
      bucketExpr,
      rawCol: b.rawCol,
      ...aggs,
      innerSummaryCol: innerSummary,
      outerSummaryCol: outerSummary,
      database: DATABASE,
      table: getTable(),
      sampleClause: params.sampleClause,
      timeFilter,
      hostFilter,
      facetFilters: params.facetFilters,
      extra: params.extra,
      additionalWhereClause: state.additionalWhereClause,
      topN: String(state.topN),
    });

    return { sql, params, aggs };
  }

  const summaryColWithMult = b.summaryCountIf
    ? `,\n      countIf(${b.summaryCountIf})${params.mult} as summary_cnt`
    : '';

  const sql = await loadSql('breakdown', {
    col: params.col,
    ...aggs,
    summaryCol: summaryColWithMult,
    database: DATABASE,
    table: getTable(),
    sampleClause: params.sampleClause,
    timeFilter,
    hostFilter,
    facetFilters: params.facetFilters,
    extra: params.extra,
    additionalWhereClause: state.additionalWhereClause,
    orderBy: b.orderBy || 'cnt DESC',
    topN: String(state.topN),
  });

  return { sql, params, aggs };
}

// Track whether preview is active for CSS indicator
let previewActive = false;

export function isPreviewActive() {
  return previewActive;
}

async function loadPreviewBreakdown(
  b,
  timeFilter,
  hostFilter,
  facetTimes,
  sampling,
  requestStatus,
) {
  const { isCurrent, signal } = requestStatus;
  const card = document.getElementById(b.id);

  if (state.hiddenFacets.includes(b.id)) return;

  card.classList.add('updating');

  try {
    const built = await buildPreviewBreakdownSql(b, timeFilter, hostFilter, facetTimes, sampling);
    const { sql, params, aggs } = built;
    const startTime = performance.now();
    const result = await queryLimiter(() => query(sql, { signal }));
    if (!isCurrent()) return;

    const elapsed = result.networkTime ?? (performance.now() - startTime);
    const summaryRatio = getSummaryRatio(b, result.totals);

    let data = fillExpectedLabels(result.data, b);
    data = await appendMissingFilteredValues(data, b, params.col, aggs, params, requestStatus);
    if (!isCurrent()) return;

    renderBreakdownTable(
      b.id,
      data,
      result.totals,
      params.col,
      b.linkPrefix,
      b.linkSuffix,
      b.linkFn,
      elapsed,
      b.dimPrefixes,
      b.dimFormatFn,
      summaryRatio,
      b.summaryLabel,
      b.summaryColor,
      b.modeToggle,
      !!b.getExpectedLabels,
      params.hasActiveFilter ? null : b.filterCol,
      params.hasActiveFilter ? null : b.filterValueFn,
      params.hasActiveFilter ? null : b.filterOp,
    );

    card.classList.add('preview');
  } catch (err) {
    if (!isCurrent() || isAbortError(err)) return;
    const details = getQueryErrorDetails(err);
    // eslint-disable-next-line no-console
    console.error(`Preview breakdown error (${b.id}):`, err);
    renderBreakdownError(b.id, details);
  } finally {
    if (isCurrent()) {
      card.classList.remove('updating');
    }
  }
}

export async function loadPreviewBreakdowns(selectionStart, selectionEnd) {
  const requestContext = startRequestContext('preview');
  const requestStatus = {
    isCurrent: () => isRequestCurrent(requestContext.requestId, 'preview'),
    signal: requestContext.signal,
  };

  const durationMs = selectionEnd - selectionStart;
  const start = new Date(Math.floor(selectionStart.getTime() / 60000) * 60000);
  const end = new Date(Math.ceil(selectionEnd.getTime() / 60000) * 60000);

  const timeFilter = getPreviewTimeFilter(start, end);
  const hostFilter = getHostFilter();
  const facetTimes = {
    startTime: formatPreviewDateTime(start),
    endTime: formatPreviewDateTime(end),
  };
  const sampling = getPreviewSamplingConfig(durationMs);

  previewActive = true;
  const breakdowns = getBreakdowns();
  await Promise.all(
    breakdowns.map(
      (b) => loadPreviewBreakdown(b, timeFilter, hostFilter, facetTimes, sampling, requestStatus),
    ),
  );
}

export async function revertPreviewBreakdowns() {
  if (!previewActive) return;
  previewActive = false;
  // Cancel any in-flight preview queries
  startRequestContext('preview');
  // Remove preview indicator from all cards
  document.querySelectorAll('.breakdown-card.preview').forEach((card) => {
    card.classList.remove('preview');
  });
  // Reload original breakdowns using current global time range
  const requestContext = startRequestContext('facets');
  await loadAllBreakdowns(requestContext);
}

// Re-export for convenience
export { allBreakdowns } from './definitions.js';
