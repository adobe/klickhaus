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
 * Data Prime query builder for Coralogix logs view.
 *
 * Migrates from ClickHouse SQL to Coralogix Data Prime query language.
 *
 * Features:
 * - Fetch raw log entries with all fields
 * - Support time-based filtering
 * - Support host filtering (request.host or x_forwarded_host)
 * - Support facet/column filters
 * - Support additional WHERE clauses
 * - Support field selection (column pinning)
 * - Support sorting (timestamp DESC by default)
 * - Support pagination with offset/limit
 *
 * Data Prime query structure:
 * source logs
 * | filter <subsystem filters>
 * | filter <time filters>
 * | filter <host filters>
 * | filter <facet filters>
 * | filter <additional filters>
 * | choose <selected fields>
 * | sort timestamp desc
 * | limit <pageSize> offset <offset>
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
 * Build time filter for Data Prime.
 * Equivalent to ClickHouse: WHERE timestamp >= X AND timestamp <= Y
 *
 * @param {Object} options
 * @param {Date} options.start - Start timestamp
 * @param {Date} options.end - End timestamp
 * @returns {string} Data Prime filter expression
 */
export function buildTimeFilter({ start, end }) {
  const startTs = formatDataPrimeTimestamp(start);
  const endTs = formatDataPrimeTimestamp(end);

  // Data Prime uses between on the source line: source logs between @'...' and @'...'
  return `between @'${startTs}' and @'${endTs}'`;
}

/**
 * Build host filter for Data Prime.
 * Equivalent to ClickHouse: WHERE request.host LIKE '%value%' OR x_forwarded_host LIKE '%value%'
 *
 * @param {Object} options
 * @param {string} options.hostFilter - Host filter string
 * @param {string} [options.hostFilterColumn] - Specific column to filter (optional)
 * @returns {string} Data Prime filter expression or empty string
 */
export function buildHostFilter({ hostFilter, hostFilterColumn }) {
  if (!hostFilter) return '';

  const escaped = escapeDataPrimeString(hostFilter);

  if (hostFilterColumn) {
    // Filter on specific column
    return `$l.${hostFilterColumn}.includes('${escaped}')`;
  }

  // Filter on either request.host or x_forwarded_host
  return `($l['request.host'].includes('${escaped}') || $l['request.headers.x_forwarded_host'].includes('${escaped}'))`;
}

/**
 * Convert ClickHouse column name to Data Prime field accessor.
 * Examples:
 *   - "request.host" -> "$l['request.host']"
 *   - "response.status" -> "$l['response.status']"
 *   - "timestamp" -> "timestamp"
 *
 * @param {string} column - ClickHouse column name (dot-notation)
 * @returns {string} Data Prime field accessor
 */
function columnToDataPrimeField(column) {
  // Special case: timestamp is a built-in field
  if (column === 'timestamp') {
    return 'timestamp';
  }

  // For dotted column names, use bracket notation
  if (column.includes('.')) {
    return `$l['${column}']`;
  }

  // Simple column names
  return `$l.${column}`;
}

/**
 * Build facet filters for Data Prime.
 * Converts ClickHouse-style filters to Data Prime filter expressions.
 *
 * @param {Array<{col: string, op: string, value: string}>} filters
 * @returns {string} Data Prime filter expression or empty string
 */
export function buildFacetFilters(filters) {
  if (!filters || filters.length === 0) return '';

  const expressions = filters.map((filter) => {
    const field = columnToDataPrimeField(filter.col);
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
        // For IN operator, value should be an array
        const values = Array.isArray(filter.value)
          ? filter.value.map((v) => `'${escapeDataPrimeString(String(v))}'`).join(', ')
          : `'${escapedValue}'`;
        return `${field} in [${values}]`;
      }
      default:
        // Default to equality
        return `${field} == '${escapedValue}'`;
    }
  });

  return expressions.join(' && ');
}

/**
 * Build field selection (choose clause) for Data Prime.
 * If no fields specified, returns all fields with "*".
 *
 * @param {string[]} [fields] - Array of field names to select
 * @returns {string} Data Prime choose clause
 */
export function buildChooseClause(fields) {
  if (!fields || fields.length === 0) {
    return '*';
  }

  // Map ClickHouse column names to Data Prime field expressions
  const fieldExprs = fields.map((field) => {
    if (field === 'timestamp') {
      return 'timestamp';
    }

    // For dotted fields, use as-is (Data Prime will handle the nesting)
    // We use the original field name as the output alias
    if (field.includes('.')) {
      return `$l['${field}'] as \`${field}\``;
    }

    return `$l.${field} as ${field}`;
  });

  return fieldExprs.join(', ');
}

/**
 * Build complete Data Prime query for logs view.
 *
 * @param {Object} options
 * @param {Date} options.start - Start timestamp
 * @param {Date} options.end - End timestamp
 * @param {string} [options.hostFilter] - Host filter string
 * @param {string} [options.hostFilterColumn] - Specific host column to filter
 * @param {Array<{col: string, op: string, value: string}>} [options.facetFilters] - Facet filters
 * @param {string} [options.additionalWhereClause] - Additional filter clause
 * @param {string[]} [options.fields] - Fields to select (for column pinning)
 * @param {number} [options.pageSize=500] - Number of records per page
 * @param {number} [options.offset=0] - Pagination offset
 * @param {string} [options.orderBy='timestamp DESC'] - Sort order
 * @returns {string} Complete Data Prime query
 */
export function buildLogsQuery(options) {
  const {
    start,
    end,
    hostFilter = null,
    hostFilterColumn = null,
    facetFilters = [],
    additionalWhereClause = '',
    fields = null,
    pageSize = 500,
    offset = 0,
    orderBy = 'timestamp DESC',
  } = options;

  const parts = [];

  // 1. Source with time range
  const timeFilter = buildTimeFilter({ start, end });
  parts.push(`source logs ${timeFilter}`);

  // 2. Filter by subsystem (CDN sources)
  parts.push("| filter $l.subsystemname in ['cloudflare', 'fastly']");

  // 4. Host filter (if specified)
  const hostFilterExpr = buildHostFilter({ hostFilter, hostFilterColumn });
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
    // Note: This would need to be converted from ClickHouse SQL to Data Prime syntax
    // For now, we'll pass it through as-is, but it may need translation
    parts.push(`| filter ${additionalWhereClause}`);
  }

  // 7. Field selection (if specified)
  const chooseClause = buildChooseClause(fields);
  if (chooseClause !== '*') {
    parts.push(`| choose ${chooseClause}`);
  }

  // 8. Sort order
  const sortExpr = orderBy.toLowerCase().includes('desc')
    ? 'timestamp desc'
    : 'timestamp asc';
  parts.push(`| sort ${sortExpr}`);

  // 9. Pagination
  if (offset > 0) {
    parts.push(`| limit ${pageSize} offset ${offset}`);
  } else {
    parts.push(`| limit ${pageSize}`);
  }

  return parts.join('\n');
}

/**
 * Parse time filter bounds from state/config.
 * Helper to extract start/end dates from various time range formats.
 *
 * @param {Object} timeState
 * @param {Date} [timeState.queryTimestamp] - Reference timestamp
 * @param {Object} [timeState.customTimeRange] - Custom range with start/end
 * @param {string} [timeState.timeRange] - Named time range (e.g., '1h', '24h')
 * @param {Object} [TIME_RANGES] - Time range definitions
 * @returns {{ start: Date, end: Date }}
 */
export function parseTimeFilterBounds(timeState, TIME_RANGES) {
  if (timeState.customTimeRange) {
    return {
      start: new Date(timeState.customTimeRange.start),
      end: new Date(timeState.customTimeRange.end),
    };
  }

  const end = timeState.queryTimestamp || new Date();
  const periodMs = TIME_RANGES[timeState.timeRange]?.periodMs || (60 * 60 * 1000); // default 1h
  const start = new Date(end.getTime() - periodMs);

  // Round to minute boundaries for consistency
  const MINUTE_MS = 60 * 1000;
  return {
    start: new Date(Math.floor(start.getTime() / MINUTE_MS) * MINUTE_MS),
    end: new Date(Math.floor(end.getTime() / MINUTE_MS) * MINUTE_MS),
  };
}

/**
 * Build query for loading more logs (pagination).
 *
 * @param {Object} options - Same as buildLogsQuery
 * @returns {string} Data Prime query for next page
 */
export function buildLogsMoreQuery(options) {
  return buildLogsQuery(options);
}

/**
 * Example usage:
 *
 * ```javascript
 * import { buildLogsQuery, parseTimeFilterBounds } from './queries/logs.dataprime.js';
 * import { TIME_RANGES } from './constants.js';
 *
 * const timeState = {
 *   timeRange: '1h',
 *   queryTimestamp: new Date(),
 * };
 *
 * const { start, end } = parseTimeFilterBounds(timeState, TIME_RANGES);
 *
 * const query = buildLogsQuery({
 *   start,
 *   end,
 *   hostFilter: 'example.com',
 *   facetFilters: [
 *     { col: 'response.status', op: '>=', value: '400' },
 *     { col: 'cdn.cache_status', op: '=', value: 'MISS' },
 *   ],
 *   fields: ['timestamp', 'request.host', 'request.url', 'response.status'],
 *   pageSize: 100,
 *   offset: 0,
 * });
 *
 * console.log(query);
 * // source logs
 * // | filter $l.subsystemname in ['cloudflare', 'fastly']
 * // | filter timestamp >= timestamp('2025-02-16T18:00:00.000Z')
 * //     && timestamp <= timestamp('2025-02-16T19:00:00.000Z')
 * // | filter ($l['request.host'].includes('example.com')
 * //     || $l['request.headers.x_forwarded_host']
 * //        .includes('example.com'))
 * // | filter $l['response.status'] >= '400'
 * //     && $l['cdn.cache_status'] == 'MISS'
 * // | choose timestamp,
 * //     $l['request.host'] as `request.host`,
 * //     $l['request.url'] as `request.url`,
 * //     $l['response.status'] as `response.status`
 * // | sort timestamp desc
 * // | limit 100
 * ```
 */
