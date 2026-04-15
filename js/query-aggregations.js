/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { state } from './state.js';

/**
 * Build main breakdown aggregation SQL fragments (cnt, ok, 4xx, 5xx).
 * @param {boolean} isBytes
 * @param {string} mult - Sampling multiplier suffix, e.g. ' * 5' or ''
 * @returns {{ aggTotal: string, aggOk: string, agg4xx: string, agg5xx: string }}
 */
export function buildStatusAggregations(isBytes, mult) {
  if (state.aggregations) {
    return {
      aggTotal: state.aggregations.aggTotal + mult,
      aggOk: state.aggregations.aggOk + mult,
      agg4xx: state.aggregations.agg4xx + mult,
      agg5xx: state.aggregations.agg5xx + mult,
    };
  }

  const wc = state.weightColumn ? `\`${state.weightColumn}\`` : null;
  if (wc) {
    return {
      aggTotal: isBytes
        ? `sum(\`response.headers.content_length\` * ${wc})${mult}`
        : `sum(${wc})${mult}`,
      aggOk: isBytes
        ? `sumIf(\`response.headers.content_length\` * ${wc}, \`response.status\` < 400)${mult}`
        : `sumIf(${wc}, \`response.status\` < 400)${mult}`,
      agg4xx: isBytes
        ? `sumIf(\`response.headers.content_length\` * ${wc}, \`response.status\` >= 400 AND \`response.status\` < 500)${mult}`
        : `sumIf(${wc}, \`response.status\` >= 400 AND \`response.status\` < 500)${mult}`,
      agg5xx: isBytes
        ? `sumIf(\`response.headers.content_length\` * ${wc}, \`response.status\` >= 500)${mult}`
        : `sumIf(${wc}, \`response.status\` >= 500)${mult}`,
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

function summaryCountInner(summaryCountIf, mult) {
  if (state.weightColumn) {
    return `sumIf(\`${state.weightColumn}\`, ${summaryCountIf})${mult}`;
  }
  return `countIf(${summaryCountIf})${mult}`;
}

/**
 * SQL fragment for breakdown.sql inner summary column (indented for nested SELECT).
 */
export function buildSummaryCountBreakdownFragment(summaryCountIf, mult) {
  if (!summaryCountIf) {
    return '';
  }
  return `,\n      ${summaryCountInner(summaryCountIf, mult)} as summary_cnt`;
}

/**
 * SQL fragment for breakdown-bucketed inner query.
 */
export function buildSummaryCountBucketInnerFragment(summaryCountIf, mult) {
  if (!summaryCountIf) {
    return '';
  }
  return `,\n    ${summaryCountInner(summaryCountIf, mult)} as summary_cnt`;
}

/**
 * Inner SELECT column list for investigate-facet / investigate-selection (per minute, dim).
 */
/**
 * Aggregate used for facet search ORDER BY cnt (weighted vs row counts).
 */
export function getDimCountAgg() {
  if (state.weightColumn) {
    return `sum(\`${state.weightColumn}\`)`;
  }
  return 'count()';
}

export function getInvestigateMinuteAggregateLines() {
  if (state.weightColumn) {
    const w = `\`${state.weightColumn}\``;
    return {
      innerCnt: `sum(${w}) as cnt`,
      innerOk: `sumIf(${w}, \`response.status\` < 400) as cnt_ok`,
      inner4xx: `sumIf(${w}, \`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx`,
      inner5xx: `sumIf(${w}, \`response.status\` >= 500) as cnt_5xx`,
    };
  }
  return {
    innerCnt: 'count() as cnt',
    innerOk: 'countIf(`response.status` < 400) as cnt_ok',
    inner4xx: 'countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx',
    inner5xx: 'countIf(`response.status` >= 500) as cnt_5xx',
  };
}
