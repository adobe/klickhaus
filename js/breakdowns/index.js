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
  getTimeFilter,
  getHostFilter,
  getPeriodMs,
  getSampledTable,
  getSelectedRange,
  normalizeSampleRate,
} from '../time.js';
import { allBreakdowns } from './definitions.js';
import { renderBreakdownTable, renderBreakdownError, getNextTopN } from './render.js';
import { compileFilters } from '../filter-sql.js';
import { getFiltersForColumn } from '../filters.js';
import { loadSql } from '../sql-loader.js';

// Track elapsed time per facet id for slowest detection
export const facetTimings = {};
const facetSampleRates = {};

// Sampling thresholds: use sampling for high-cardinality facets when time range > 1 hour
const ONE_HOUR_MS = 60 * 60 * 1000;
const TWO_WEEKS_MS = 14 * 24 * ONE_HOUR_MS;
const TWENTY_WEEKS_MS = 20 * 7 * 24 * ONE_HOUR_MS;

function getRetentionSampleLimit() {
  const { start } = getSelectedRange();
  const ageMs = Math.max(0, Date.now() - start.getTime());
  if (ageMs >= TWENTY_WEEKS_MS) return 0.01;
  if (ageMs >= TWO_WEEKS_MS) return 0.1;
  return 1;
}

function getSamplingPlan(highCardinality) {
  const maxRate = getRetentionSampleLimit();
  if (!highCardinality) return [maxRate];

  const periodMs = getPeriodMs();
  if (periodMs <= ONE_HOUR_MS) return [maxRate];
  if (maxRate <= 0.01) return [0.01];
  if (maxRate <= 0.1) return [0.01, 0.1];
  return [0.01, 0.1, 1];
}

function getSamplingConfig(sampleRate) {
  const rate = normalizeSampleRate(sampleRate);
  const multiplier = rate < 1 ? Math.round(1 / rate) : 1;
  return {
    sampleRate: rate,
    multiplier,
    table: getSampledTable(rate),
    sampleClause: '',
  };
}

function updateGlobalSampleRate(fallbackRate = 1) {
  const rates = Object.values(facetSampleRates);
  const nextRate = rates.length ? Math.min(...rates) : fallbackRate;
  state.sampleRate = nextRate;
  document.body.dataset.sampleRate = String(nextRate);
}

function setFacetSampleRate(facetId, sampleRate) {
  if (sampleRate === null || sampleRate === undefined) {
    delete facetSampleRates[facetId];
  } else {
    facetSampleRates[facetId] = sampleRate;
  }
  updateGlobalSampleRate(getRetentionSampleLimit());
}

/**
 * Get current sampling info for UI display (chart blur/line width)
 * @returns {{ isActive: boolean, rate: string, description: string }} - Sampling status and display info
 */
export function getCurrentSamplingInfo() {
  const periodMs = getPeriodMs();

  // No sampling for time ranges <= 1 hour
  if (!periodMs || periodMs <= ONE_HOUR_MS) {
    return { isActive: false, rate: '', description: '' };
  }

  // 1% sampling for 7d
  if (periodMs >= 7 * 24 * ONE_HOUR_MS) {
    return { isActive: true, rate: '1%', description: '1% sample for faster queries' };
  }

  // 10% sampling for 12h, 24h
  return { isActive: true, rate: '10%', description: '10% sample for faster queries' };
}

export function resetFacetTimings() {
  Object.keys(facetTimings).forEach((key) => {
    delete facetTimings[key];
  });
  Object.keys(facetSampleRates).forEach((key) => {
    delete facetSampleRates[key];
  });
  updateGlobalSampleRate(getRetentionSampleLimit());
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
    table: queryParams.table,
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
function buildBreakdownQueryParams(b, col, timeFilter, hostFilter, sampleRateOverride) {
  const originalCol = typeof b.col === 'function' ? b.col(state.topN) : b.col;
  const hasActiveFilter = b.filterOp === 'LIKE' && b.filterCol
    && state.filters.some((f) => f.col === originalCol);
  const actualCol = hasActiveFilter ? b.filterCol : col;

  const mode = b.modeToggle ? state[b.modeToggle] : 'count';
  const isBytes = mode === 'bytes';
  const {
    sampleRate, sampleClause, multiplier, table,
  } = getSamplingConfig(sampleRateOverride);
  const mult = multiplier > 1 ? ` * ${multiplier}` : '';

  return {
    col: actualCol,
    originalCol,
    hasActiveFilter,
    isBytes,
    sampleRate,
    sampleClause,
    mult,
    table,
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
    setFacetSampleRate(b.id, null);
    return false;
  }

  card.removeAttribute('data-action');
  card.removeAttribute('data-facet');
  card.classList.remove('facet-hidden');
  card.classList.add('updating');
  return true;
}

async function runBreakdownStage(b, params, timeFilter, hostFilter, requestStatus, signal) {
  const { isCurrent } = requestStatus;
  const aggs = buildAggregations(params.isBytes, params.mult);

  const summaryColWithMult = b.summaryCountIf
    ? `,\n      countIf(${b.summaryCountIf})${params.mult} as summary_cnt`
    : '';

  const sql = await loadSql('breakdown', {
    col: params.col,
    ...aggs,
    summaryCol: summaryColWithMult,
    database: DATABASE,
    table: params.table,
    sampleClause: params.sampleClause,
    timeFilter,
    hostFilter,
    facetFilters: params.facetFilters,
    extra: params.extra,
    additionalWhereClause: state.additionalWhereClause,
    orderBy: b.orderBy || 'cnt DESC',
    topN: String(state.topN),
  });

  const startTime = performance.now();
  const result = await query(sql, { signal });
  if (!isCurrent()) return null;
  const elapsed = result.networkTime ?? (performance.now() - startTime);

  const summaryRatio = (b.summaryCountIf && result.totals && result.totals.cnt > 0)
    ? parseInt(result.totals.summary_cnt, 10) / parseInt(result.totals.cnt, 10)
    : null;

  let data = fillExpectedLabels(result.data, b);
  data = await appendMissingFilteredValues(data, b, params.col, aggs, params, requestStatus);
  if (!isCurrent()) return null;

  return {
    data,
    totals: result.totals,
    elapsed,
    summaryRatio,
  };
}

async function runSamplingStages({
  breakdown,
  card,
  baseCol,
  samplingPlan,
  timeFilter,
  hostFilter,
  requestStatus,
  signal,
}) {
  const { isCurrent } = requestStatus;
  const cardEl = card;
  let hasRendered = false;

  for (const sampleRate of samplingPlan) {
    if (!isCurrent()) return hasRendered;
    const params = buildBreakdownQueryParams(
      breakdown,
      baseCol,
      timeFilter,
      hostFilter,
      sampleRate,
    );
    cardEl.dataset.sampleRate = String(params.sampleRate);
    cardEl.dataset.sampleTable = params.table;

    try {
      // Progressive refinement requires sequential queries.
      // eslint-disable-next-line no-await-in-loop
      const stage = await runBreakdownStage(
        breakdown,
        params,
        timeFilter,
        hostFilter,
        requestStatus,
        signal,
      );
      if (!stage) return hasRendered;

      facetTimings[breakdown.id] = stage.elapsed;
      renderBreakdownTable(
        breakdown.id,
        stage.data,
        stage.totals,
        params.col,
        breakdown.linkPrefix,
        breakdown.linkSuffix,
        breakdown.linkFn,
        stage.elapsed,
        breakdown.dimPrefixes,
        breakdown.dimFormatFn,
        stage.summaryRatio,
        breakdown.summaryLabel,
        breakdown.summaryColor,
        breakdown.modeToggle,
        !!breakdown.getExpectedLabels,
        params.hasActiveFilter ? null : breakdown.filterCol,
        params.hasActiveFilter ? null : breakdown.filterValueFn,
        params.hasActiveFilter ? null : breakdown.filterOp,
      );

      hasRendered = true;
      setFacetSampleRate(breakdown.id, params.sampleRate);
    } catch (err) {
      if (!isCurrent() || isAbortError(err)) return hasRendered;
      const details = getQueryErrorDetails(err);
      // eslint-disable-next-line no-console
      console.error(`Breakdown error (${breakdown.id}):`, err);
      if (!hasRendered) {
        renderBreakdownError(breakdown.id, details);
        setFacetSampleRate(breakdown.id, params.sampleRate);
      }
      return hasRendered;
    }
  }

  return hasRendered;
}

export async function loadBreakdown(b, timeFilter, hostFilter, requestContext = null) {
  const requestStatus = createRequestStatus(requestContext);
  const card = document.getElementById(b.id);

  if (!prepareBreakdownCard(card, b)) return;

  const baseCol = typeof b.col === 'function' ? b.col(state.topN) : b.col;
  const samplingPlan = getSamplingPlan(b.highCardinality);

  try {
    await runSamplingStages({
      breakdown: b,
      card,
      baseCol,
      samplingPlan,
      timeFilter,
      hostFilter,
      requestStatus,
      signal: requestStatus.signal,
    });
  } finally {
    if (requestStatus.isCurrent()) {
      card.classList.remove('updating');
    }
  }
}

export async function loadAllBreakdowns(requestContext = getRequestContext('facets')) {
  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  updateGlobalSampleRate(getRetentionSampleLimit());
  await Promise.all(
    allBreakdowns.map((b) => loadBreakdown(b, timeFilter, hostFilter, requestContext)),
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
