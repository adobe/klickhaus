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
 * RUM data adapter — fetches data from bundles.aem.page REST API,
 * processes with @adobe/rum-distiller DataChunks, and transforms into
 * chart/breakdown format compatible with the pluggable data source interface.
 */

// @adobe/rum-distiller is loaded via import map in production HTML pages.
// In tests, it resolves from node_modules (installed as devDependency).
// eslint-disable-next-line import/no-extraneous-dependencies
import {
  DataChunks, utils, series, facets,
} from '@adobe/rum-distiller';
import { createLimiter } from '../concurrency-limiter.js';

const BUNDLES_API_BASE = 'https://bundles.aem.page';
const MAX_CONCURRENCY = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Determine time granularity based on the span of the date range.
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {'hourly'|'daily'|'monthly'}
 */
export function getGranularity(startDate, endDate) {
  const spanMs = endDate.getTime() - startDate.getTime();
  const spanDays = spanMs / DAY_MS;
  if (spanDays <= 7) {
    return 'hourly';
  }
  if (spanDays <= 31) {
    return 'daily';
  }
  return 'monthly';
}

/**
 * Pad a number with a leading zero if < 10.
 * @param {number} n
 * @returns {string}
 */
function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Build API URLs for the given time range and granularity.
 * @param {string} domain
 * @param {string} domainkey
 * @param {Date} startDate
 * @param {Date} endDate
 * @param {'hourly'|'daily'|'monthly'} granularity
 * @returns {string[]}
 */
export function buildApiUrls(domain, domainkey, startDate, endDate, granularity) {
  const urls = [];
  const base = `${BUNDLES_API_BASE}/bundles/${domain}`;
  const keyParam = `domainkey=${encodeURIComponent(domainkey)}`;

  if (granularity === 'hourly') {
    // Iterate hour by hour from startDate to endDate
    const current = new Date(startDate);
    current.setUTCMinutes(0, 0, 0);
    while (current <= endDate) {
      const y = current.getUTCFullYear();
      const m = pad(current.getUTCMonth() + 1);
      const d = pad(current.getUTCDate());
      const h = pad(current.getUTCHours());
      urls.push(`${base}/${y}/${m}/${d}/${h}?${keyParam}`);
      current.setUTCHours(current.getUTCHours() + 1);
    }
  } else if (granularity === 'daily') {
    // Iterate day by day
    const current = new Date(startDate);
    current.setUTCHours(0, 0, 0, 0);
    while (current <= endDate) {
      const y = current.getUTCFullYear();
      const m = pad(current.getUTCMonth() + 1);
      const d = pad(current.getUTCDate());
      urls.push(`${base}/${y}/${m}/${d}?${keyParam}`);
      current.setUTCDate(current.getUTCDate() + 1);
    }
  } else {
    // monthly — iterate month by month
    const current = new Date(startDate);
    current.setUTCDate(1);
    current.setUTCHours(0, 0, 0, 0);
    while (current <= endDate) {
      const y = current.getUTCFullYear();
      const m = pad(current.getUTCMonth() + 1);
      urls.push(`${base}/${y}/${m}?${keyParam}`);
      current.setUTCMonth(current.getUTCMonth() + 1);
    }
  }

  return urls;
}

/**
 * Compute the truncation function for grouping bundles by time bucket.
 * @param {'hourly'|'daily'|'monthly'} granularity
 * @returns {Function} groupBy function for DataChunks.group()
 */
export function getTimeBucketConfig(granularity) {
  if (granularity === 'hourly') {
    return (bundle) => {
      const d = new Date(bundle.timeSlot);
      d.setUTCMinutes(0, 0, 0);
      return d.toISOString();
    };
  }
  if (granularity === 'daily') {
    return (bundle) => {
      const d = new Date(bundle.timeSlot);
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString();
    };
  }
  // monthly
  return (bundle) => {
    const d = new Date(bundle.timeSlot);
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  };
}

/**
 * Fetch a single URL and return the rumBundles array.
 * Returns empty array on 404 (no data for that time chunk).
 * Throws on auth errors (403) and network failures.
 * @param {string} url
 * @param {AbortSignal} [signal]
 * @returns {Promise<Array>}
 */
export async function fetchChunk(url, signal) {
  const response = await fetch(url, { signal });
  if (response.status === 404) {
    return [];
  }
  if (response.status === 403) {
    const error = new Error(
      'Authentication failed: invalid domain or domainkey',
    );
    error.status = 403;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(
      `API request failed: ${response.status} ${response.statusText}`,
    );
    error.status = response.status;
    throw error;
  }
  const json = await response.json();
  return json.rumBundles || [];
}

/**
 * Fetch all date chunks concurrently with a concurrency limiter.
 * @param {string[]} urls
 * @param {AbortSignal} [signal]
 * @returns {Promise<Array>} merged bundles from all chunks
 */
export async function fetchAllChunks(urls, signal) {
  const limiter = createLimiter(MAX_CONCURRENCY);
  const results = await Promise.all(
    urls.map((url) => limiter(() => fetchChunk(url, signal))),
  );
  return results.flat();
}

/**
 * Check if a bundle is engaged (has click or >3 viewmedia/viewblock).
 * @param {object} bundle
 * @returns {boolean}
 */
function isEngaged(bundle) {
  const hasClick = bundle.events.some(
    (e) => e.checkpoint === 'click',
  );
  const viewEvents = bundle.events.filter(
    (e) => e.checkpoint === 'viewmedia' || e.checkpoint === 'viewblock',
  ).length;
  return hasClick || viewEvents > 3;
}

/**
 * Add traffic-specific series (good/meh/poor by engagement).
 * @param {DataChunks} dataChunks
 */
function addTrafficSeries(dataChunks) {
  // ok (green) = engaged new visitors (visit=true AND engaged)
  dataChunks.addSeries('ok', (bundle) => {
    if (!bundle.visit) {
      return 0;
    }
    return isEngaged(bundle) ? bundle.weight : 0;
  });
  // meh (yellow) = existing/returning visitors (visit=false)
  dataChunks.addSeries('meh', (bundle) => {
    if (bundle.visit) {
      return 0;
    }
    return bundle.weight;
  });
  // poor (red) = bouncing new visitors (visit=true AND NOT engaged)
  dataChunks.addSeries('poor', (bundle) => {
    if (!bundle.visit) {
      return 0;
    }
    return isEngaged(bundle) ? 0 : bundle.weight;
  });
}

/**
 * Add CWV-specific series (good/ni/poor by metric thresholds).
 * @param {DataChunks} dataChunks
 * @param {string} viewType - 'lcp', 'cls', or 'inp'
 */
function addCwvSeries(dataChunks, viewType) {
  const metricKey = `cwv${viewType.toUpperCase()}`;

  dataChunks.addSeries('ok', (bundle) => {
    const val = bundle[metricKey];
    if (val == null) {
      return 0;
    }
    return utils.scoreCWV(val, viewType) === 'good' ? bundle.weight : 0;
  });
  dataChunks.addSeries('meh', (bundle) => {
    const val = bundle[metricKey];
    if (val == null) {
      return 0;
    }
    return utils.scoreCWV(val, viewType) === 'ni' ? bundle.weight : 0;
  });
  dataChunks.addSeries('poor', (bundle) => {
    const val = bundle[metricKey];
    if (val == null) {
      return 0;
    }
    return utils.scoreCWV(val, viewType) === 'poor' ? bundle.weight : 0;
  });
}

/**
 * Add series definitions to DataChunks based on view type.
 * @param {DataChunks} dataChunks
 * @param {'traffic'|'lcp'|'cls'|'inp'} viewType
 */
export function addSeriesDefinitions(dataChunks, viewType) {
  // Always add core series for metrics
  dataChunks.addSeries('pageViews', series.pageViews);
  dataChunks.addSeries('visits', series.visits);
  dataChunks.addSeries('bounces', series.bounces);
  dataChunks.addSeries('lcp', series.lcp);
  dataChunks.addSeries('cls', series.cls);
  dataChunks.addSeries('inp', series.inp);
  dataChunks.addSeries('engagement', series.engagement);

  if (viewType === 'traffic') {
    addTrafficSeries(dataChunks);
  } else {
    addCwvSeries(dataChunks, viewType);
  }
}

/**
 * Create a checkpoint-based facet function that extracts values
 * from events matching the given checkpoint name.
 * @param {string} checkpoint - The checkpoint name to filter by
 * @param {string} field - The event field to extract ('source' or 'target')
 * @returns {Function} Facet function for DataChunks
 */
export function checkpointFacet(checkpoint, field = 'target') {
  return (bundle) => bundle.events
    .filter((e) => e.checkpoint === checkpoint)
    .map((e) => e[field])
    .filter(Boolean);
}

/**
 * Add facet definitions for breakdown analysis.
 * Includes core facets from rum-distiller plus custom checkpoint-based facets
 * for the full optel-explorer facet set.
 * @param {DataChunks} dataChunks
 */
export function addFacetDefinitions(dataChunks) {
  // Core facets from rum-distiller
  dataChunks.addFacet('userAgent', facets.userAgent);
  dataChunks.addFacet('url', facets.url);
  dataChunks.addFacet('checkpoint', facets.checkpoint);
  dataChunks.addFacet('vitals', facets.vitals);
  dataChunks.addFacet('lcpSource', facets.lcpSource);
  dataChunks.addFacet('lcpTarget', facets.lcpTarget);
  dataChunks.addFacet('enterSource', facets.enterSource);
  dataChunks.addFacet('mediaTarget', facets.mediaTarget);
  dataChunks.addFacet('acquisitionSource', facets.acquisitionSource);

  // Extended checkpoint-based facets for full facet set
  dataChunks.addFacet('clickSource', checkpointFacet('click', 'source'));
  dataChunks.addFacet('clickTarget', checkpointFacet('click', 'target'));
  dataChunks.addFacet('mediaSource', checkpointFacet('viewmedia', 'source'));
  dataChunks.addFacet('viewblock', checkpointFacet('viewblock', 'source'));
  dataChunks.addFacet('navigate', checkpointFacet('navigate', 'target'));
  dataChunks.addFacet('language', checkpointFacet('language', 'source'));
  dataChunks.addFacet('accessibility', checkpointFacet('accessibility', 'source'));
  dataChunks.addFacet('consent', checkpointFacet('consent', 'source'));
  dataChunks.addFacet('loadresource', checkpointFacet('loadresource', 'target'));
  dataChunks.addFacet('error', checkpointFacet('error', 'source'));
  dataChunks.addFacet('four04', checkpointFacet('404', 'source'));
  dataChunks.addFacet('redirect', checkpointFacet('redirect', 'target'));
}

/**
 * Transform DataChunks aggregates into chart data format.
 * @param {object} aggregates - from dataChunks.aggregates
 * @returns {Array<{t: string, cnt_ok: number, cnt_4xx: number, cnt_5xx: number}>}
 */
export function transformToChartData(aggregates) {
  return Object.entries(aggregates)
    .map(([timeBucket, seriesData]) => ({
      t: timeBucket,
      cnt_ok: Math.round(seriesData.ok?.sum || 0),
      cnt_4xx: Math.round(seriesData.meh?.sum || 0),
      cnt_5xx: Math.round(seriesData.poor?.sum || 0),
    }))
    .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
}

/**
 * Transform DataChunks facets into breakdown data format.
 * @param {object} facetData - from dataChunks.facets[facetName]
 * @returns {Array<{dim: string, cnt: number, cnt_ok: number, cnt_4xx: number, cnt_5xx: number}>}
 */
export function transformToBreakdownData(facetData) {
  if (!facetData || !Array.isArray(facetData)) {
    return [];
  }

  return facetData
    .filter((entry) => entry.weight > 0)
    .map((entry) => {
      const metrics = entry.getMetrics(['ok', 'meh', 'poor']);
      const cntOk = Math.round(metrics.ok?.sum || 0);
      const cnt4xx = Math.round(metrics.meh?.sum || 0);
      const cnt5xx = Math.round(metrics.poor?.sum || 0);
      return {
        dim: entry.value,
        cnt: cntOk + cnt4xx + cnt5xx,
        cnt_ok: cntOk,
        cnt_4xx: cnt4xx,
        cnt_5xx: cnt5xx,
      };
    })
    .filter((row) => row.cnt > 0);
}

/**
 * Build the empty result shape for error/empty cases.
 * @param {string|null} error
 * @returns {object}
 */
function emptyResult(error = null) {
  return {
    chartData: [], breakdowns: {}, totals: null, error,
  };
}

/**
 * Extract totals from DataChunks metrics.
 * @param {object} totalMetrics - from dataChunks.totals
 * @returns {object}
 */
function extractTotals(totalMetrics) {
  return {
    pageViews: Math.round(totalMetrics.pageViews?.sum || 0),
    visits: Math.round(totalMetrics.visits?.sum || 0),
    bounces: Math.round(totalMetrics.bounces?.sum || 0),
    lcpP75: totalMetrics.lcp?.percentile(75) || 0,
    clsP75: totalMetrics.cls?.percentile(75) || 0,
    inpP75: totalMetrics.inp?.percentile(75) || 0,
  };
}

/**
 * Extract breakdowns from DataChunks facets.
 * @param {object} dcFacets - from dataChunks.facets
 * @returns {object}
 */
function extractBreakdowns(dcFacets) {
  const breakdowns = {};
  for (const facetName of Object.keys(dcFacets)) {
    breakdowns[facetName] = transformToBreakdownData(dcFacets[facetName]);
  }
  return breakdowns;
}

/**
 * Process raw bundles into chart data, breakdowns, and totals.
 * @param {Array} rawBundles - bundles from API
 * @param {'traffic'|'lcp'|'cls'|'inp'} viewType
 * @param {object} filters - DataChunks filter object
 * @param {'hourly'|'daily'|'monthly'} granularity
 * @returns {object}
 */
function processRumBundles(rawBundles, viewType, filters, granularity) {
  const bundles = rawBundles.map((b) => utils.addCalculatedProps(b));

  const dataChunks = new DataChunks();
  addSeriesDefinitions(dataChunks, viewType);
  addFacetDefinitions(dataChunks);
  dataChunks.load([{ rumBundles: bundles }]);

  if (filters && Object.keys(filters).length > 0) {
    dataChunks.filter = filters;
  }

  dataChunks.group(getTimeBucketConfig(granularity));

  const chartData = transformToChartData(dataChunks.aggregates);
  const breakdowns = extractBreakdowns(dataChunks.facets);
  const totals = extractTotals(dataChunks.totals);

  return {
    chartData, breakdowns, totals, error: null,
  };
}

/**
 * Main adapter function: fetch RUM data and process into
 * chart/breakdown format.
 *
 * @param {object} options
 * @param {string} options.domain
 * @param {string} options.domainkey
 * @param {Date} options.startDate
 * @param {Date} options.endDate
 * @param {'traffic'|'lcp'|'cls'|'inp'} [options.viewType]
 * @param {object} [options.filters]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{chartData: Array, breakdowns: object,
 *   totals: object, error: string|null}>}
 */
export async function fetchRumData({
  domain,
  domainkey,
  startDate,
  endDate,
  viewType = 'traffic',
  filters = {},
  signal,
}) {
  try {
    const granularity = getGranularity(startDate, endDate);
    const urls = buildApiUrls(domain, domainkey, startDate, endDate, granularity);

    if (urls.length === 0) {
      return emptyResult();
    }

    const rawBundles = await fetchAllChunks(urls, signal);
    return processRumBundles(rawBundles, viewType, filters, granularity);
  } catch (err) {
    if (err.name === 'AbortError') {
      return emptyResult();
    }
    if (err.status === 403) {
      return emptyResult('auth');
    }
    return emptyResult(err.message || 'Network error');
  }
}
