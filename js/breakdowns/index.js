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
  getTimeFilter, getHostFilter, getTable, getFacetTimeFilter,
  queryTimestamp, customTimeRange,
} from '../time.js';
import { waitUntilFacetNearViewport } from '../timer.js';
import { allBreakdowns as defaultBreakdowns } from './definitions.js';
import { renderBreakdownTable, renderBreakdownError, getNextTopN } from './render.js';
import { compileFilters } from '../filter-sql.js';
import { getFiltersForColumn } from '../filters.js';
import { loadSql } from '../sql-loader.js';
import { createLimiter } from '../concurrency-limiter.js';
import {
  buildStatusAggregations,
  buildSummaryCountBreakdownFragment,
  buildSummaryCountBucketInnerFragment,
} from '../query-aggregations.js';

// Intentionally limits only breakdown queries: breakdowns fan out 20+ parallel
// queries (one per facet), the only code path with bulk parallelism. Chart, logs,
// and autocomplete each fire 1-2 queries and don't need limiting.
const queryLimiter = createLimiter(4);

/** Per-facet signature of last successful load (skips redundant fetches when scrolling). */
const facetLoadedForSignature = new Map();

/** Clears per-facet load signatures (e.g. test isolation). */
export function clearFacetLoadSignatureCache() {
  facetLoadedForSignature.clear();
}

function computeFacetLoadSignature(timeFilter, hostFilter) {
  const ctr = customTimeRange();
  const qts = queryTimestamp();
  return JSON.stringify({
    timeFilter,
    hostFilter,
    filters: state.filters,
    topN: state.topN,
    contentTypeMode: state.contentTypeMode,
    additionalWhereClause: state.additionalWhereClause || '',
    tableName: state.tableName || '',
    weightColumn: state.weightColumn || '',
    aggregations: state.aggregations || null,
    qts: qts ? qts.toISOString() : '',
    ctr: ctr ? `${ctr.start.toISOString()}-${ctr.end.toISOString()}` : '',
  });
}

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
  if (!b.facetName) {
    return false;
  }
  if (b.rawCol) {
    return false; // bucketed facets need raw table
  }
  if (b.highCardinality) {
    return false; // high-cardinality queries raw table directly
  }
  if (state.tableName !== 'delivery') {
    return false; // facet table only covers delivery
  }
  if (state.hostFilter) {
    return false;
  }
  if (state.filters && state.filters.length > 0) {
    return false;
  }
  if (state.additionalWhereClause) {
    return false;
  }
  const mode = b.modeToggle ? state[b.modeToggle] : 'count';
  if (mode === 'bytes') {
    return false;
  }
  // ASN uses dictGet which produces different dim values than the facet table
  if (b.id === 'breakdown-asn') {
    return false;
  }
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
 * Fill in missing buckets for continuous range facets
 */
function fillExpectedLabels(data, b) {
  if (!b.getExpectedLabels) {
    return data;
  }

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
  const { originalCol } = queryParams;
  const filtersForCol = getFiltersForColumn(originalCol);
  if (filtersForCol.length === 0 || b.getExpectedLabels) {
    return data;
  }

  const existingDims = new Set(data.map((row) => row.dim));
  const missingFilterValues = filtersForCol
    .map((f) => f.value)
    .filter((v) => v !== '' && !existingDims.has(v));

  if (missingFilterValues.length === 0) {
    return data;
  }

  const searchCol = b.filterCol || col;
  const valuesList = missingFilterValues
    .map((v) => `'${v.replace(/'/g, "''")}'`)
    .join(', ');

  const missingValuesSql = await loadSql('breakdown-missing', {
    col,
    aggTotal: aggs.aggTotal,
    aggOk: aggs.aggOk,
    agg4xx: aggs.agg4xx,
    agg5xx: aggs.agg5xx,
    database: DATABASE,
    table: getTable(),
    timeFilter: queryParams.timeFilter,
    hostFilter: queryParams.hostFilter,
    extra: queryParams.extra,
    additionalWhereClause: state.additionalWhereClause,
    searchCol,
    valuesList,
  });

  try {
    if (!shouldApply()) {
      return data;
    }
    const missingResult = await query(missingValuesSql, { signal });
    if (!shouldApply()) {
      return data;
    }
    if (missingResult.data && missingResult.data.length > 0) {
      const markedRows = missingResult.data.map((row) => ({
        ...row,
        isFilteredValue: true,
      }));
      return [...data, ...markedRows];
    }
  } catch (err) {
    if (!shouldApply()) {
      return data;
    }
    if (isAbortError(err)) {
      return data;
    }
    // Silently ignore errors fetching filtered values
  }
  return data;
}

/**
 * Build SQL query parameters for breakdown
 */
function buildBreakdownQueryParams(b, col, timeFilter, hostFilter) {
  const originalCol = typeof b.col === 'function' ? b.col(state.topN) : b.col;

  const mode = b.modeToggle ? state[b.modeToggle] : 'count';
  const isBytes = mode === 'bytes';

  return {
    col,
    originalCol,
    isBytes,
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
  if (!card) {
    return false;
  }

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
      extra: '',
      facetFilters: '',
      timeFilter,
      hostFilter,
    };
    return { sql, params, aggs: buildStatusAggregations(false, '') };
  }

  const params = buildBreakdownQueryParams(b, baseCol, timeFilter, hostFilter);
  const aggs = buildStatusAggregations(params.isBytes, '');

  // Two-level query for bucket facets with rawCol (hits raw-value projection)
  if (b.rawCol && typeof b.col === 'function') {
    const bucketExpr = b.col(state.topN, 'val');
    const innerSummary = buildSummaryCountBucketInnerFragment(b.summaryCountIf, '');
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
      timeFilter,
      hostFilter,
      facetFilters: params.facetFilters,
      extra: params.extra,
      additionalWhereClause: state.additionalWhereClause || '',
      topN: String(state.topN),
    });

    return { sql, params, aggs };
  }

  const summaryCol = buildSummaryCountBreakdownFragment(b.summaryCountIf, '');

  const sql = await loadSql('breakdown', {
    col: params.col,
    ...aggs,
    summaryCol,
    database: DATABASE,
    table: getTable(),
    timeFilter,
    hostFilter,
    facetFilters: params.facetFilters,
    extra: params.extra,
    additionalWhereClause: state.additionalWhereClause || '',
    orderBy: b.orderBy || 'cnt DESC',
    topN: String(state.topN),
  });

  return { sql, params, aggs };
}

function getSummaryRatio(b, totals) {
  if (!b.summaryCountIf || !totals || totals.cnt <= 0) {
    return null;
  }
  if (totals.summary_cnt === undefined) {
    return null;
  }
  return parseInt(totals.summary_cnt, 10) / parseInt(totals.cnt, 10);
}

async function fetchBreakdownData(b, timeFilter, hostFilter, requestStatus) {
  const { isCurrent, signal } = requestStatus;
  const built = await buildBreakdownSql(b, timeFilter, hostFilter);
  const { sql, params, aggs } = built;
  const startTime = performance.now();
  const result = await queryLimiter(() => query(sql, { signal }));
  if (!isCurrent()) {
    return null;
  }

  const elapsed = result.networkTime ?? (performance.now() - startTime);
  facetTimings[b.id] = elapsed;

  const summaryRatio = getSummaryRatio(b, result.totals);

  let data = fillExpectedLabels(result.data, b);
  data = await appendMissingFilteredValues(data, b, params.col, aggs, params, requestStatus);
  if (!isCurrent()) {
    return null;
  }

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

/* eslint-disable complexity -- viewport wait + cache + render branches */
export async function loadBreakdown(
  b,
  timeFilter,
  hostFilter,
  requestContext = null,
  options = {},
) {
  const { force = false, lazyWait = false } = options;
  const requestStatus = createRequestStatus(requestContext);

  let card = document.getElementById(b.id);
  if (lazyWait && !force && card && !state.hiddenFacets.includes(b.id)) {
    try {
      await waitUntilFacetNearViewport(b.id, requestStatus.signal);
    } catch (e) {
      if (isAbortError(e)) {
        return;
      }
      throw e;
    }
  }

  if (!requestStatus.isCurrent()) {
    return;
  }

  card = document.getElementById(b.id);

  const sig = computeFacetLoadSignature(timeFilter, hostFilter);
  if (!force && facetLoadedForSignature.get(b.id) === sig) {
    return;
  }

  if (!prepareBreakdownCard(card, b)) {
    return;
  }

  try {
    const result = await fetchBreakdownData(b, timeFilter, hostFilter, requestStatus);
    if (!result) {
      return;
    }

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
      b.filterCol,
      b.filterValueFn,
      b.filterOp,
    );
    if (requestStatus.isCurrent()) {
      facetLoadedForSignature.set(b.id, sig);
    }
  } catch (err) {
    if (shouldIgnoreBreakdownError(requestStatus, err)) {
      return;
    }
    const details = getQueryErrorDetails(err);
    // eslint-disable-next-line no-console
    console.error(`Breakdown error (${b.id}):`, err);
    renderBreakdownError(b.id, details);
  } finally {
    if (card && requestStatus.isCurrent()) {
      card.classList.remove('updating');
    }
  }
}
/* eslint-enable complexity */

export async function loadAllBreakdowns(requestContext = getRequestContext('facets')) {
  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const breakdowns = getBreakdowns();
  const lazyOpts = { lazyWait: true };
  await Promise.all(
    breakdowns.map((b) => loadBreakdown(b, timeFilter, hostFilter, requestContext, lazyOpts)),
  );
}

// Mark the slowest facet in the toolbar timer tooltip
export function markSlowestFacet() {
  const queryTimerEl = document.getElementById('queryTimer');
  if (!queryTimerEl) {
    return;
  }

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

function formatPreviewDateTime(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function getPreviewTimeFilter(start, end) {
  const startIso = formatPreviewDateTime(start);
  const endIso = formatPreviewDateTime(end);
  return `toStartOfMinute(timestamp) BETWEEN toStartOfMinute(toDateTime('${startIso}')) AND toStartOfMinute(toDateTime('${endIso}'))`;
}

function buildPreviewQueryParams(b, col, timeFilter, hostFilter) {
  const originalCol = typeof b.col === 'function' ? b.col(state.topN) : b.col;

  const mode = b.modeToggle ? state[b.modeToggle] : 'count';
  const isBytes = mode === 'bytes';

  return {
    col,
    originalCol,
    isBytes,
    extra: b.extraFilter || '',
    facetFilters: getFacetFiltersExcluding(originalCol),
    timeFilter,
    hostFilter,
  };
}

async function buildPreviewBreakdownSql(b, timeFilter, hostFilter, facetTimes) {
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
      extra: '',
      facetFilters: '',
      timeFilter,
      hostFilter,
    };
    return { sql, params, aggs: buildStatusAggregations(false, '') };
  }

  const params = buildPreviewQueryParams(b, baseCol, timeFilter, hostFilter);
  const aggs = buildStatusAggregations(params.isBytes, '');

  if (b.rawCol && typeof b.col === 'function') {
    const bucketExpr = b.col(state.topN, 'val');
    const innerSummary = buildSummaryCountBucketInnerFragment(b.summaryCountIf, '');
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
      timeFilter,
      hostFilter,
      facetFilters: params.facetFilters,
      extra: params.extra,
      additionalWhereClause: state.additionalWhereClause || '',
      topN: String(state.topN),
    });

    return { sql, params, aggs };
  }

  const summaryCol = buildSummaryCountBreakdownFragment(b.summaryCountIf, '');

  const sql = await loadSql('breakdown', {
    col: params.col,
    ...aggs,
    summaryCol,
    database: DATABASE,
    table: getTable(),
    timeFilter,
    hostFilter,
    facetFilters: params.facetFilters,
    extra: params.extra,
    additionalWhereClause: state.additionalWhereClause || '',
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

async function loadPreviewBreakdown(b, timeFilter, hostFilter, facetTimes, requestStatus) {
  const { isCurrent, signal } = requestStatus;
  const card = document.getElementById(b.id);

  if (state.hiddenFacets.includes(b.id)) {
    return;
  }

  card.classList.add('updating');

  try {
    const built = await buildPreviewBreakdownSql(b, timeFilter, hostFilter, facetTimes);
    const { sql, params, aggs } = built;
    const startTime = performance.now();
    const result = await queryLimiter(() => query(sql, { signal }));
    if (!isCurrent()) {
      return;
    }

    const elapsed = result.networkTime ?? (performance.now() - startTime);
    const summaryRatio = getSummaryRatio(b, result.totals);

    let data = fillExpectedLabels(result.data, b);
    data = await appendMissingFilteredValues(data, b, params.col, aggs, params, requestStatus);
    if (!isCurrent()) {
      return;
    }

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
      b.filterCol,
      b.filterValueFn,
      b.filterOp,
    );

    card.classList.add('preview');
  } catch (err) {
    if (!isCurrent() || isAbortError(err)) {
      return;
    }
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

  const start = new Date(Math.floor(selectionStart.getTime() / 60000) * 60000);
  const end = new Date(Math.ceil(selectionEnd.getTime() / 60000) * 60000);

  const timeFilter = getPreviewTimeFilter(start, end);
  const hostFilter = getHostFilter();
  const facetTimes = {
    startTime: formatPreviewDateTime(start),
    endTime: formatPreviewDateTime(end),
  };

  previewActive = true;
  const breakdowns = getBreakdowns();
  await Promise.all(
    breakdowns.map(
      (b) => loadPreviewBreakdown(b, timeFilter, hostFilter, facetTimes, requestStatus),
    ),
  );
}

export async function revertPreviewBreakdowns() {
  if (!previewActive) {
    return;
  }
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
