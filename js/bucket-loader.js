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
 * IntersectionObserver setup, and placeholder replacement.
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
let observer = null;
const loadedBuckets = new Set();

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
 * Replace a placeholder <tr> with actual data rows.
 */
function replacePlaceholder(placeholder, rows, cols, pin, offsets) {
  if (!placeholder || !placeholder.parentNode) return;

  let html = '';
  for (let i = 0; i < rows.length; i += 1) {
    html += buildLogRowHtml({
      row: rows[i], columns: cols, rowIdx: i, pinned: pin, pinnedOffsets: offsets,
    });
  }

  if (html) {
    placeholder.insertAdjacentHTML('afterend', html);
  }
  placeholder.remove();
}

/**
 * Load data for a single bucket (head and optionally tail).
 */
async function loadBucket(ts, bucket, cols, pin, offsets, signal) {
  const headEl = document.getElementById(`bucket-head-${ts}`);
  if (headEl) {
    try {
      const fn = () => fetchBucketRows(ts, bucket.headCount, 0, signal);
      const rows = await bucketFetchLimiter(fn);
      if (!signal.aborted) {
        replacePlaceholder(headEl, rows, cols, pin, offsets);
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
    try {
      const fn = () => fetchBucketRows(ts, bucket.tailCount, 500, signal);
      const rows = await bucketFetchLimiter(fn);
      if (!signal.aborted) {
        replacePlaceholder(tailEl, rows, cols, pin, offsets);
      }
    } catch (err) {
      if (!isAbortError(err)) {
        // eslint-disable-next-line no-console
        console.error('Bucket tail fetch error:', err);
      }
    }
  }
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
 * Set up an IntersectionObserver for lazy bucket data loading.
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
  if (observer) observer.disconnect();
  loadedBuckets.clear();

  const { signal } = fetchController;
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const row = entry.target;
        const ts = row.id.replace('bucket-head-', '');
        if (!loadedBuckets.has(ts)) {
          loadedBuckets.add(ts);
          observer.unobserve(row);
          const bucket = bucketMap.get(ts);
          if (bucket) {
            loadBucket(ts, bucket, columns, pinned, pinnedOffsets, signal);
          }
        }
      }
    }
  }, { rootMargin: '200px 0px', threshold: 0 });

  const headRows = container.querySelectorAll('tbody tr.bucket-head');
  for (const row of headRows) {
    observer.observe(row);
  }
}

/**
 * Clean up observer and abort in-flight bucket fetches.
 */
export function teardownBucketLoader() {
  if (fetchController) {
    fetchController.abort();
    fetchController = null;
  }
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  loadedBuckets.clear();
}
