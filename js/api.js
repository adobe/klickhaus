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
import { CLICKHOUSE_URL } from './config.js';
import { TIME_RANGES } from './constants.js';
import { state } from './state.js';

// Force refresh state - set by dashboard when refresh button is clicked
const refreshState = { force: false };
const DEFAULT_MAX_EXECUTION_TIME = 10;

export function isForceRefresh() {
  return refreshState.force;
}

export function setForceRefresh(value) {
  refreshState.force = value;
}

// Auth error event - dispatched when authentication fails
const authErrorEvent = new CustomEvent('auth-error');

const CATEGORY_LABELS = {
  permissions: 'Permissions',
  memory: 'Out of memory',
  syntax: 'Query syntax',
  timeout: 'Query timeout',
  schema: 'Schema',
  resource: 'Resource limits',
  network: 'Network error',
  cancelled: 'Cancelled',
  unknown: 'Query failed',
};

export function summarizeErrorText(text) {
  if (!text) return 'Unknown error';
  const trimmed = String(text).trim();
  const firstLine = trimmed.split('\n').map((line) => line.trim()).find(Boolean) || trimmed;
  const normalized = firstLine.replace(/\s+/g, ' ').trim();
  if (normalized.length > 200) {
    return `${normalized.slice(0, 197)}...`;
  }
  return normalized;
}

export function extractErrorType(text) {
  const matches = [...String(text).matchAll(/\(([A-Z0-9_]+)\)/g)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1];
}

const PERMISSION_TYPES = new Set(['ACCESS_DENIED', 'NOT_ENOUGH_PRIVILEGES']);
const SCHEMA_TYPES = new Set([
  'UNKNOWN_TABLE',
  'UNKNOWN_IDENTIFIER',
  'UNKNOWN_COLUMN',
  'UNKNOWN_FUNCTION',
]);
const RESOURCE_TYPES = new Set([
  'TOO_MANY_PARTS',
  'TOO_MANY_SIMULTANEOUS_QUERIES',
  'TOO_MANY_BYTES',
  'QUERY_WAS_CANCELLED',
]);

const PERMISSION_TEXT = [
  'authentication failed',
  'required_password',
  'not enough privileges',
  'access denied',
];
const SCHEMA_TEXT = ['unknown table', 'unknown identifier'];
const NETWORK_TEXT = ['failed to fetch', 'networkerror', 'network error'];

function matchesAny(text, list) {
  return list.some((item) => text.includes(item));
}

export function classifyCategory(text, status, type) {
  const lower = String(text).toLowerCase();
  const isPermissions = [
    status === 401,
    status === 403,
    PERMISSION_TYPES.has(type),
    matchesAny(lower, PERMISSION_TEXT),
  ].some(Boolean);
  if (isPermissions) return 'permissions';

  if (status === 408 || status === 504 || status === 524) return 'timeout';
  if (type === 'MEMORY_LIMIT_EXCEEDED' || lower.includes('memory limit')) return 'memory';
  if (type === 'SYNTAX_ERROR' || lower.includes('syntax error')) return 'syntax';
  if (type === 'TIMEOUT_EXCEEDED' || lower.includes('timeout')) return 'timeout';

  const isSchema = [
    SCHEMA_TYPES.has(type),
    matchesAny(lower, SCHEMA_TEXT),
  ].some(Boolean);
  if (isSchema) return 'schema';

  if (RESOURCE_TYPES.has(type)) return 'resource';
  if (matchesAny(lower, NETWORK_TEXT)) return 'network';
  return 'unknown';
}

export class QueryError extends Error {
  constructor(message, {
    status = null,
    code = null,
    type = null,
    category = 'unknown',
    detail = null,
  } = {}) {
    super(message);
    this.name = 'QueryError';
    this.status = status;
    this.code = code;
    this.type = type;
    this.category = category;
    this.detail = detail;
    this.isQueryError = true;
  }
}

export function parseQueryError(text, status) {
  const codeMatch = String(text).match(/Code:\s*(\d+)/i);
  const code = codeMatch ? parseInt(codeMatch[1], 10) : null;
  const type = extractErrorType(text);
  const category = classifyCategory(text, status, type);
  const message = summarizeErrorText(text);
  return {
    status,
    code,
    type,
    category,
    message,
    detail: message,
  };
}

export function isAbortError(err) {
  return err?.name === 'AbortError';
}

export function getQueryErrorDetails(err) {
  if (!err) {
    return {
      label: CATEGORY_LABELS.unknown,
      category: 'unknown',
      message: 'Unknown error',
    };
  }

  if (isAbortError(err)) {
    return {
      label: CATEGORY_LABELS.cancelled,
      category: 'cancelled',
      message: 'Request cancelled',
      isAbort: true,
    };
  }

  if (err.isQueryError || err.name === 'QueryError') {
    const label = CATEGORY_LABELS[err.category] || CATEGORY_LABELS.unknown;
    return {
      label,
      category: err.category,
      message: err.message || 'Query failed',
      detail: err.detail || err.message || 'Query failed',
      code: err.code,
      type: err.type,
      status: err.status,
    };
  }

  const message = summarizeErrorText(err.message || String(err));
  const category = classifyCategory(message, null, null);
  return {
    label: CATEGORY_LABELS[category] || CATEGORY_LABELS.unknown,
    category,
    message,
  };
}

export async function query(
  sql,
  {
    cacheTtl: initialCacheTtl = null,
    skipCache = false,
    signal,
    maxExecutionTime = DEFAULT_MAX_EXECUTION_TIME,
  } = {},
) {
  const params = new URLSearchParams();
  const executionTime = Number.isFinite(maxExecutionTime)
    ? maxExecutionTime
    : DEFAULT_MAX_EXECUTION_TIME;
  params.set('max_execution_time', String(executionTime));
  params.set('timeout_before_checking_execution_speed', '0');

  // Skip caching entirely for simple queries like auth check
  if (!skipCache) {
    // Determine cache TTL
    let cacheTtl = initialCacheTtl;
    // Short TTL (1s) when refresh button is clicked to bypass cache
    if (isForceRefresh()) {
      cacheTtl = 1;
    } else if (cacheTtl === null) {
      // Longer TTLs since we use fixed timestamps for deterministic queries
      // Cache is effectively invalidated by timestamp change on refresh/page load
      cacheTtl = TIME_RANGES[state.timeRange]?.cacheTtl || 300;
    }
    params.set('use_query_cache', '1');
    params.set('query_cache_ttl', cacheTtl.toString());
    params.set('query_cache_nondeterministic_function_handling', 'save');
  }

  // Normalize SQL whitespace for consistent cache keys
  const normalizedSql = sql.replace(/\s+/g, ' ').trim();

  const url = `${CLICKHOUSE_URL}?${params}`;
  const fetchStart = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${state.credentials.user}:${state.credentials.password}`)}`,
    },
    body: `${normalizedSql} FORMAT JSON`,
    signal,
  });
  const fetchEnd = performance.now();

  if (!response.ok) {
    const text = await response.text();
    // Check for authentication errors (401 or auth-related message)
    if (response.status === 401 || text.includes('Authentication failed') || text.includes('REQUIRED_PASSWORD')) {
      window.dispatchEvent(authErrorEvent);
    }
    const parsed = parseQueryError(text, response.status);
    throw new QueryError(parsed.message, parsed);
  }

  const data = await response.json();
  // Wall clock timing from fetch call to response
  data.networkTime = fetchEnd - fetchStart;
  return data;
}
