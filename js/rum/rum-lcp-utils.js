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

/**
 * Utility functions for the RUM LCP view.
 * Defines the full facet set and interpolation for CWV measurements.
 */

export {
  getRumDateRange,
  buildDataChunksFilters,
  renderKeyMetrics,
  populateRumTimeRangeSelect,
  showDashboardError,
  hideDashboardError,
} from './rum-traffic-utils.js';

/**
 * Minimum number of CWV measurements in a time bucket before interpolation kicks in.
 * Buckets with fewer total measurements (ok + ni + poor) are considered sparse
 * and will be interpolated from neighboring buckets.
 */
const MIN_SAMPLE_THRESHOLD = 5;

/**
 * Full facet breakdown definitions for the LCP view.
 * Maps DataChunks facet names to breakdown card IDs and display labels.
 */
export const LCP_BREAKDOWNS = [
  { id: 'breakdown-url', facetName: 'url', col: 'url' },
  { id: 'breakdown-userAgent', facetName: 'userAgent', col: 'userAgent' },
  { id: 'breakdown-checkpoint', facetName: 'checkpoint', col: 'checkpoint' },
  { id: 'breakdown-enterSource', facetName: 'enterSource', col: 'enterSource' },
  { id: 'breakdown-clickTarget', facetName: 'clickTarget', col: 'clickTarget' },
  { id: 'breakdown-mediaTarget', facetName: 'mediaTarget', col: 'mediaTarget' },
  { id: 'breakdown-viewblock', facetName: 'viewblock', col: 'viewblock' },
  { id: 'breakdown-navigate', facetName: 'navigate', col: 'navigate' },
  { id: 'breakdown-language', facetName: 'language', col: 'language' },
  { id: 'breakdown-accessibility', facetName: 'accessibility', col: 'accessibility' },
  { id: 'breakdown-consent', facetName: 'consent', col: 'consent' },
  { id: 'breakdown-loadresource', facetName: 'loadresource', col: 'loadresource' },
  {
    id: 'breakdown-acquisitionSource',
    facetName: 'acquisitionSource',
    col: 'acquisitionSource',
  },
  { id: 'breakdown-error', facetName: 'error', col: 'error' },
  { id: 'breakdown-four04', facetName: 'four04', col: 'four04' },
  { id: 'breakdown-redirect', facetName: 'redirect', col: 'redirect' },
];

/**
 * Find the nearest non-sparse neighbor in the given direction.
 * @param {Array} data - Chart data array
 * @param {number} fromIdx - Starting index
 * @param {number} direction - -1 for backward, 1 for forward
 * @param {number} threshold - Minimum sample threshold
 * @returns {number|null} Index of nearest non-sparse neighbor, or null
 */
function findNonSparseNeighbor(data, fromIdx, direction, threshold) {
  let j = fromIdx + direction;
  while (j >= 0 && j < data.length) {
    const t = data[j].cnt_ok + data[j].cnt_4xx + data[j].cnt_5xx;
    if (t >= threshold) {
      return j;
    }
    j += direction;
  }
  return null;
}

/**
 * Linearly interpolate a point between two non-sparse neighbors.
 * Preserves the timestamp (t) and interpolates value proportions.
 * @param {object} point - The sparse point to interpolate
 * @param {object} prevPoint - Previous non-sparse point
 * @param {object} nextPoint - Next non-sparse point
 * @param {number} alpha - Interpolation factor (0 = prev, 1 = next)
 * @returns {object} Interpolated point
 */
function interpolatePoint(point, prevPoint, nextPoint, alpha) {
  const prevTotal = prevPoint.cnt_ok + prevPoint.cnt_4xx + prevPoint.cnt_5xx;
  const nextTotal = nextPoint.cnt_ok + nextPoint.cnt_4xx + nextPoint.cnt_5xx;
  const interpolatedTotal = Math.round(prevTotal * (1 - alpha) + nextTotal * alpha);

  if (interpolatedTotal === 0) {
    return point;
  }

  const prevOkRatio = prevTotal > 0 ? prevPoint.cnt_ok / prevTotal : 0;
  const prevNiRatio = prevTotal > 0 ? prevPoint.cnt_4xx / prevTotal : 0;
  const nextOkRatio = nextTotal > 0 ? nextPoint.cnt_ok / nextTotal : 0;
  const nextNiRatio = nextTotal > 0 ? nextPoint.cnt_4xx / nextTotal : 0;

  const okRatio = prevOkRatio * (1 - alpha) + nextOkRatio * alpha;
  const niRatio = prevNiRatio * (1 - alpha) + nextNiRatio * alpha;

  const cntOk = Math.round(interpolatedTotal * okRatio);
  const cnt4xx = Math.round(interpolatedTotal * niRatio);
  const cnt5xx = Math.max(0, interpolatedTotal - cntOk - cnt4xx);

  return {
    t: point.t, cnt_ok: cntOk, cnt_4xx: cnt4xx, cnt_5xx: cnt5xx,
  };
}

/**
 * Extrapolate a sparse point from a single non-sparse neighbor.
 * Uses the neighbor's proportions with its total as the scale.
 * @param {object} point - The sparse point to fill
 * @param {object} neighbor - The non-sparse neighbor point
 * @returns {object} Extrapolated point
 */
function extrapolatePoint(point, neighbor) {
  const neighborTotal = neighbor.cnt_ok + neighbor.cnt_4xx + neighbor.cnt_5xx;
  if (neighborTotal === 0) {
    return point;
  }

  const okRatio = neighbor.cnt_ok / neighborTotal;
  const niRatio = neighbor.cnt_4xx / neighborTotal;

  const cntOk = Math.round(neighborTotal * okRatio);
  const cnt4xx = Math.round(neighborTotal * niRatio);
  const cnt5xx = Math.max(0, neighborTotal - cntOk - cnt4xx);

  return {
    t: point.t, cnt_ok: cntOk, cnt_4xx: cnt4xx, cnt_5xx: cnt5xx,
  };
}

/**
 * Interpolate CWV chart data to fill gaps for time slots with few measurements.
 * When a time bucket has fewer CWV measurements than the threshold, its values
 * are linearly interpolated from the nearest non-sparse neighbors.
 *
 * @param {Array<{t: string, cnt_ok: number, cnt_4xx: number, cnt_5xx: number}>} chartData
 * @param {number} [threshold] - Minimum sample count below which interpolation applies
 * @returns {Array<{t: string, cnt_ok: number, cnt_4xx: number, cnt_5xx: number}>}
 */
export function interpolateCwvGaps(chartData, threshold = MIN_SAMPLE_THRESHOLD) {
  if (chartData.length < 2) {
    return chartData;
  }

  const result = chartData.map((point) => ({ ...point }));

  for (let i = 0; i < result.length; i += 1) {
    const total = result[i].cnt_ok + result[i].cnt_4xx + result[i].cnt_5xx;
    if (total >= threshold) {
      // eslint-disable-next-line no-continue
      continue;
    }

    // Find nearest non-sparse neighbors
    const prev = findNonSparseNeighbor(result, i, -1, threshold);
    const next = findNonSparseNeighbor(result, i, 1, threshold);

    if (prev !== null && next !== null) {
      // Interpolate between both neighbors
      const alpha = (i - prev) / (next - prev);
      result[i] = interpolatePoint(result[i], result[prev], result[next], alpha);
    } else if (prev !== null) {
      // Extrapolate from previous neighbor only
      result[i] = extrapolatePoint(result[i], result[prev]);
    } else if (next !== null) {
      // Extrapolate from next neighbor only
      result[i] = extrapolatePoint(result[i], result[next]);
    }
  }

  return result;
}
