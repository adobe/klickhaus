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
 * Data Prime query builder for facet breakdown queries.
 * Translates ClickHouse breakdown queries to Coralogix Data Prime syntax.
 *
 * @module queries/breakdown.dataprime
 */

/**
 * Field mapping from ClickHouse column paths to Data Prime field references.
 * Data Prime uses $d. prefix for user data fields and $l. for log metadata.
 */
const FIELD_MAP = {
  // Response fields
  'response.status': '$d.response.status',
  'response.headers.content_type': '$d.response.headers.content_type',
  'response.headers.x_error': '$d.response.headers.x_error',
  'response.headers.location': '$d.response.headers.location',
  'response.headers.content_length': '$d.response.headers.content_length',

  // Request fields
  'request.host': '$d.request.host',
  'request.url': '$d.request.url',
  'request.method': '$d.request.method',
  'request.headers.x_forwarded_host': '$d.request.headers.x_forwarded_host',
  'request.headers.referer': '$d.request.headers.referer',
  'request.headers.user_agent': '$d.request.headers.user_agent',
  'request.headers.accept': '$d.request.headers.accept',
  'request.headers.accept_encoding': '$d.request.headers.accept_encoding',
  'request.headers.cache_control': '$d.request.headers.cache_control',
  'request.headers.x_byo_cdn_type': '$d.request.headers.x_byo_cdn_type',
  'request.headers.x_forwarded_for': '$d.request.headers.x_forwarded_for',
  'request.headers.x_push_invalidation': '$d.request.headers.x_push_invalidation',

  // CDN fields
  'cdn.cache_status': '$d.cdn.cache_status',
  'cdn.datacenter': '$d.cdn.datacenter',
  'cdn.time_elapsed_msec': '$d.cdn.time_elapsed_msec',

  // Client fields
  'client.ip': '$d.client.ip',
  'client.asn': '$d.client.asn',

  // Helix fields
  'helix.request_type': '$d.helix.request_type',
  'helix.backend_type': '$d.helix.backend_type',

  // Source field (CDN source: cloudflare or fastly)
  source: '$l.subsystemname',
};

/**
 * Converts a ClickHouse column reference to Data Prime field reference.
 * @param {string} clickhouseCol - ClickHouse column (e.g., "`response.status`")
 * @returns {string} Data Prime field reference (e.g., "$d.response.status")
 */
function toDataPrimeField(clickhouseCol) {
  // Remove backticks
  const cleaned = clickhouseCol.replace(/`/g, '');
  return FIELD_MAP[cleaned] || `$d.${cleaned}`;
}

/**
 * Converts ClickHouse SQL expression to Data Prime expression.
 * @param {string} sqlExpr - ClickHouse SQL expression
 * @returns {string} Data Prime expression
 */
function toDataPrimeExpr(sqlExpr) {
  let expr = sqlExpr;

  // Replace backticked column references with Data Prime field refs
  expr = expr.replace(/`([^`]+)`/g, (match, col) => FIELD_MAP[col] || `$d.${col}`);

  // Convert SQL functions to Data Prime equivalents
  expr = expr.replace(/toString\(/g, 'tostring(');
  expr = expr.replace(/intDiv\(/g, 'todecimal(');
  expr = expr.replace(/concat\(/g, 'strcat(');
  expr = expr.replace(/upper\(/g, 'toupper(');
  expr = expr.replace(/REGEXP_REPLACE\(/g, 'replace_regex(');

  // Convert SQL operators to Data Prime operators
  expr = expr.replace(/\s+AND\s+/g, ' && ');
  expr = expr.replace(/\s+OR\s+/g, ' || ');
  expr = expr.replace(/\s+!=\s+/g, ' != ');
  expr = expr.replace(/\s+LIKE\s+/g, ' matches ');

  // Convert SQL LIKE patterns to regex
  // '%pattern%' -> '.*pattern.*'
  // 'pattern%' -> 'pattern.*'
  // '%pattern' -> '.*pattern'
  expr = expr.replace(/'%([^%']+)%'/g, "'.*$1.*'");
  expr = expr.replace(/'([^%']+)%'/g, "'$1.*'");
  expr = expr.replace(/'%([^%']+)'/g, "'.*$1'");

  return expr;
}

/**
 * Builds a Data Prime breakdown query.
 *
 * @param {Object} params - Query parameters
 * @param {string} params.dimExpr - Dimension expression (ClickHouse SQL)
 * @param {string} [params.filterExpr] - Additional filter expression (ClickHouse SQL)
 * @param {number} [params.topN=10] - Number of top results to return
 * @param {string} [params.orderBy='cnt'] - Field to order by
 * @param {string} [params.timeFilter] - Time filter expression (Data Prime)
 * @returns {string} Data Prime query
 */
export function buildBreakdownQuery({
  dimExpr,
  filterExpr,
  topN = 10,
  orderBy = 'cnt',
  timeFilter,
}) {
  // Convert dimension expression to Data Prime
  const dpDimExpr = toDataPrimeExpr(dimExpr);

  // Build filter clause
  const filters = [];

  // Add subsystem filter (cloudflare or fastly)
  filters.push("$l.subsystemname in ['cloudflare', 'fastly']");

  // Add time filter if provided
  if (timeFilter) {
    filters.push(timeFilter);
  }

  // Add custom filter if provided
  if (filterExpr) {
    filters.push(toDataPrimeExpr(filterExpr));
  }

  const filterClause = filters.length > 0 ? `| filter ${filters.join(' && ')}` : '';

  // Build the query
  return `source logs
${filterClause}
| groupby ${dpDimExpr} as dim aggregate
    count() as cnt,
    count(${toDataPrimeField('`response.status`')} < 400) as cnt_ok,
    count(${toDataPrimeField('`response.status`')} >= 400 && ${toDataPrimeField('`response.status`')} < 500) as cnt_4xx,
    count(${toDataPrimeField('`response.status`')} >= 500) as cnt_5xx
| sort ${orderBy} desc
| limit ${topN}`;
}

/**
 * Facet-specific dimension expressions mapped from ClickHouse to Data Prime.
 */
export const FACET_DIMENSIONS = {
  // Status range: '2xx', '4xx', '5xx'
  status_range: "strcat(tostring(todecimal($d.response.status / 100)), 'xx')",

  // Source: 'cloudflare' or 'fastly'
  source: '$l.subsystemname',

  // Host
  host: '$d.request.host',

  // Forwarded host
  x_forwarded_host: '$d.request.headers.x_forwarded_host',

  // Content type
  content_type: '$d.response.headers.content_type',

  // Status code (as string)
  status: 'tostring($d.response.status)',

  // Grouped error messages (replace paths with /...)
  x_error_grouped: "replace_regex($d.response.headers.x_error, '/[a-zA-Z0-9/_.-]+', '/...')",

  // Cache status (uppercase)
  cache_status: 'toupper($d.cdn.cache_status)',

  // URL/path
  url: '$d.request.url',

  // Referer
  referer: '$d.request.headers.referer',

  // User agent
  user_agent: '$d.request.headers.user_agent',

  // Client IP (with forwarded_for fallback)
  client_ip: '$d.request.headers.x_forwarded_for != "" ? $d.request.headers.x_forwarded_for : $d.client.ip',

  // Request type
  request_type: '$d.helix.request_type',

  // Backend type
  backend_type: '$d.helix.backend_type',

  // Method
  method: '$d.request.method',

  // Datacenter
  datacenter: '$d.cdn.datacenter',

  // Accept header
  accept: '$d.request.headers.accept',

  // Accept-Encoding header
  accept_encoding: '$d.request.headers.accept_encoding',

  // Cache-Control header
  cache_control: '$d.request.headers.cache_control',

  // BYO CDN type
  byo_cdn: '$d.request.headers.x_byo_cdn_type',

  // Redirect location
  location: '$d.response.headers.location',
};

/**
 * Additional filters for specific facets.
 */
export const FACET_FILTERS = {
  x_error_grouped: '$d.response.headers.x_error != ""',
  request_type: '$d.helix.request_type != ""',
  accept: '$d.request.headers.accept != ""',
  accept_encoding: '$d.request.headers.accept_encoding != ""',
  cache_control: '$d.request.headers.cache_control != ""',
  byo_cdn: '$d.request.headers.x_byo_cdn_type != ""',
  location: '$d.response.headers.location != ""',
};

/**
 * Builds a breakdown query for a specific facet.
 *
 * @param {string} facetName - Facet name (e.g., 'status_range', 'host')
 * @param {Object} options - Query options
 * @param {number} [options.topN=10] - Number of top results
 * @param {string} [options.timeFilter] - Time filter expression
 * @param {string} [options.additionalFilter] - Additional filter expression
 * @returns {string} Data Prime query
 */
export function buildFacetQuery(facetName, { topN = 10, timeFilter, additionalFilter } = {}) {
  const dimExpr = FACET_DIMENSIONS[facetName];
  if (!dimExpr) {
    throw new Error(`Unknown facet: ${facetName}`);
  }

  const filters = [];

  // Add facet-specific filter
  const facetFilter = FACET_FILTERS[facetName];
  if (facetFilter) {
    filters.push(facetFilter);
  }

  // Add additional filter
  if (additionalFilter) {
    filters.push(additionalFilter);
  }

  const combinedFilter = filters.join(' && ');

  return buildBreakdownQuery({
    dimExpr,
    filterExpr: combinedFilter,
    topN,
    timeFilter,
  });
}

/**
 * Example usage:
 *
 * // Status range breakdown
 * const query = buildFacetQuery('status_range', {
 *   topN: 10,
 *   timeFilter: '$m.timestamp >= now() - 1h'
 * });
 *
 * // Host breakdown with additional filter
 * const query2 = buildFacetQuery('host', {
 *   topN: 20,
 *   timeFilter: '$m.timestamp >= now() - 24h',
 *   additionalFilter: '$d.response.status >= 400'
 * });
 */
