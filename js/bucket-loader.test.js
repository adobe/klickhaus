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
import { assert } from 'chai';
import {
  teardownBucketLoader,
  _evictBucket,
  _enforceRowBudget,
  _countDataRows,
  _replacePlaceholder,
  _cacheHead,
  _headCache,
  _loadedBuckets,
  _MAX_DOM_ROWS,
} from './bucket-loader.js';
import { LOG_COLUMN_ORDER } from './columns.js';

const COLS = LOG_COLUMN_ORDER;
const TS = '2026-01-15 00:00:00.000';
const TS2 = '2026-01-15 00:01:00.000';
const TS3 = '2026-01-15 00:02:00.000';

/**
 * Build a minimal fake row matching the column order.
 */
function fakeRow(idx) {
  const row = {};
  for (const col of COLS) {
    if (col === 'timestamp') row[col] = `2026-01-15T00:00:0${idx}.000Z`;
    else if (col === 'response.status') row[col] = 200;
    else if (col === 'response.body_size') row[col] = 1024;
    else if (col === 'request.method') row[col] = 'GET';
    else row[col] = `val-${idx}`;
  }
  return row;
}

/**
 * Create a container with a <tbody> containing a bucket-head placeholder.
 */
function createContainer(ts, numRows) {
  const container = document.createElement('div');
  const table = document.createElement('table');
  const tbody = document.createElement('tbody');
  const tr = document.createElement('tr');
  tr.id = `bucket-head-${ts}`;
  tr.className = 'bucket-row bucket-head';
  tr.style.height = `${numRows * 28}px`;
  tr.innerHTML = `<td colspan="${COLS.length}" class="bucket-placeholder">${numRows} rows</td>`;
  tbody.appendChild(tr);
  table.appendChild(tbody);
  container.appendChild(table);
  document.body.appendChild(container);
  return container;
}

/**
 * Manually insert sentinel + data rows to simulate a loaded bucket.
 */
function insertLoadedBucket(container, ts, rowCount) {
  const tbody = container.querySelector('tbody');
  // Sentinel
  const sentinel = document.createElement('tr');
  sentinel.className = 'bucket-sentinel';
  sentinel.dataset.bucket = ts;
  sentinel.style.cssText = 'height:0;padding:0;border:0;line-height:0;visibility:hidden;';
  tbody.appendChild(sentinel);
  // Data rows
  for (let i = 0; i < rowCount; i += 1) {
    const tr = document.createElement('tr');
    tr.dataset.bucket = ts;
    tr.dataset.rowIdx = String(i);
    tr.innerHTML = `<td>row ${i}</td>`;
    tbody.appendChild(tr);
  }
  _loadedBuckets.add(ts);
}

describe('bucket-loader virtualization', () => {
  let container;

  afterEach(() => {
    teardownBucketLoader();
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    container = null;
  });

  describe('countDataRows', () => {
    it('counts rows with data-bucket attribute', () => {
      container = createContainer(TS, 10);
      insertLoadedBucket(container, TS, 5);
      const count = _countDataRows(container);
      // 5 data rows + 1 sentinel = 6 tr[data-bucket]
      assert.strictEqual(count, 6);
    });

    it('returns 0 for empty container', () => {
      container = createContainer(TS, 0);
      assert.strictEqual(_countDataRows(container), 0);
    });
  });

  describe('replacePlaceholder', () => {
    it('inserts sentinel before data rows', () => {
      container = createContainer(TS, 3);
      const placeholder = document.getElementById(`bucket-head-${TS}`);
      const rows = [fakeRow(0), fakeRow(1), fakeRow(2)];

      _replacePlaceholder(placeholder, rows, COLS, [], {}, TS);

      const sentinel = container.querySelector('tr.bucket-sentinel');
      assert.ok(sentinel, 'sentinel should exist');
      assert.strictEqual(sentinel.dataset.bucket, TS);
    });

    it('tags each data row with data-bucket', () => {
      container = createContainer(TS, 2);
      const placeholder = document.getElementById(`bucket-head-${TS}`);
      const rows = [fakeRow(0), fakeRow(1)];

      _replacePlaceholder(placeholder, rows, COLS, [], {}, TS);

      const dataRows = container.querySelectorAll('tr[data-bucket]');
      // 1 sentinel + 2 data rows
      assert.strictEqual(dataRows.length, 3);
    });

    it('removes the placeholder element', () => {
      container = createContainer(TS, 1);
      const placeholder = document.getElementById(`bucket-head-${TS}`);
      const rows = [fakeRow(0)];

      _replacePlaceholder(placeholder, rows, COLS, [], {}, TS);

      assert.isNull(document.getElementById(`bucket-head-${TS}`));
    });

    it('handles null placeholder gracefully', () => {
      container = createContainer(TS, 0);
      // Should not throw
      _replacePlaceholder(null, [fakeRow(0)], COLS, [], {}, TS);
    });

    it('handles empty rows', () => {
      container = createContainer(TS, 0);
      const placeholder = document.getElementById(`bucket-head-${TS}`);

      _replacePlaceholder(placeholder, [], COLS, [], {}, TS);

      // Sentinel should still be inserted
      const sentinel = container.querySelector('tr.bucket-sentinel');
      assert.ok(sentinel, 'sentinel should exist even with no data rows');
    });
  });

  describe('evictBucket', () => {
    it('replaces sentinel + data rows with a placeholder', () => {
      container = createContainer(TS, 10);
      // Remove the initial placeholder first
      const initial = document.getElementById(`bucket-head-${TS}`);
      if (initial) initial.remove();

      insertLoadedBucket(container, TS, 5);

      _evictBucket(TS, container, COLS);

      // Sentinel should be gone
      assert.isNull(container.querySelector('tr.bucket-sentinel'));
      // Data rows should be gone
      assert.strictEqual(container.querySelectorAll('tr[data-bucket]').length, 0);
      // New placeholder should exist
      const placeholder = document.getElementById(`bucket-head-${TS}`);
      assert.ok(placeholder, 'placeholder should be recreated');
      assert.include(placeholder.className, 'bucket-head');
      assert.include(placeholder.textContent, 'evicted');
    });

    it('removes ts from loadedBuckets', () => {
      container = createContainer(TS, 5);
      const initial = document.getElementById(`bucket-head-${TS}`);
      if (initial) initial.remove();

      insertLoadedBucket(container, TS, 3);
      assert.isTrue(_loadedBuckets.has(TS));

      _evictBucket(TS, container, COLS);
      assert.isFalse(_loadedBuckets.has(TS));
    });

    it('does nothing if sentinel not found', () => {
      container = createContainer(TS, 5);
      // No sentinel inserted, just placeholder
      _evictBucket(TS, container, COLS);
      // Should not crash, placeholder should still be there
      assert.ok(document.getElementById(`bucket-head-${TS}`));
    });

    it('placeholder height matches evicted row count', () => {
      container = createContainer(TS, 10);
      const initial = document.getElementById(`bucket-head-${TS}`);
      if (initial) initial.remove();

      insertLoadedBucket(container, TS, 7);

      _evictBucket(TS, container, COLS);

      const placeholder = document.getElementById(`bucket-head-${TS}`);
      assert.strictEqual(placeholder.style.height, `${7 * 28}px`);
    });
  });

  describe('enforceRowBudget', () => {
    it('does not evict when under budget', () => {
      container = createContainer(TS, 10);
      const initial = document.getElementById(`bucket-head-${TS}`);
      if (initial) initial.remove();

      insertLoadedBucket(container, TS, 5);

      _enforceRowBudget(container, COLS);

      // Should still be loaded
      assert.isTrue(_loadedBuckets.has(TS));
    });

    it('evicts farthest bucket when over budget', () => {
      container = document.createElement('div');
      const table = document.createElement('table');
      const tbody = document.createElement('tbody');
      table.appendChild(tbody);
      container.appendChild(table);
      document.body.appendChild(container);

      // Insert three loaded buckets, each with MAX_DOM_ROWS/2 rows
      const halfBudget = Math.ceil(_MAX_DOM_ROWS / 2);
      insertLoadedBucket(container, TS, halfBudget);
      insertLoadedBucket(container, TS2, halfBudget);
      insertLoadedBucket(container, TS3, halfBudget);

      _enforceRowBudget(container, COLS);

      // At least one bucket should have been evicted
      const remaining = _loadedBuckets.size;
      assert.isBelow(remaining, 3, 'at least one bucket should be evicted');
    });
  });

  describe('headCache (LRU)', () => {
    afterEach(() => {
      _headCache.clear();
    });

    it('stores and retrieves rows', () => {
      const rows = [fakeRow(0)];
      _cacheHead(TS, rows);
      assert.strictEqual(_headCache.get(TS), rows);
    });

    it('evicts oldest entry when over capacity', () => {
      // Fill cache to capacity (20) + 1
      for (let i = 0; i < 21; i += 1) {
        const ts = `2026-01-15 00:${String(i).padStart(2, '0')}:00.000`;
        _cacheHead(ts, [fakeRow(i)]);
      }
      assert.strictEqual(_headCache.size, 20);
      // First entry should be evicted
      assert.isFalse(_headCache.has('2026-01-15 00:00:00.000'));
      // Last entry should exist
      assert.isTrue(_headCache.has('2026-01-15 00:20:00.000'));
    });

    it('re-accessing entry moves it to end (LRU refresh)', () => {
      _cacheHead(TS, [fakeRow(0)]);
      _cacheHead(TS2, [fakeRow(1)]);
      // Re-cache TS to move it to end
      _cacheHead(TS, [fakeRow(0)]);

      const keys = Array.from(_headCache.keys());
      assert.strictEqual(keys[keys.length - 1], TS, 'TS should be at end after re-access');
    });
  });

  describe('teardownBucketLoader', () => {
    it('clears loadedBuckets', () => {
      _loadedBuckets.add(TS);
      _loadedBuckets.add(TS2);
      teardownBucketLoader();
      assert.strictEqual(_loadedBuckets.size, 0);
    });

    it('clears headCache', () => {
      _cacheHead(TS, [fakeRow(0)]);
      teardownBucketLoader();
      assert.strictEqual(_headCache.size, 0);
    });
  });

  describe('MAX_DOM_ROWS constant', () => {
    it('is set to 2000', () => {
      assert.strictEqual(_MAX_DOM_ROWS, 2000);
    });
  });
});
