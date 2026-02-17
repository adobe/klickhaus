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

/**
 * Data Prime query builder for time-series queries.
 * Translates ClickHouse time-series queries to Coralogix Data Prime syntax.
 *
 * Migrates from:
 * ```sql
 * SELECT
 *   toStartOfMinute(timestamp) as t,
 *   countIf(`response.status` < 400) as cnt_ok,
 *   countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
 *   countIf(`response.status` >= 500) as cnt_5xx
 * FROM cdn_requests_v2
 * WHERE timestamp >= X AND timestamp <= Y
 * GROUP BY t
 * ORDER BY t WITH FILL
 * ```
 *
 * To Data Prime:
 * ```
 * source logs
 * | filter $l.subsystemname in ['cloudflare', 'fastly']
 * | filter timestamp >= timestamp('...') && timestamp <= timestamp('...')
 * | create status_ok = $d.response.status < 400 ? 1 : 0
 * | create status_4xx = ($d.response.status >= 400 && $d.response.status < 500) ? 1 : 0
 * | create status_5xx = $d.response.status >= 500 ? 1 : 0
 * | groupby timestamp.bucket(1m) as t aggregate
 *     sum(status_ok) as cnt_ok,
 *     sum(status_4xx) as cnt_4xx,
 *     sum(status_5xx) as cnt_5xx
 * | sort t asc
 * ```
 *
 * @module queries/time-series.dataprime
 */

/**
 * Format a JavaScript Date to ISO 8601 timestamp for Data Prime.
 * @param {Date} date
 * @returns {string} ISO timestamp (e.g., "2025-02-16T19:00:00.000Z")
 */
function formatDataPrimeTimestamp(date) {
  return date.toISOString();
}

/**
 * Escape single quotes in string values for Data Prime.
 * @param {string} value
 * @returns {string}
 */
function escapeDataPrimeString(value) {
  return value.replace(/'/g, "\\'");
}

/**
 * Convert ClickHouse bucket interval to Data Prime bucket interval.
 *
 * Mapping:
 * - 5 SECOND -> 5s
 * - 10 SECOND -> 10s
 * - 1 MINUTE -> 1m
 * - 5 MINUTE -> 5m
 * - 10 MINUTE -> 10m
 * - 1 HOUR -> 1h
 *
 * @param {string} clickhouseBucket - ClickHouse bucket expression
 *   (e.g., "toStartOfInterval(timestamp, INTERVAL 1 MINUTE)")
 * @returns {string} Data Prime bucket interval (e.g., "1m")
 */
function convertBucketInterval(clickhouseBucket) {
  // Extract interval from expressions like:
  // - "toStartOfInterval(timestamp, INTERVAL 1 MINUTE)"
  // - "toStartOfMinute(timestamp)"
  // - "toStartOfFiveMinutes(timestamp)"
  // - "toStartOfTenMinutes(timestamp)"

  if (clickhouseBucket.includes('toStartOfMinute')) {
    return '1m';
  }
  if (clickhouseBucket.includes('toStartOfFiveMinutes')) {
    return '5m';
  }
  if (clickhouseBucket.includes('toStartOfTenMinutes')) {
    return '10m';
  }
  if (clickhouseBucket.includes('toStartOfHour')) {
    return '1h';
  }

  // Parse "toStartOfInterval(timestamp, INTERVAL X UNIT)"
  const match = clickhouseBucket.match(/INTERVAL\s+(\d+)\s+(\w+)/i);
  if (!match) {
    return '1m'; // Default to 1 minute
  }

  const amount = match[1];
  const unit = match[2].toUpperCase();

  const unitMap = {
    SECOND: 's',
    MINUTE: 'm',
    HOUR: 'h',
    DAY: 'd',
  };

  const unitSuffix = unitMap[unit.replace(/S$/, '')] || 'm';
  return `${amount}${unitSuffix}`;
}

/**
 * Build time filter for Data Prime.
 *
 * @param {Object} options
 * @param {Date} options.start - Start timestamp
 * @param {Date} options.end - End timestamp
 * @returns {string} Data Prime filter expression
 */
function buildTimeFilter({ start, end }) {
  const startTs = formatDataPrimeTimestamp(start);
  const endTs = formatDataPrimeTimestamp(end);

  // Data Prime uses between on the source line: source logs between @'...' and @'...'
  return `between @'${startTs}' and @'${endTs}'`;
}

/**
 * Build host filter for Data Prime.
 *
 * @param {string|null} hostFilter - Host filter string
 * @returns {string} Data Prime filter expression or empty string
 */
function buildHostFilter(hostFilter) {
  if (!hostFilter) return '';

  const escaped = escapeDataPrimeString(hostFilter);
  return `($d.request.host.includes('${escaped}') || $d.request.headers.x_forwarded_host.includes('${escaped}'))`;
}

/**
 * Convert ClickHouse column name to Data Prime field accessor.
 *
 * @param {string} column - ClickHouse column name (with or without backticks)
 * @returns {string} Data Prime field accessor
 */
function convertColumnToField(column) {
  // Remove backticks
  const cleaned = column.replace(/`/g, '');

  // Special mappings
  const fieldMap = {
    source: '$l.subsystemname',
    timestamp: 'timestamp',
  };

  if (fieldMap[cleaned]) {
    return fieldMap[cleaned];
  }

  // Default to $d. prefix for data fields
  return `$d.${cleaned}`;
}

/**
 * Build facet filters for Data Prime.
 * Converts ClickHouse-style filters to Data Prime filter expressions.
 *
 * @param {Array<{col: string, op: string, value: string}>} filters
 * @returns {string} Data Prime filter expression or empty string
 */
function buildFacetFilters(filters) {
  if (!filters || filters.length === 0) return '';

  const expressions = filters.map((filter) => {
    const field = convertColumnToField(filter.col);
    const escapedValue = escapeDataPrimeString(String(filter.value));

    switch (filter.op) {
      case '=':
        return `${field} == '${escapedValue}'`;
      case '!=':
        return `${field} != '${escapedValue}'`;
      case 'LIKE':
        return `${field}.includes('${escapedValue}')`;
      case 'NOT LIKE':
        return `!${field}.includes('${escapedValue}')`;
      case '>':
        return `${field} > ${escapedValue}`;
      case '<':
        return `${field} < ${escapedValue}`;
      case '>=':
        return `${field} >= ${escapedValue}`;
      case '<=':
        return `${field} <= ${escapedValue}`;
      case 'IN': {
        const values = Array.isArray(filter.value)
          ? filter.value.map((v) => `'${escapeDataPrimeString(String(v))}'`).join(', ')
          : `'${escapedValue}'`;
        return `${field} in [${values}]`;
      }
      default:
        return `${field} == '${escapedValue}'`;
    }
  });

  return expressions.join(' && ');
}

/**
 * Build a Data Prime time-series query.
 *
 * Features:
 * - Time bucketing (5s, 10s, 1m, 5m, 10m, 1h)
 * - Status code grouping (ok: <400, 4xx: 400-499, 5xx: >=500)
 * - Host filtering (request.host or x_forwarded_host)
 * - Facet/column filtering
 * - Additional WHERE clauses
 * - Sampling for longer time ranges (optional)
 *
 * @param {Object} options
 * @param {Date} options.start - Start timestamp
 * @param {Date} options.end - End timestamp
 * @param {string} options.bucket - ClickHouse bucket expression
 *   (e.g., "toStartOfMinute(timestamp)")
 * @param {string} [options.hostFilter] - Host filter string
 * @param {Array<{col: string, op: string, value: string}>} [options.facetFilters] - Facet filters
 * @param {string} [options.additionalWhereClause] - Additional filter clause (Data Prime syntax)
 * @param {number} [options.samplingRate] - Sampling rate (0-1), for optimization on large ranges
 * @param {boolean} [options.multiplier=false] - Whether to apply sampling multiplier to counts
 * @returns {string} Complete Data Prime query
 */
export function buildTimeSeriesQuery(options) {
  const {
    start,
    end,
    bucket,
    hostFilter = null,
    facetFilters = [],
    additionalWhereClause = '',
    samplingRate = null,
    multiplier = false,
  } = options;

  const parts = [];

  // 1. Source with time range
  const timeFilter = buildTimeFilter({ start, end });
  parts.push(`source logs ${timeFilter}`);

  // 2. Filter by subsystem (CDN sources)
  parts.push("| filter $l.subsystemname in ['cloudflare', 'fastly']");

  // 4. Host filter (if specified)
  const hostFilterExpr = buildHostFilter(hostFilter);
  if (hostFilterExpr) {
    parts.push(`| filter ${hostFilterExpr}`);
  }

  // 5. Facet filters (if specified)
  const facetFilterExpr = buildFacetFilters(facetFilters);
  if (facetFilterExpr) {
    parts.push(`| filter ${facetFilterExpr}`);
  }

  // 6. Additional WHERE clause (if specified)
  if (additionalWhereClause) {
    parts.push(`| filter ${additionalWhereClause}`);
  }

  // 7. Sampling (if specified)
  // Note: Data Prime sampling syntax may differ from ClickHouse
  // For now, we'll add it as a comment for future implementation
  if (samplingRate && samplingRate < 1) {
    // TODO: Implement Data Prime sampling
    // ClickHouse uses: SAMPLE samplingRate
    // Data Prime may use a different approach
    parts.push(`// TODO: Apply sampling rate ${samplingRate}`);
  }

  // 8. Create status indicator fields
  // Instead of countIf, we create indicator fields and sum them
  parts.push('| create status_ok = $d.response.status < 400 ? 1 : 0');
  parts.push('| create status_4xx = ($d.response.status >= 400 && $d.response.status < 500) ? 1 : 0');
  parts.push('| create status_5xx = $d.response.status >= 500 ? 1 : 0');

  // 9. Convert bucket expression to Data Prime interval
  const dpBucket = convertBucketInterval(bucket);

  // 10. Group by time bucket and aggregate
  const mult = multiplier && samplingRate ? ` * ${Math.round(1 / samplingRate)}` : '';

  parts.push(`| groupby $m.timestamp.bucket(${dpBucket}) as t aggregate`);
  parts.push(`    sum(status_ok)${mult} as cnt_ok,`);
  parts.push(`    sum(status_4xx)${mult} as cnt_4xx,`);
  parts.push(`    sum(status_5xx)${mult} as cnt_5xx`);

  // 11. Sort by time ascending
  parts.push('| sort t asc');

  return parts.join('\n');
}

/**
 * Build time-series query with parameters from state/config.
 *
 * This is a convenience wrapper that matches the ClickHouse query builder signature.
 *
 * @param {Object} params
 * @param {Date} params.start - Start timestamp
 * @param {Date} params.end - End timestamp
 * @param {string} params.bucket - ClickHouse bucket expression
 * @param {string} [params.hostFilter] - Host filter string
 * @param {Array} [params.facetFilters] - Facet filters
 * @param {string} [params.additionalWhereClause] - Additional filter clause
 * @param {Object} [params.sampling] - Sampling config { rate, multiplier }
 * @returns {string} Data Prime query
 */
export function buildQuery(params) {
  return buildTimeSeriesQuery({
    start: params.start,
    end: params.end,
    bucket: params.bucket,
    hostFilter: params.hostFilter,
    facetFilters: params.facetFilters,
    additionalWhereClause: params.additionalWhereClause,
    samplingRate: params.sampling?.rate,
    multiplier: params.sampling?.multiplier,
  });
}

/**
 * Example usage:
 *
 * ```javascript
 * import { buildTimeSeriesQuery } from './queries/time-series.dataprime.js';
 * import { TIME_RANGES } from './constants.js';
 *
 * const query = buildTimeSeriesQuery({
 *   start: new Date('2025-02-16T18:00:00Z'),
 *   end: new Date('2025-02-16T19:00:00Z'),
 *   bucket: TIME_RANGES['1h'].bucket, // "toStartOfInterval(timestamp, INTERVAL 10 SECOND)"
 *   hostFilter: 'example.com',
 *   facetFilters: [
 *     { col: 'cdn.cache_status', op: '=', value: 'MISS' },
 *   ],
 * });
 *
 * console.log(query);
 * // source logs
 * // | filter $l.subsystemname in ['cloudflare', 'fastly']
 * // | filter timestamp >= timestamp('2025-02-16T18:00:00.000Z')
 * //     && timestamp <= timestamp('2025-02-16T19:00:00.000Z')
 * // | filter ($d.request.host.includes('example.com')
 * //     || $d.request.headers.x_forwarded_host
 * //        .includes('example.com'))
 * // | filter $d.cdn.cache_status == 'MISS'
 * // | create status_ok = $d.response.status < 400 ? 1 : 0
 * // | create status_4xx = ($d.response.status >= 400 && $d.response.status < 500) ? 1 : 0
 * // | create status_5xx = $d.response.status >= 500 ? 1 : 0
 * // | groupby timestamp.bucket(10s) as t aggregate
 * //     sum(status_ok) as cnt_ok,
 * //     sum(status_4xx) as cnt_4xx,
 * //     sum(status_5xx) as cnt_5xx
 * // | sort t asc
 * ```
 *
 * Bucket interval mapping:
 * - "toStartOfInterval(timestamp, INTERVAL 5 SECOND)" -> "5s"
 * - "toStartOfInterval(timestamp, INTERVAL 10 SECOND)" -> "10s"
 * - "toStartOfMinute(timestamp)" -> "1m"
 * - "toStartOfFiveMinutes(timestamp)" -> "5m"
 * - "toStartOfTenMinutes(timestamp)" -> "10m"
 * - "toStartOfInterval(timestamp, INTERVAL 1 HOUR)" -> "1h"
 *
 * Time ranges from constants.js:
 * - '15m': bucket(5s)
 * - '1h': bucket(10s)
 * - '12h': bucket(1m)
 * - '24h': bucket(5m)
 * - '7d': bucket(10m)
 */
