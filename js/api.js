// ClickHouse query helper
import { CLICKHOUSE_URL } from './config.js';
import { state } from './state.js';

// Force refresh flag - set by dashboard when refresh button is clicked
export let forceRefresh = false;

export function setForceRefresh(value) {
  forceRefresh = value;
}

// Auth error event - dispatched when authentication fails
const authErrorEvent = new CustomEvent('auth-error');

export async function query(sql, { cacheTtl = null, skipCache = false } = {}) {
  const params = new URLSearchParams();

  // Skip caching entirely for simple queries like auth check
  if (!skipCache) {
    // Short TTL (1s) when refresh button is clicked to bypass cache
    if (forceRefresh) {
      cacheTtl = 1;
    } else if (cacheTtl === null) {
      // Longer TTLs since we use fixed timestamps for deterministic queries
      // Cache is effectively invalidated by timestamp change on refresh/page load
      const ttls = {
        '15m': 60,     // 1 minute for last 15 minutes
        '1h': 300,     // 5 minutes for last hour
        '12h': 600,    // 10 minutes for last 12 hours
        '24h': 900,    // 15 minutes for last 24 hours
        '7d': 1800     // 30 minutes for last 7 days
      };
      cacheTtl = ttls[state.timeRange] || 300;
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
      'Authorization': 'Basic ' + btoa(`${state.credentials.user}:${state.credentials.password}`)
    },
    body: normalizedSql + ' FORMAT JSON'
  });
  const fetchEnd = performance.now();

  if (!response.ok) {
    const text = await response.text();
    // Check for authentication errors (401 or auth-related message)
    if (response.status === 401 || text.includes('Authentication failed') || text.includes('REQUIRED_PASSWORD')) {
      window.dispatchEvent(authErrorEvent);
    }
    throw new Error(text);
  }

  const data = await response.json();
  // Wall clock timing from fetch call to response
  data._networkTime = fetchEnd - fetchStart;
  return data;
}
