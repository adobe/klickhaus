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

export function isForceRefresh() {
  return refreshState.force;
}

export function setForceRefresh(value) {
  refreshState.force = value;
}

// Auth error event - dispatched when authentication fails
const authErrorEvent = new CustomEvent('auth-error');

export async function query(sql, { cacheTtl: initialCacheTtl = null, skipCache = false } = {}) {
  const params = new URLSearchParams();

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
  });
  const fetchEnd = performance.now();

  if (!response.ok) {
    const text = await response.text();
    // Check for authentication errors (401 or auth-related message)
    if (
      response.status === 401 ||
      text.includes('Authentication failed') ||
      text.includes('REQUIRED_PASSWORD')
    ) {
      window.dispatchEvent(authErrorEvent);
    }
    throw new Error(text);
  }

  const data = await response.json();
  // Wall clock timing from fetch call to response
  data.networkTime = fetchEnd - fetchStart;
  return data;
}
