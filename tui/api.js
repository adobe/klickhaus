/**
 * ClickHouse API Client for TUI
 */

import { CLICKHOUSE_URL, DATABASE, TIME_RANGES, BREAKDOWNS } from './config.js';
import { state } from './state.js';

/**
 * Execute a ClickHouse query
 * @param {string} sql - SQL query
 * @param {object} options - Query options
 * @returns {Promise<object>} Query result
 */
export async function query(sql, { cacheTtl = null, skipCache = false } = {}) {
  const credentials = state.get('credentials');
  if (!credentials) {
    throw new Error('Not authenticated');
  }

  const params = new URLSearchParams();

  if (!skipCache) {
    if (cacheTtl === null) {
      const timeRange = state.get('timeRange');
      cacheTtl = TIME_RANGES[timeRange]?.cacheTtl || 300;
    }
    params.set('use_query_cache', '1');
    params.set('query_cache_ttl', cacheTtl.toString());
    params.set('query_cache_nondeterministic_function_handling', 'save');
  }

  // Normalize SQL whitespace for consistent cache keys
  const normalizedSql = sql.replace(/\s+/g, ' ').trim();

  const url = `${CLICKHOUSE_URL}?${params}`;
  const auth = Buffer.from(`${credentials.user}:${credentials.password}`).toString('base64');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`
    },
    body: normalizedSql + ' FORMAT JSON'
  });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 401 || text.includes('Authentication failed')) {
      state.set('credentials', null);
      throw new Error('Authentication failed');
    }
    throw new Error(text);
  }

  return response.json();
}

/**
 * Test ClickHouse connection
 */
export async function testConnection() {
  try {
    await query('SELECT 1', { skipCache: true });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Get table name based on time range
 */
export function getTable() {
  const timeRange = state.get('timeRange');
  return ['15m', '1h', '12h'].includes(timeRange)
    ? 'cdn_requests_v2'
    : 'cdn_requests_combined';
}

/**
 * Get time filter SQL
 */
export function getTimeFilter() {
  const timeRange = state.get('timeRange');
  const ts = state.get('queryTimestamp') || new Date();
  const isoTimestamp = ts.toISOString().replace('T', ' ').slice(0, 19);
  const interval = TIME_RANGES[timeRange].interval;
  return `timestamp BETWEEN toDateTime('${isoTimestamp}') - ${interval} AND toDateTime('${isoTimestamp}')`;
}

/**
 * Get host filter SQL
 */
export function getHostFilter() {
  const hostFilter = state.get('hostFilter');
  if (!hostFilter) return '';
  const escaped = hostFilter.replace(/'/g, "\\'");
  return `AND (\`request.host\` LIKE '%${escaped}%' OR \`request.headers.x_forwarded_host\` LIKE '%${escaped}%')`;
}

/**
 * Build facet filter SQL
 */
export function buildFacetFilterSQL(filters, excludeCol = null) {
  const activeFilters = excludeCol
    ? filters.filter(f => f.col !== excludeCol)
    : filters;

  if (activeFilters.length === 0) return '';

  const byColumn = {};
  for (const f of activeFilters) {
    const sqlCol = f.filterCol || f.col;
    const sqlValue = f.filterValue ?? f.value;
    if (!byColumn[f.col]) byColumn[f.col] = { sqlCol, includes: [], excludes: [] };
    const isNumeric = typeof sqlValue === 'number';
    const escaped = isNumeric ? sqlValue : sqlValue.replace(/'/g, "\\'");
    const comparison = isNumeric ? escaped : `'${escaped}'`;
    if (f.exclude) {
      byColumn[f.col].excludes.push(`${sqlCol} != ${comparison}`);
    } else {
      byColumn[f.col].includes.push(`${sqlCol} = ${comparison}`);
    }
  }

  const columnClauses = [];
  for (const col of Object.keys(byColumn)) {
    const { includes, excludes } = byColumn[col];
    const parts = [];
    if (includes.length > 0) {
      parts.push(includes.length === 1 ? includes[0] : `(${includes.join(' OR ')})`);
    }
    if (excludes.length > 0) {
      parts.push(excludes.join(' AND '));
    }
    columnClauses.push(parts.length === 1 ? parts[0] : `(${parts.join(' AND ')})`);
  }

  return columnClauses.map(c => `AND ${c}`).join(' ');
}

/**
 * Fetch time series data for chart
 */
export async function fetchChartData() {
  const timeRange = state.get('timeRange');
  const bucket = TIME_RANGES[timeRange].bucket;
  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const facetFilters = buildFacetFilterSQL(state.get('filters'));

  const sql = `
    SELECT
      ${bucket} as t,
      countIf(\`response.status\` >= 100 AND \`response.status\` < 400) as cnt_ok,
      countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx,
      countIf(\`response.status\` >= 500) as cnt_5xx,
      count() as total
    FROM ${DATABASE}.${getTable()}
    WHERE ${timeFilter} ${hostFilter} ${facetFilters}
    GROUP BY t
    ORDER BY t
  `;

  const result = await query(sql);
  return result.data;
}

/**
 * Fetch breakdown data for a facet
 */
export async function fetchBreakdownData(breakdownId) {
  const breakdown = BREAKDOWNS.find(b => b.id === breakdownId);
  if (!breakdown) throw new Error(`Unknown breakdown: ${breakdownId}`);

  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const facetFilters = buildFacetFilterSQL(state.get('filters'), breakdown.col);
  const extra = breakdown.extraFilter || '';
  const orderBy = breakdown.orderBy || 'cnt DESC';
  const topN = state.get('topN');

  const sql = `
    SELECT
      ${breakdown.col} as dim,
      count() as cnt,
      countIf(\`response.status\` >= 100 AND \`response.status\` < 400) as cnt_ok,
      countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx,
      countIf(\`response.status\` >= 500) as cnt_5xx
    FROM ${DATABASE}.${getTable()}
    WHERE ${timeFilter} ${hostFilter} ${facetFilters} ${extra}
    GROUP BY dim WITH TOTALS
    ORDER BY ${orderBy}
    LIMIT ${topN}
  `;

  const result = await query(sql);
  return {
    data: result.data,
    totals: result.totals
  };
}

/**
 * Fetch all breakdown data
 */
export async function fetchAllBreakdowns() {
  const results = {};
  for (const breakdown of BREAKDOWNS) {
    try {
      results[breakdown.id] = await fetchBreakdownData(breakdown.id);
    } catch (err) {
      results[breakdown.id] = { error: err.message };
    }
  }
  return results;
}

/**
 * Fetch log data
 */
export async function fetchLogs() {
  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const facetFilters = buildFacetFilterSQL(state.get('filters'));
  const offset = state.get('logsOffset');
  const limit = state.get('logsLimit');

  const sql = `
    SELECT
      timestamp,
      source,
      \`request.host\` as request_host,
      \`request.url\` as request_url,
      \`request.method\` as request_method,
      \`response.status\` as response_status,
      \`response.body_size\` as response_body_size,
      \`response.headers.content_type\` as content_type,
      \`cdn.cache_status\` as cache_status,
      \`cdn.datacenter\` as datacenter,
      \`cdn.time_elapsed_msec\` as time_elapsed_msec,
      \`client.ip\` as client_ip,
      \`client.country_name\` as country,
      \`client.city_name\` as city,
      \`client.asn\` as asn,
      \`request.headers.user_agent\` as user_agent,
      \`request.headers.referer\` as referer,
      \`response.headers.x_error\` as x_error
    FROM ${DATABASE}.${getTable()}
    WHERE ${timeFilter} ${hostFilter} ${facetFilters}
    ORDER BY timestamp DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const result = await query(sql);
  return result.data;
}

/**
 * Get summary statistics
 */
export async function fetchSummary() {
  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const facetFilters = buildFacetFilterSQL(state.get('filters'));

  const sql = `
    SELECT
      count() as total,
      countIf(\`response.status\` >= 100 AND \`response.status\` < 400) as cnt_ok,
      countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx,
      countIf(\`response.status\` >= 500) as cnt_5xx,
      countIf(upper(\`cdn.cache_status\`) LIKE 'HIT%') as cache_hits,
      avg(\`cdn.time_elapsed_msec\`) as avg_time,
      quantile(0.95)(\`cdn.time_elapsed_msec\`) as p95_time,
      sum(\`response.body_size\`) as total_bytes
    FROM ${DATABASE}.${getTable()}
    WHERE ${timeFilter} ${hostFilter} ${facetFilters}
  `;

  const result = await query(sql);
  return result.data[0];
}
