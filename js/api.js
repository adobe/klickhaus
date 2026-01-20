// ClickHouse query helper
import { CLICKHOUSE_URL } from './config.js';
import { TIME_RANGES } from './constants.js';
import { state } from './state.js';

// Force refresh flag - set by dashboard when refresh button is clicked
export let forceRefresh = false;

export function setForceRefresh(value) {
  forceRefresh = value;
}

// Auth error event - dispatched when authentication fails
const authErrorEvent = new CustomEvent('auth-error');

// Stale response error - thrown when a response is superseded by a newer request
export class StaleResponseError extends Error {
  constructor(message = 'Response superseded by newer request') {
    super(message);
    this.name = 'StaleResponseError';
  }
}

// Request controllers by category - allows cancelling previous requests when new ones start
const controllers = new Map();

// Request sequence numbers by category - for stale response detection
const sequences = new Map();

/**
 * Cancel any pending request for the given category
 * @param {string} category - Request category (e.g., 'chart', 'logs', 'breakdown-url')
 */
export function cancelRequest(category) {
  const controller = controllers.get(category);
  if (controller) {
    controller.abort();
    controllers.delete(category);
  }
}

/**
 * Cancel all pending requests (useful for page-wide refresh)
 */
export function cancelAllRequests() {
  for (const controller of controllers.values()) {
    controller.abort();
  }
  controllers.clear();
}

export async function query(sql, { cacheTtl = null, skipCache = false, category = null } = {}) {
  const params = new URLSearchParams();

  // Skip caching entirely for simple queries like auth check
  if (!skipCache) {
    // Short TTL (1s) when refresh button is clicked to bypass cache
    if (forceRefresh) {
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

  // Set up AbortController and sequence tracking for cancellable requests
  let signal = undefined;
  let thisSeq = null;

  if (category) {
    // Cancel any previous request in this category
    cancelRequest(category);

    // Create new controller for this request
    const controller = new AbortController();
    controllers.set(category, controller);
    signal = controller.signal;

    // Increment sequence number for stale response detection
    thisSeq = (sequences.get(category) || 0) + 1;
    sequences.set(category, thisSeq);
  }

  const url = `${CLICKHOUSE_URL}?${params}`;
  const fetchStart = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(`${state.credentials.user}:${state.credentials.password}`)
    },
    body: normalizedSql + ' FORMAT JSON',
    signal
  });
  const fetchEnd = performance.now();

  // Check for stale response (another request started while we were waiting)
  if (category && thisSeq !== sequences.get(category)) {
    throw new StaleResponseError();
  }

  if (!response.ok) {
    const text = await response.text();
    // Check for authentication errors (401 or auth-related message)
    if (response.status === 401 || text.includes('Authentication failed') || text.includes('REQUIRED_PASSWORD')) {
      window.dispatchEvent(authErrorEvent);
    }
    throw new Error(text);
  }

  const data = await response.json();

  // Final stale check after parsing (in case another request started during JSON parsing)
  if (category && thisSeq !== sequences.get(category)) {
    throw new StaleResponseError();
  }

  // Wall clock timing from fetch call to response
  data._networkTime = fetchEnd - fetchStart;

  // Clean up controller on successful completion
  if (category) {
    controllers.delete(category);
  }

  return data;
}
