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
import { getRequestContext, isRequestCurrent, mergeAbortSignals } from '../request-context.js';
import {
  getTimeFilter, getHostFilter, getTable, getPeriodMs,
} from '../time.js';
import { allBreakdowns as defaultBreakdowns } from './definitions.js';

export function getBreakdowns() {
  return state.breakdowns?.length ? state.breakdowns : defaultBreakdowns;
}
import { renderBreakdownTable, renderBreakdownError, getNextTopN } from './render.js';
import { compileFilters } from '../filter-sql.js';
import { getFiltersForColumn } from '../filters.js';
import { loadSql } from '../sql-loader.js';

// Track elapsed time per facet id for slowest detection
export const facetTimings = {};

// Sampling thresholds: use sampling for high-cardinality facets when time range > 1 hour
const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Get sampling configuration based on facet type and time range
 * @param {boolean} highCardinality - Whether this facet has high cardinality
 * @returns {{ sampleClause: string, multiplier: number }} - SQL SAMPLE clause and count multiplier
 */
function getSamplingConfig(highCardinality) {
  if (!highCardinality) {
    return { sampleClause: '', multiplier: 1 };
  }

  const periodMs = getPeriodMs();

  // No sampling for time ranges <= 1 hour
  if (periodMs <= ONE_HOUR_MS) {
    return { sampleClause: '', multiplier: 1 };
  }

  // Use 1% sampling for 7d (very large time ranges)
  // 7d = 604800000ms
  if (periodMs >= 7 * 24 * ONE_HOUR_MS) {
    return { sampleClause: 'SAMPLE 0.01', multiplier: 100 };
  }

  // Use 10% sampling for medium time ranges (12h, 24h)
  // This gives ~3x speedup while maintaining accurate top-K ranking
  return { sampleClause: 'SAMPLE 0.1', multiplier: 10 };
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
function buildBreakdownQueryParams(b, col, timeFilter, hostFilter) {
  const originalCol = typeof b.col === 'function' ? b.col(state.topN) : b.col;
  const hasActiveFilter = b.filterOp === 'LIKE' && b.filterCol
    && state.filters.some((f) => f.col === originalCol);
  const actualCol = hasActiveFilter ? b.filterCol : col;

  const mode = b.modeToggle ? state[b.modeToggle] : 'count';
  const isBytes = mode === 'bytes';
  const { sampleClause, multiplier } = getSamplingConfig(b.highCardinality);
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

async function buildBreakdownSql(b, timeFilter, hostFilter) {
  const baseCol = typeof b.col === 'function' ? b.col(state.topN) : b.col;
  const params = buildBreakdownQueryParams(b, baseCol, timeFilter, hostFilter);
  const aggs = buildAggregations(params.isBytes, params.mult);

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

function getSummaryRatio(b, totals) {
  if (!b.summaryCountIf || !totals || totals.cnt <= 0) return null;
  return parseInt(totals.summary_cnt, 10) / parseInt(totals.cnt, 10);
}

async function fetchBreakdownData(b, timeFilter, hostFilter, requestStatus) {
  const { isCurrent, signal } = requestStatus;
  const { sql, params, aggs } = await buildBreakdownSql(b, timeFilter, hostFilter);
  const startTime = performance.now();
  const result = await query(sql, { signal });
  if (!isCurrent()) return null;

  const elapsed = result.networkTime ?? (performance.now() - startTime);
  facetTimings[b.id] = elapsed;
  const summaryRatio = getSummaryRatio(b, result.totals);

  let data = fillExpectedLabels(result.data, b);
  data = await appendMissingFilteredValues(data, b, params.col, aggs, params, requestStatus);
  if (!isCurrent()) return null;

  return {
    data,
    totals: result.totals,
    params,
    elapsed,
    summaryRatio,
  };
}

function shouldIgnoreBreakdownError(requestStatus, err) {
  return !requestStatus.isCurrent() || isAbortError(err);
}

export async function loadBreakdown(b, timeFilter, hostFilter, requestContext = null) {
  const requestStatus = createRequestStatus(requestContext);
  const card = document.getElementById(b.id);

  if (!prepareBreakdownCard(card, b)) return;

  try {
    const result = await fetchBreakdownData(b, timeFilter, hostFilter, requestStatus);
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

export async function loadAllBreakdowns(requestContext = getRequestContext('facets')) {
  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const breakdowns = getBreakdowns();
  await Promise.all(
    breakdowns.map((b) => loadBreakdown(b, timeFilter, hostFilter, requestContext)),
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

// Re-export for convenience
export { allBreakdowns } from './definitions.js';
