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
import { query } from '../api.js';
import {
  getTimeFilter, getHostFilter, getTable, getPeriodMs,
} from '../time.js';
import { allBreakdowns } from './definitions.js';
import { renderBreakdownTable, renderBreakdownError, getNextTopN } from './render.js';
import { compileFilters } from '../filter-sql.js';
import { getFiltersForColumn } from '../filters.js';

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

export async function loadBreakdown(b, timeFilter, hostFilter) {
  const card = document.getElementById(b.id);

  // Skip fetching data for hidden facets - show as minimal pill
  if (state.hiddenFacets.includes(b.id)) {
    // Get or set title before replacing innerHTML
    if (!card.dataset.title) {
      const h3 = card.querySelector('h3');
      card.dataset.title = h3 ? h3.textContent.trim() : b.id.replace('breakdown-', '');
    }
    // Replace with minimal HTML
    card.innerHTML = `<h3>${card.dataset.title}</h3><button class="facet-hide-btn" data-action="toggle-facet-hide" data-facet="${b.id}" title="Show facet"></button>`;
    card.classList.add('facet-hidden');
    card.classList.remove('updating');
    // Make whole card clickable to unhide
    card.dataset.action = 'toggle-facet-hide';
    card.dataset.facet = b.id;
    return;
  }

  // Clear delegated action markers for visible facets
  card.removeAttribute('data-action');
  card.removeAttribute('data-facet');

  card.classList.remove('facet-hidden');
  card.classList.add('updating');

  // Support dynamic col expressions that depend on topN
  let col = typeof b.col === 'function' ? b.col(state.topN) : b.col;

  // When there's an active LIKE filter for this breakdown, switch to raw column
  // to show decomposed individual values instead of grouped ones
  const hasActiveFilter = b.filterOp === 'LIKE' && b.filterCol
    && state.filters.some((f) => f.col === col);
  if (hasActiveFilter) {
    col = b.filterCol;
  }

  const extra = b.extraFilter || '';
  // Get filters excluding this facet's column to show all values for active facets
  // Use the original grouped col for filter exclusion check
  const originalCol = typeof b.col === 'function' ? b.col(state.topN) : b.col;
  const facetFilters = getFacetFiltersExcluding(originalCol);

  // Check for mode toggle (e.g., count vs bytes for content-types)
  const mode = b.modeToggle ? state[b.modeToggle] : 'count';
  const isBytes = mode === 'bytes';

  // Get sampling configuration for high-cardinality facets with large time ranges
  const { sampleClause, multiplier } = getSamplingConfig(b.highCardinality);
  const mult = multiplier > 1 ? ` * ${multiplier}` : '';

  // Aggregation functions depend on mode
  // Note: Using `< 400` instead of `>= 100 AND < 400` to match projection definitions
  // (HTTP status codes are always >= 100, so the >= 100 check is redundant)
  // When sampling, multiply counts to get estimated totals
  const aggTotal = isBytes ? `sum(\`response.headers.content_length\`)${mult}` : `count()${mult}`;
  const aggOk = isBytes
    ? `sumIf(\`response.headers.content_length\`, \`response.status\` < 400)${mult}`
    : `countIf(\`response.status\` < 400)${mult}`;
  const agg4xx = isBytes
    ? `sumIf(\`response.headers.content_length\`, \`response.status\` >= 400 AND \`response.status\` < 500)${mult}`
    : `countIf(\`response.status\` >= 400 AND \`response.status\` < 500)${mult}`;
  const agg5xx = isBytes
    ? `sumIf(\`response.headers.content_length\`, \`response.status\` >= 500)${mult}`
    : `countIf(\`response.status\` >= 500)${mult}`;

  // Summary column also needs multiplier when sampling
  const summaryColWithMult = b.summaryCountIf
    ? `,\n      countIf(${b.summaryCountIf})${mult} as summary_cnt`
    : '';

  // Custom orderBy or default to count descending
  const orderBy = b.orderBy || 'cnt DESC';
  const sql = `
    SELECT
      ${col} as dim,
      ${aggTotal} as cnt,
      ${aggOk} as cnt_ok,
      ${agg4xx} as cnt_4xx,
      ${agg5xx} as cnt_5xx${summaryColWithMult}
    FROM ${DATABASE}.${getTable()}
    ${sampleClause}
    WHERE ${timeFilter} ${hostFilter} ${facetFilters} ${extra}
    GROUP BY dim WITH TOTALS
    ORDER BY ${orderBy}
    LIMIT ${state.topN}
  `;

  const startTime = performance.now();
  try {
    const result = await query(sql);
    // Prefer actual network time from Resource Timing API, fallback to wall clock
    const elapsed = result.networkTime ?? (performance.now() - startTime);
    facetTimings[b.id] = elapsed; // Track timing for slowest detection
    // Calculate summary ratio from totals if summaryCountIf is defined
    const summaryRatio = (b.summaryCountIf && result.totals && result.totals.cnt > 0)
      ? parseInt(result.totals.summary_cnt, 10) / parseInt(result.totals.cnt, 10)
      : null;

    // Fill in missing buckets for continuous range facets (e.g., content-length, time-elapsed)
    let { data } = result;
    if (b.getExpectedLabels) {
      const expectedLabels = b.getExpectedLabels(state.topN);
      const existingByLabel = new Map(data.map((row) => [row.dim, row]));
      data = expectedLabels.map((label) => {
        if (existingByLabel.has(label)) {
          return existingByLabel.get(label);
        }
        // Create empty bucket row
        return {
          dim: label, cnt: 0, cnt_ok: 0, cnt_4xx: 0, cnt_5xx: 0,
        };
      });
    }

    // Fetch filtered values that aren't in topN results
    // This ensures filtered/excluded values are always visible in the facet
    const filtersForCol = getFiltersForColumn(originalCol);
    if (filtersForCol.length > 0 && !b.getExpectedLabels) {
      const existingDims = new Set(data.map((row) => row.dim));
      const missingFilterValues = filtersForCol
        .map((f) => f.value)
        .filter((v) => v !== '' && !existingDims.has(v));

      if (missingFilterValues.length > 0) {
        // Build query for missing values
        const searchCol = b.filterCol || col;
        const valuesList = missingFilterValues
          .map((v) => `'${v.replace(/'/g, "''")}'`)
          .join(', ');

        const missingValuesSql = `
          SELECT
            ${col} as dim,
            ${isBytes ? `sum(\`response.headers.content_length\`)${mult}` : `count()${mult}`} as cnt,
            ${aggOk} as cnt_ok,
            ${agg4xx} as cnt_4xx,
            ${agg5xx} as cnt_5xx
          FROM ${DATABASE}.${getTable()}
          ${sampleClause}
          WHERE ${timeFilter} ${hostFilter} ${extra}
            AND ${searchCol} IN (${valuesList})
          GROUP BY dim
        `;

        try {
          const missingResult = await query(missingValuesSql);
          if (missingResult.data && missingResult.data.length > 0) {
            // Mark these rows as filtered values and append them
            const markedRows = missingResult.data.map((row) => ({
              ...row,
              isFilteredValue: true,
            }));
            data = [...data, ...markedRows];
          }
        } catch (err) {
          // Silently ignore errors fetching filtered values
        }
      }
    }

    // When showing decomposed values, don't pass filter transformation -
    // clicking individual values should use exact match, not LIKE pattern
    renderBreakdownTable(
      b.id,
      data,
      result.totals,
      col,
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
      hasActiveFilter ? null : b.filterCol,
      hasActiveFilter ? null : b.filterValueFn,
      hasActiveFilter ? null : b.filterOp,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Breakdown error (${b.id}):`, err);
    renderBreakdownError(b.id, err.message);
  } finally {
    card.classList.remove('updating');
  }
}

export async function loadAllBreakdowns() {
  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  await Promise.all(allBreakdowns.map((b) => loadBreakdown(b, timeFilter, hostFilter)));
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
