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
 * Bucket data loader — extracted from logs.js to stay within the
 * max-lines lint limit. Handles per-bucket on-demand data fetching,
 * IntersectionObserver setup, placeholder replacement, and DOM
 * virtualization with a 2000-row cap.
 */

import { DATABASE } from './config.js';
import { state } from './state.js';
import { query, isAbortError } from './api.js';
import { getHostFilter, getTable, getTimeBucketStep } from './time.js';
import { getFacetFilters } from './breakdowns/index.js';
import { buildLogColumnsSql, LOG_COLUMN_ORDER } from './columns.js';
import { loadSql } from './sql-loader.js';
import {
  buildLogRowHtml, buildLogTableHeaderHtml,
} from './templates/logs-table.js';
import { createLimiter } from './concurrency-limiter.js';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const MAX_DOM_ROWS = 2000;
const HEAD_CACHE_SIZE = 20;
const ROW_HEIGHT = 28;

/**
 * Parse a ClickHouse INTERVAL string to milliseconds.
 * @param {string} interval
 * @returns {number}
 */
function parseIntervalToMs(interval) {
  const match = interval.match(/INTERVAL\s+(\d+)\s+(\w+)/i);
  if (!match) return MINUTE_MS;
  const amount = parseInt(match[1], 10);
  const unit = match[2].toUpperCase().replace(/S$/, '');
  const multipliers = {
    SECOND: SECOND_MS,
    MINUTE: MINUTE_MS,
    HOUR: HOUR_MS,
    DAY: DAY_MS,
  };
  return amount * (multipliers[unit] || MINUTE_MS);
}

/**
 * Format a Date as 'YYYY-MM-DD HH:MM:SS.mmm' in UTC.
 * @param {Date} date
 * @returns {string}
 */
function formatTimestampUTC(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${ms}`;
}

// Concurrency limiter and abort state
const bucketFetchLimiter = createLimiter(4);
// eslint-disable-next-line prefer-const -- reassigned in setup/teardown
let fetchController = null;
// eslint-disable-next-line prefer-const -- reassigned in setup/teardown
let loadObserver = null;
// eslint-disable-next-line prefer-const -- reassigned in setup/teardown
let evictionObserver = null;
const loadedBuckets = new Set();

// Per-bucket AbortControllers for cancelling in-flight fetches
const bucketControllers = new Map();

// LRU head-data cache (ts → rows)
const headCache = new Map();

// Stored container reference for eviction observer sentinel wiring
// eslint-disable-next-line prefer-const -- reassigned in setup/teardown
let storedContainer = null;

/**
 * Store rows in the LRU head cache.
 */
function cacheHead(ts, rows) {
  headCache.delete(ts);
  headCache.set(ts, rows);
  if (headCache.size > HEAD_CACHE_SIZE) {
    const oldest = headCache.keys().next().value;
    headCache.delete(oldest);
  }
}

/**
 * Fetch log rows for a specific bucket time window.
 * @param {string} bucketTs - Bucket start timestamp
 * @param {number} limit - Max rows to fetch
 * @param {number} offset - Row offset within the bucket
 * @param {AbortSignal} signal - Abort signal
 * @returns {Promise<Object[]>}
 */
async function fetchBucketRows(bucketTs, limit, offset, signal) {
  const stepMs = parseIntervalToMs(getTimeBucketStep());
  const start = new Date(`${bucketTs.replace(' ', 'T')}Z`);
  const end = new Date(start.getTime() + stepMs);

  const startStr = formatTimestampUTC(start);
  const endStr = formatTimestampUTC(end);

  const timeFilter = `timestamp >= toDateTime64('${startStr}', 3)`
    + ` AND timestamp < toDateTime64('${endStr}', 3)`;

  const sql = await loadSql('logs', {
    database: DATABASE,
    table: getTable(),
    columns: buildLogColumnsSql(state.pinnedColumns),
    timeFilter,
    hostFilter: getHostFilter(),
    facetFilters: getFacetFilters(),
    additionalWhereClause: state.additionalWhereClause,
    pageSize: String(limit),
  });

  const finalSql = offset > 0
    ? `${sql.trimEnd().replace(/\n$/, '')} OFFSET ${offset}\n`
    : sql;

  const result = await query(finalSql, { signal });
  return result.data;
}

/**
 * Count data rows currently in the DOM.
 */
function countDataRows(container) {
  return container.querySelectorAll('tr[data-bucket]').length;
}

/**
 * Evict a loaded bucket back to a placeholder.
 */
function evictBucket(ts, container, cols) {
  // Abort any in-flight fetch
  const ctrl = bucketControllers.get(ts);
  if (ctrl) {
    ctrl.abort();
    bucketControllers.delete(ts);
  }

  // Find sentinel
  const sentinel = container.querySelector(`tr.bucket-sentinel[data-bucket="${ts}"]`);
  if (!sentinel) return;

  // Stop observing sentinel before removal
  if (evictionObserver) evictionObserver.unobserve(sentinel);

  // Collect data rows following the sentinel
  const rows = [];
  let next = sentinel.nextElementSibling;
  while (next && next.dataset.bucket === ts) {
    rows.push(next);
    next = next.nextElementSibling;
  }

  // Calculate replacement height
  const totalHeight = rows.length * ROW_HEIGHT;
  const numColumns = cols.length;

  // Create placeholder
  const placeholder = document.createElement('tr');
  placeholder.id = `bucket-head-${ts}`;
  placeholder.className = 'bucket-row bucket-head';
  placeholder.style.height = `${totalHeight}px`;
  // eslint-disable-next-line no-irregular-whitespace
  placeholder.innerHTML = `<td colspan="${numColumns}" class="bucket-placeholder">${rows.length.toLocaleString()} rows (evicted)</td>`;

  // Replace sentinel with placeholder, remove data rows
  sentinel.parentNode.insertBefore(placeholder, sentinel);
  sentinel.remove();
  for (const r of rows) r.remove();

  // Remove from loaded set
  loadedBuckets.delete(ts);

  // Re-observe with load observer
  if (loadObserver) loadObserver.observe(placeholder);
}

/**
 * Enforce the MAX_DOM_ROWS budget by evicting the farthest bucket.
 */
function enforceRowBudget(container, cols) {
  const viewportCenter = window.innerHeight / 2;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const currentCount = countDataRows(container);
    if (currentCount <= MAX_DOM_ROWS) break;

    // Find farthest loaded bucket from viewport center
    let farthestTs = null;
    let farthestDist = -1;

    for (const ts of loadedBuckets) {
      const sentinel = container.querySelector(
        `tr.bucket-sentinel[data-bucket="${ts}"]`,
      );
      if (sentinel) {
        const rect = sentinel.getBoundingClientRect();
        const dist = Math.abs(rect.top - viewportCenter);
        if (dist > farthestDist) {
          farthestDist = dist;
          farthestTs = ts;
        }
      }
    }

    if (!farthestTs) break;
    evictBucket(farthestTs, container, cols);
  }
}

/**
 * Replace a placeholder <tr> with a sentinel and actual data rows.
 */
function replacePlaceholder(placeholder, rows, cols, pin, offsets, ts) {
  if (!placeholder || !placeholder.parentNode) return;

  // Build sentinel + data rows HTML
  let html = `<tr class="bucket-sentinel" data-bucket="${ts}" `
    + 'style="height:0;padding:0;border:0;line-height:0;visibility:hidden;"></tr>';

  for (let i = 0; i < rows.length; i += 1) {
    const rowHtml = buildLogRowHtml({
      row: rows[i], columns: cols, rowIdx: i, pinned: pin, pinnedOffsets: offsets,
    });
    // Inject data-bucket attribute into the <tr> tag
    html += rowHtml.replace('<tr ', `<tr data-bucket="${ts}" `);
  }

  if (html) {
    placeholder.insertAdjacentHTML('afterend', html);
  }
  placeholder.remove();

  // Observe the new sentinel with the eviction observer
  if (evictionObserver && storedContainer) {
    const sentinel = storedContainer.querySelector(
      `tr.bucket-sentinel[data-bucket="${ts}"]`,
    );
    if (sentinel) evictionObserver.observe(sentinel);
  }
}

/**
 * Create a per-bucket AbortController and return its signal.
 * Also listens to the global signal so navigation abort cancels everything.
 */
function createBucketSignal(ts, globalSignal) {
  const controller = new AbortController();
  bucketControllers.set(ts, controller);

  // If the global signal aborts, abort the per-bucket one too
  if (globalSignal) {
    if (globalSignal.aborted) {
      controller.abort();
    } else {
      globalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  return controller.signal;
}

/**
 * Load data for a single bucket (head and optionally tail).
 */
async function loadBucket(ts, bucket, cols, pin, offsets, globalSignal, container) {
  const signal = createBucketSignal(ts, globalSignal);

  const headEl = document.getElementById(`bucket-head-${ts}`);
  if (headEl) {
    try {
      let rows;
      if (headCache.has(ts)) {
        rows = headCache.get(ts);
      } else {
        const fn = () => fetchBucketRows(ts, bucket.headCount, 0, signal);
        rows = await bucketFetchLimiter(fn);
        if (!signal.aborted) cacheHead(ts, rows);
      }
      if (!signal.aborted) {
        replacePlaceholder(headEl, rows, cols, pin, offsets, ts);
        enforceRowBudget(container, cols);
      }
    } catch (err) {
      if (!isAbortError(err)) {
        // eslint-disable-next-line no-console
        console.error('Bucket head fetch error:', err);
      }
    }
  }

  const tailEl = document.getElementById(`bucket-tail-${ts}`);
  if (tailEl && bucket.tailCount > 0) {
    // Budget-awareness: check remaining room before tail fetch
    const currentRows = countDataRows(container);
    const budget = MAX_DOM_ROWS - currentRows;
    if (budget <= 0) return;
    const effectiveTailLimit = Math.min(bucket.tailCount, budget);

    try {
      const fn = () => fetchBucketRows(ts, effectiveTailLimit, 500, signal);
      const rows = await bucketFetchLimiter(fn);
      if (!signal.aborted) {
        replacePlaceholder(tailEl, rows, cols, pin, offsets, ts);
        enforceRowBudget(container, cols);
      }
    } catch (err) {
      if (!isAbortError(err)) {
        // eslint-disable-next-line no-console
        console.error('Bucket tail fetch error:', err);
      }
    }
  }

  // Clean up per-bucket controller after completion
  bucketControllers.delete(ts);
}

/**
 * Build the <thead> header HTML using real log column definitions.
 * @returns {{ headerHtml: string, columns: string[], numColumns: number }}
 */
export function buildBucketHeader() {
  const columns = LOG_COLUMN_ORDER;
  const pinned = state.pinnedColumns;
  const pinnedOffsets = {};
  const headerHtml = buildLogTableHeaderHtml(columns, pinned, pinnedOffsets);
  return {
    headerHtml, columns, numColumns: columns.length, pinned, pinnedOffsets,
  };
}

/**
 * Set up IntersectionObservers for lazy bucket data loading and eviction.
 * @param {HTMLElement} container - Scroll container with bucket rows
 * @param {Map<string, Object>} bucketMap - timestamp → bucket metadata
 * @param {string[]} columns
 * @param {string[]} pinned
 * @param {Record<string, number>} pinnedOffsets
 */
export function setupBucketObserver(container, bucketMap, columns, pinned, pinnedOffsets) {
  // Abort previous fetches
  if (fetchController) fetchController.abort();
  fetchController = new AbortController();
  if (loadObserver) loadObserver.disconnect();
  if (evictionObserver) evictionObserver.disconnect();
  loadedBuckets.clear();
  bucketControllers.forEach((c) => c.abort());
  bucketControllers.clear();
  headCache.clear();

  // Store container reference for eviction observer sentinel wiring
  storedContainer = container;

  const { signal } = fetchController;

  // Load observer: triggers data fetch when placeholder enters viewport
  loadObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const row = entry.target;
        const ts = row.id.replace('bucket-head-', '');
        if (!loadedBuckets.has(ts)) {
          loadedBuckets.add(ts);
          loadObserver.unobserve(row);
          const bucket = bucketMap.get(ts);
          if (bucket) {
            loadBucket(ts, bucket, columns, pinned, pinnedOffsets, signal, container);
          }
        }
      }
    }
  }, { rootMargin: '200px 0px', threshold: 0 });

  // Eviction observer: evicts buckets that scroll far out of view
  evictionObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) {
        const sentinel = entry.target;
        const ts = sentinel.dataset.bucket;
        if (ts && loadedBuckets.has(ts)) {
          evictBucket(ts, container, columns);
        }
      }
    }
  }, { rootMargin: '800px 0px', threshold: 0 });

  const headRows = container.querySelectorAll('tbody tr.bucket-head');
  for (const row of headRows) {
    loadObserver.observe(row);
  }
}

/**
 * Clean up observers and abort in-flight bucket fetches.
 */
export function teardownBucketLoader() {
  // Abort all per-bucket controllers
  bucketControllers.forEach((c) => c.abort());
  bucketControllers.clear();

  // Abort global controller
  if (fetchController) {
    fetchController.abort();
    fetchController = null;
  }

  // Disconnect both observers
  if (loadObserver) {
    loadObserver.disconnect();
    loadObserver = null;
  }
  if (evictionObserver) {
    evictionObserver.disconnect();
    evictionObserver = null;
  }

  loadedBuckets.clear();
  headCache.clear();

  // Clear stored container reference
  storedContainer = null;
}

// Exported for testing only
export {
  evictBucket as _evictBucket,
  enforceRowBudget as _enforceRowBudget,
  countDataRows as _countDataRows,
  replacePlaceholder as _replacePlaceholder,
  cacheHead as _cacheHead,
  headCache as _headCache,
  loadedBuckets as _loadedBuckets,
  MAX_DOM_ROWS as _MAX_DOM_ROWS,
};
