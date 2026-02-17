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
 * Coralogix Integration Adapter
 *
 * Bridges Coralogix Data Prime API with existing klickhaus UI code.
 * Translates between ClickHouse-style queries and Data Prime syntax,
 * transforms responses to match expected klickhaus data structures.
 */

import { CORALOGIX_CONFIG } from './config.js';
import { getToken, getTeamId } from './auth.js';
import { authenticatedFetch } from './interceptor.js';
import {
  translateFacetFilters,
  translateHostFilter,
  getFieldPath,
} from './filter-translator.js';
import { QueryError } from '../api.js';
import { TIME_RANGES } from '../constants.js';
import { parseNDJSON } from './ndjson-parser.js';

// ---------------------------------------------------------------------------
// Error parsing helpers (extracted to reduce parseCoralogixError complexity)
// ---------------------------------------------------------------------------

/** Extract a human-readable message from a JSON error body, or return raw text. */
function extractJsonMessage(text) {
  try {
    const json = JSON.parse(text);
    return json.error || json.message || json.details || text;
  } catch {
    return text;
  }
}

/** Normalize raw error text to a single, trimmed line capped at 200 chars. */
function normalizeErrorMessage(raw) {
  const trimmed = String(raw).trim();
  const firstLine = trimmed.split('\n').map((l) => l.trim()).find(Boolean)
    || trimmed;
  const normalized = firstLine.replace(/\s+/g, ' ').trim();
  return {
    display: normalized.length > 200
      ? `${normalized.slice(0, 197)}...` : normalized,
    normalized,
  };
}

const PERMISSION_KEYWORDS = ['authentication', 'unauthorized', 'forbidden'];
const SYNTAX_KEYWORDS = ['syntax', 'parse error', 'invalid query'];
const RESOURCE_KEYWORDS = ['rate limit', 'too many requests', 'quota exceeded'];
const NETWORK_KEYWORDS = ['network', 'failed to fetch', 'connection'];

function textMatchesAny(text, keywords) {
  return keywords.some((kw) => text.includes(kw));
}

/** Map an HTTP status + normalized message to an error category. */
function categorizeError(status, lower) {
  if (status === 401 || status === 403
    || textMatchesAny(lower, PERMISSION_KEYWORDS)) return 'permissions';
  if (lower.includes('timeout') || status === 408) return 'timeout';
  if (textMatchesAny(lower, SYNTAX_KEYWORDS)) return 'syntax';
  if (status === 429
    || textMatchesAny(lower, RESOURCE_KEYWORDS)) return 'resource';
  if (textMatchesAny(lower, NETWORK_KEYWORDS)) return 'network';
  return 'unknown';
}

/** Parse Coralogix error response text into a structured object. */
function parseCoralogixError(text, status) {
  const message = extractJsonMessage(text);
  const { display, normalized } = normalizeErrorMessage(message);
  return {
    status,
    category: categorizeError(status, normalized.toLowerCase()),
    message: display,
    detail: normalized,
  };
}

// ---------------------------------------------------------------------------
// Interval / time helpers
// ---------------------------------------------------------------------------

const INTERVAL_MAP = {
  'toStartOfInterval(timestamp, INTERVAL 5 SECOND)': '5s',
  'toStartOfInterval(timestamp, INTERVAL 10 SECOND)': '10s',
  'toStartOfMinute(timestamp)': '1m',
  'toStartOfFiveMinutes(timestamp)': '5m',
  'toStartOfTenMinutes(timestamp)': '10m',
};

/** Map ClickHouse time bucket expressions to Data Prime intervals. */
function mapClickHouseIntervalToDataPrime(clickhouseBucket) {
  return INTERVAL_MAP[clickhouseBucket] || '1m';
}

/** Compute start/end Date objects and tier from a time-range key. */
function resolveTimeRange(timeRange) {
  const def = TIME_RANGES[timeRange];
  if (!def) throw new Error(`Unknown time range: ${timeRange}`);
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - def.periodMs);
  const hours = def.periodMs / (60 * 60 * 1000);
  const tier = CORALOGIX_CONFIG.getTierForTimeRange(hours);
  return { startTime, endTime, tier };
}

// ---------------------------------------------------------------------------
// Result transformers (defined before first use)
// ---------------------------------------------------------------------------

/** Transform Coralogix time series result to klickhaus chart format. */
function transformTimeSeriesResult(result) {
  if (!result || !result.results || result.results.length === 0) return [];
  return result.results.map((row) => ({
    t: row.t ? Math.floor(row.t / 1000000) : (row.timestamp || 0),
    cnt_ok: parseInt(row.cnt_ok || 0, 10),
    cnt_4xx: parseInt(row.cnt_4xx || 0, 10),
    cnt_5xx: parseInt(row.cnt_5xx || 0, 10),
  }));
}

/** Flatten nested Data Prime log object to dot notation keys. */
function flattenLogObject(obj, prefix = '') {
  const flattened = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object'
      && !Array.isArray(value) && !(value instanceof Date)) {
      Object.assign(flattened, flattenLogObject(value, newKey));
    } else {
      flattened[newKey] = value;
    }
  }
  return flattened;
}

/** Transform Coralogix logs result to klickhaus logs format. */
function transformLogsResult(result) {
  if (!result || !result.results || result.results.length === 0) return [];
  return result.results.map((log) => flattenLogObject(log));
}

/** Transform Coralogix breakdown result to klickhaus facet format. */
function transformBreakdownResult(result, facet = '') {
  const empty = {
    cnt: 0, cnt_ok: 0, cnt_4xx: 0, cnt_5xx: 0,
  };
  if (!result || !result.results || result.results.length === 0) {
    return { data: [], totals: { ...empty } };
  }

  const isStatusRange = facet
    && facet.includes('intDiv') && facet.includes('response.status');

  const data = result.results.map((row) => {
    let dim = row.dim != null ? String(row.dim) : '';
    if (isStatusRange && dim && !dim.includes('xx')
      && /^\d+(\.\d+)?$/.test(dim)) {
      dim = `${dim.split('.')[0]}xx`;
    }
    return {
      dim,
      cnt: parseInt(row.cnt || 0, 10),
      cnt_ok: parseInt(row.cnt_ok || 0, 10),
      cnt_4xx: parseInt(row.cnt_4xx || 0, 10),
      cnt_5xx: parseInt(row.cnt_5xx || 0, 10),
    };
  });

  const totals = data.reduce(
    (acc, row) => ({
      cnt: acc.cnt + row.cnt,
      cnt_ok: acc.cnt_ok + row.cnt_ok,
      cnt_4xx: acc.cnt_4xx + row.cnt_4xx,
      cnt_5xx: acc.cnt_5xx + row.cnt_5xx,
    }),
    { ...empty },
  );

  return { data, totals };
}

// ---------------------------------------------------------------------------
// multiIf conversion helpers (extracted to reduce complexity)
// ---------------------------------------------------------------------------

/** Split a string by commas, respecting quoted substrings. */
function splitRespectingQuotes(str) {
  const parts = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if ((ch === "'" || ch === '"') && (i === 0 || str[i - 1] !== '\\')) {
      if (!inQuote) {
        inQuote = true;
        quoteChar = ch;
      } else if (ch === quoteChar) {
        inQuote = false;
      }
    }
    if (ch === ',' && !inQuote) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current.trim());
  return parts;
}

/** Parse condition/label pairs from the parts of a multiIf expression. */
function parseMultiIfConditions(parts) {
  const conditions = [];
  let i = 0;
  while (i < parts.length - 1) {
    const condition = parts[i];
    const label = parts[i + 1].replace(/^['"]|['"]$/g, '');
    const ltMatch = condition.match(/`[^`]+`\s*<\s*(\d+)/);
    const eqMatch = condition.match(/`[^`]+`\s*=\s*(\d+)/);
    if (ltMatch) {
      conditions.push({ op: '<', threshold: ltMatch[1], label });
      i += 2;
    } else if (eqMatch) {
      conditions.push({ op: '==', threshold: eqMatch[1], label });
      i += 2;
    } else { break; }
  }
  return conditions;
}

/**
 * Convert ClickHouse multiIf() to Data Prime case_lessthan or case.
 * @param {string} multiIfExpr - multiIf expression
 * @returns {string} Data Prime case expression
 */
function convertMultiIfToCaseLessThan(multiIfExpr) {
  const fieldMatch = multiIfExpr.match(/multiIf\s*\(\s*`([^`]+)`/i);
  if (!fieldMatch) {
    throw new Error(`Cannot extract field from multiIf: ${multiIfExpr}`);
  }
  const dpField = getFieldPath(`\`${fieldMatch[1]}\``);
  const inner = multiIfExpr.replace(/^multiIf\s*\(/i, '').replace(/\)$/, '');
  const parts = splitRespectingQuotes(inner);
  const conditions = parseMultiIfConditions(parts);
  const fallback = parts[parts.length - 1].replace(/^['"]|['"]$/g, '');

  if (conditions.some((c) => c.op === '==')) {
    const cases = conditions.map((c) => (c.op === '=='
      ? `${dpField}:num == ${c.threshold} -> '${c.label}'`
      : `${dpField}:num < ${c.threshold} -> '${c.label}'`));
    return `case { ${cases.join(', ')}, _ -> '${fallback}' }`;
  }
  const list = conditions.map((c) => `${c.threshold} -> '${c.label}'`);
  return `case_lessthan { ${dpField}:num, ${list.join(', ')}, _ -> '${fallback}' }`;
}

// ---------------------------------------------------------------------------
// Filter / expression translation
// ---------------------------------------------------------------------------

/** Translate ClickHouse extraFilter syntax to Data Prime. */
function translateExtraFilter(extraFilter) {
  let filter = extraFilter.replace(/^\s*AND\s+/i, '');
  filter = filter.replace(/`([^`]+)`/g, (_, col) => getFieldPath(`\`${col}\``));
  filter = filter.replace(
    /(\$[dlm]\.[^\s]+)\s*!=\s*['"]{2}/g,
    (_, fp) => `${fp} != null`,
  );
  filter = filter.replace(/([^=!<>])\s*=\s*([^=])/g, '$1 == $2');
  return filter;
}

/** Build a Data Prime expression for facet grouping. */
function buildFacetExpression(facetExpression) {
  const cleanExpr = facetExpression.replace(/`/g, '');

  if (cleanExpr.includes('intDiv') && cleanExpr.includes('response.status')) {
    return '$d.response.status:num / 100';
  }
  if (cleanExpr.match(/^toString\(/)) {
    return `${getFieldPath(facetExpression)}:string`;
  }
  if (cleanExpr.match(/^upper\(/)) return getFieldPath(facetExpression);
  if (cleanExpr.match(/^REGEXP_REPLACE\(/i)) {
    return getFieldPath(facetExpression);
  }
  if (cleanExpr.match(/^if\(/i)) {
    if (cleanExpr.includes('x_forwarded_for')) {
      return '$d.request.headers.x_forwarded_for';
    }
    const m = cleanExpr.match(/if\([^,]+,\s*([^,]+),/i);
    if (m) return getFieldPath(`\`${m[1].replace(/`/g, '').trim()}\``);
  }
  if (cleanExpr.match(/^multiIf\(/i)) {
    return convertMultiIfToCaseLessThan(facetExpression);
  }
  return getFieldPath(facetExpression);
}

// ---------------------------------------------------------------------------
// Shared aggregation snippet
// ---------------------------------------------------------------------------

const AGG_COUNTS = `count() as cnt,
    sum(case { $d.response.status:num < 400 -> 1, _ -> 0 }) as cnt_ok,
    sum(case { $d.response.status:num >= 400 && $d.response.status:num < 500 -> 1, _ -> 0 }) as cnt_4xx,
    sum(case { $d.response.status:num >= 500 -> 1, _ -> 0 }) as cnt_5xx`;

// ---------------------------------------------------------------------------
// Query builders
// ---------------------------------------------------------------------------

/** Append common filter clauses (host, facets, extra) to a query string. */
function appendFilters(query, { hostFilter, filters, extraFilter }) {
  let q = query;
  if (hostFilter) {
    q += `\n| filter ${translateHostFilter(hostFilter)}`;
  }
  if (filters && filters.length > 0) {
    const cond = translateFacetFilters(filters);
    if (cond) q += `\n| filter ${cond}`;
  }
  if (extraFilter) {
    const translated = translateExtraFilter(extraFilter);
    if (translated) q += `\n| filter ${translated}`;
  }
  return q;
}

function buildTimeSeriesQuery({
  startTime, endTime, interval,
  filters = [], hostFilter = '', additionalFilter = '',
}) {
  let query = `source logs
| filter $m.timestamp >= @'${startTime.toISOString()}' && $m.timestamp <= @'${endTime.toISOString()}'`;

  query = appendFilters(query, { hostFilter, filters });
  if (additionalFilter) query += `\n| filter ${additionalFilter}`;

  query += `
| groupby $m.timestamp/${interval} as t aggregate
    count() as total,
    sum(case { $d.response.status:num < 400 -> 1, _ -> 0 }) as cnt_ok,
    sum(case { $d.response.status:num >= 400 && $d.response.status:num < 500 -> 1, _ -> 0 }) as cnt_4xx,
    sum(case { $d.response.status:num >= 500 -> 1, _ -> 0 }) as cnt_5xx
| orderby t asc`;
  return query;
}

function buildBreakdownQuery({
  facet, topN, filters = [], hostFilter = '',
  startTime, endTime, extraFilter = '', orderBy = 'cnt DESC',
}) {
  const facetExpr = buildFacetExpression(facet);
  let query = `source logs
| filter $m.timestamp >= @'${startTime.toISOString()}' && $m.timestamp <= @'${endTime.toISOString()}'`;

  // Exclude current facet from filters
  const otherFilters = filters.filter((f) => f.col !== facet);
  query = appendFilters(query, {
    hostFilter, filters: otherFilters, extraFilter,
  });

  query += `\n| groupby ${facetExpr} as dim aggregate\n    ${AGG_COUNTS}`;
  const orderField = orderBy.includes('DESC') ? orderBy.split(' ')[0] : 'cnt';
  const dir = orderBy.includes('ASC') ? 'asc' : 'desc';
  query += `\n| orderby ${orderField} ${dir}\n| limit ${topN}`;
  return query;
}

function buildLogsQuery({
  filters = [], hostFilter = '',
  startTime, endTime, limit, offset = 0, additionalFilter = '',
}) {
  let query = `source logs
| filter $m.timestamp >= @'${startTime.toISOString()}' && $m.timestamp <= @'${endTime.toISOString()}'`;

  query = appendFilters(query, { hostFilter, filters });
  if (additionalFilter) query += `\n| filter ${additionalFilter}`;

  query += '\n| orderby $m.timestamp desc';
  if (offset > 0) query += `\n| offset ${offset}`;
  query += `\n| limit ${limit}`;
  return query;
}

function buildMultiFacetQuery({
  facets, startTime, endTime,
  filters = [], hostFilter = '', topN,
}) {
  let query = `source logs
| filter $m.timestamp >= @'${startTime.toISOString()}' && $m.timestamp <= @'${endTime.toISOString()}'`;
  query = appendFilters(query, { hostFilter, filters });

  const sets = facets.map((def) => {
    const expr = buildFacetExpression(def.col);
    const ob = def.orderBy || 'cnt DESC';
    const field = ob.includes('DESC') ? ob.split(' ')[0] : 'cnt';
    const dir = ob.includes('ASC') ? 'asc' : 'desc';
    return `(groupby ${expr} as dim aggregate\n        ${AGG_COUNTS}
    | create facet_id = '${def.id}'
    | orderby ${field} ${dir}
    | limit ${topN})`;
  });

  query += `\n| multigroupby\n    ${sets.join(',\n    ')}`;
  query += '\n| orderby facet_id, cnt desc';
  return query;
}

// ---------------------------------------------------------------------------
// Core query execution
// ---------------------------------------------------------------------------

/** Execute a Data Prime query against Coralogix API. */
export async function executeDataPrimeQuery(dataPrimeQuery, { signal, tier } = {}) {
  const token = getToken();
  if (!token) {
    throw new QueryError('Coralogix authentication required', {
      category: 'permissions', status: 401,
    });
  }

  const requestBody = {
    query: dataPrimeQuery,
    metadata: {
      tier: tier || CORALOGIX_CONFIG.defaultTier,
      syntax: 'QUERY_SYNTAX_DATAPRIME',
    },
  };
  const fetchStart = performance.now();

  try {
    const teamId = getTeamId();
    const response = await authenticatedFetch(CORALOGIX_CONFIG.dataprimeApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(teamId && { 'CGX-Team-Id': String(teamId) }),
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      const parsed = parseCoralogixError(text, response.status);
      throw new QueryError(parsed.message, parsed);
    }

    const text = await response.text();
    const result = parseNDJSON(text);
    result.networkTime = performance.now() - fetchStart;
    return result;
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    if (!err.isQueryError) {
      throw new QueryError(err.message || 'Query execution failed', {
        category: 'network', detail: err.message,
      });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public fetch functions
// ---------------------------------------------------------------------------

/** Fetch time series data for chart display. */
export async function fetchTimeSeriesData({
  timeRange, interval, filters = [], hostFilter = '', signal,
}) {
  const { startTime, endTime, tier } = resolveTimeRange(timeRange);
  const dpInterval = mapClickHouseIntervalToDataPrime(interval);
  const query = buildTimeSeriesQuery({
    startTime, endTime, interval: dpInterval, filters, hostFilter,
  });
  const result = await executeDataPrimeQuery(query, { signal, tier });
  return transformTimeSeriesResult(result);
}

/** Fetch breakdown/facet data for tables. */
export async function fetchBreakdownData({
  facet, topN, filters = [], hostFilter = '',
  timeRange, extraFilter = '', orderBy = 'cnt DESC', signal,
}) {
  const { startTime, endTime, tier } = resolveTimeRange(timeRange);
  const query = buildBreakdownQuery({
    facet,
    topN,
    filters,
    hostFilter,
    startTime,
    endTime,
    extraFilter,
    orderBy,
  });
  const result = await executeDataPrimeQuery(query, { signal, tier });
  const transformed = transformBreakdownResult(result, facet);
  transformed.networkTime = result.networkTime;
  return transformed;
}

/** Fetch all breakdown data in a single multigroupby query. */
export async function fetchAllBreakdowns({
  facets, timeRange, filters = [], hostFilter = '', topN, signal,
}) {
  const { startTime, endTime, tier } = resolveTimeRange(timeRange);
  const query = buildMultiFacetQuery({
    facets, startTime, endTime, filters, hostFilter, topN,
  });
  const result = await executeDataPrimeQuery(query, { signal, tier });

  const byId = {};
  for (const row of result.results || []) {
    (byId[row.facet_id] ||= []).push(row);
  }

  const facetResults = {};
  for (const def of facets) {
    const rows = byId[def.id] || [];
    const transformed = transformBreakdownResult({ results: rows }, def.col);
    transformed.networkTime = result.networkTime;
    facetResults[def.id] = transformed;
  }
  return facetResults;
}

/** Fetch logs data for logs view. */
export async function fetchLogsData({
  filters = [], hostFilter = '', timeRange, limit, offset = 0, signal,
}) {
  const { startTime, endTime, tier } = resolveTimeRange(timeRange);
  const query = buildLogsQuery({
    filters, hostFilter, startTime, endTime, limit, offset,
  });
  const result = await executeDataPrimeQuery(query, { signal, tier });
  return transformLogsResult(result);
}

// ---------------------------------------------------------------------------
// Legacy / utility exports
// ---------------------------------------------------------------------------

/**
 * Legacy compatibility shim -- direct SQL is not supported via Coralogix.
 * @deprecated Use specific fetch functions instead.
 */
export async function executeQuery(_) {
  throw new Error(
    'Direct SQL execution not supported with Coralogix.'
    + ' Use fetchTimeSeriesData, fetchBreakdownData, or fetchLogsData.',
  );
}

/** Check if Coralogix adapter is properly configured. */
export function isCoralogixConfigured() {
  return CORALOGIX_CONFIG.validate().isValid && getToken() !== null;
}

/** Get configuration validation errors. */
export function getConfigurationErrors() {
  const errors = [...CORALOGIX_CONFIG.validate().missing];
  if (!getToken()) errors.push('Authentication token not set');
  return errors;
}
