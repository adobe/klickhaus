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
import { computeBucketHeights, renderBucketTable } from './logs.js';

function makeChartData(count, baseCnt = 10) {
  return Array.from({ length: count }, (_, i) => ({
    t: `2026-01-15 ${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000`,
    cnt_ok: String(baseCnt),
    cnt_4xx: '1',
    cnt_5xx: '0',
  }));
}

describe('computeBucketHeights', () => {
  it('returns empty for null/empty chart data', () => {
    assert.deepEqual(computeBucketHeights(null), { buckets: [], totalHeight: 0 });
    assert.deepEqual(computeBucketHeights([]), { buckets: [], totalHeight: 0 });
  });

  it('computes height proportional to row count', () => {
    const data = [
      {
        t: '2026-01-15 00:00:00.000', cnt_ok: '10', cnt_4xx: '2', cnt_5xx: '1',
      },
      {
        t: '2026-01-15 00:01:00.000', cnt_ok: '5', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    const { buckets } = computeBucketHeights(data);
    assert.strictEqual(buckets.length, 2);
    assert.strictEqual(buckets[0].count, 13);
    assert.strictEqual(buckets[0].height, 13 * 28);
    assert.strictEqual(buckets[1].count, 5);
    assert.strictEqual(buckets[1].height, 5 * 28);
  });

  it('enforces minimum height of 28px for empty buckets', () => {
    const data = [
      {
        t: '2026-01-15 00:00:00.000', cnt_ok: '0', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    const { buckets } = computeBucketHeights(data);
    assert.strictEqual(buckets[0].count, 0);
    assert.strictEqual(buckets[0].height, 28); // min 1 * ROW_HEIGHT
  });

  it('scales heights when total exceeds 10M pixels', () => {
    // Create buckets that would exceed 10M: 100 buckets * 5000 rows * 28px = 14M
    const data = Array.from({ length: 100 }, (_, i) => ({
      t: `2026-01-15 ${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000`,
      cnt_ok: '5000',
      cnt_4xx: '0',
      cnt_5xx: '0',
    }));
    const { buckets, totalHeight } = computeBucketHeights(data);
    assert.ok(totalHeight <= 10_000_000 + 100 * 28, 'total height should be capped near 10M');
    // All buckets should still have at least ROW_HEIGHT
    for (const b of buckets) {
      assert.ok(b.height >= 28, 'each bucket should have at least 28px height');
    }
  });
});

describe('renderBucketTable', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container.parentNode) container.parentNode.removeChild(container);
  });

  it('renders empty message for null chart data', () => {
    renderBucketTable(container, null);
    assert.include(container.textContent, 'No chart data');
  });

  it('renders correct number of bucket rows', () => {
    const data = makeChartData(5);
    renderBucketTable(container, data);
    const rows = container.querySelectorAll('tbody tr.bucket-row');
    assert.strictEqual(rows.length, 5);
  });

  it('renders rows in newest-first order', () => {
    const data = [
      {
        t: '2026-01-15 00:00:00.000', cnt_ok: '10', cnt_4xx: '0', cnt_5xx: '0',
      },
      {
        t: '2026-01-15 00:01:00.000', cnt_ok: '20', cnt_4xx: '0', cnt_5xx: '0',
      },
      {
        t: '2026-01-15 00:02:00.000', cnt_ok: '30', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    renderBucketTable(container, data);
    const rows = container.querySelectorAll('tbody tr.bucket-row');
    // First row should be the newest (last in chart data)
    assert.strictEqual(rows[0].id, 'bucket-2026-01-15 00:02:00.000');
    assert.strictEqual(rows[1].id, 'bucket-2026-01-15 00:01:00.000');
    assert.strictEqual(rows[2].id, 'bucket-2026-01-15 00:00:00.000');
  });

  it('each row has correct id attribute', () => {
    const data = [
      {
        t: '2026-01-15 12:30:00.000', cnt_ok: '5', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    renderBucketTable(container, data);
    const row = container.querySelector('tbody tr.bucket-row');
    assert.strictEqual(row.id, 'bucket-2026-01-15 12:30:00.000');
  });

  it('each row has proportional height', () => {
    const data = [
      {
        t: '2026-01-15 00:00:00.000', cnt_ok: '10', cnt_4xx: '0', cnt_5xx: '0',
      },
      {
        t: '2026-01-15 00:01:00.000', cnt_ok: '20', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    renderBucketTable(container, data);
    const rows = container.querySelectorAll('tbody tr.bucket-row');
    // Newest first: row 0 = 20 rows, row 1 = 10 rows
    assert.strictEqual(rows[0].style.height, `${20 * 28}px`);
    assert.strictEqual(rows[1].style.height, `${10 * 28}px`);
  });

  it('displays row count in placeholder text', () => {
    const data = [
      {
        t: '2026-01-15 00:00:00.000', cnt_ok: '100', cnt_4xx: '5', cnt_5xx: '2',
      },
    ];
    renderBucketTable(container, data);
    const td = container.querySelector('.bucket-placeholder');
    assert.include(td.textContent, '107');
    assert.include(td.textContent, 'rows');
  });

  it('uses singular "row" for count of 1', () => {
    const data = [
      {
        t: '2026-01-15 00:00:00.000', cnt_ok: '1', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    renderBucketTable(container, data);
    const td = container.querySelector('.bucket-placeholder');
    assert.strictEqual(td.textContent, '1 row');
  });

  it('renders table with sticky header', () => {
    const data = makeChartData(3);
    renderBucketTable(container, data);
    const thead = container.querySelector('thead');
    assert.ok(thead, 'table should have thead');
    const th = thead.querySelector('th');
    assert.ok(th, 'thead should have th');
  });

  it('renders table with logs-table class', () => {
    const data = makeChartData(3);
    renderBucketTable(container, data);
    const table = container.querySelector('table.logs-table');
    assert.ok(table, 'table should have logs-table class');
  });
});
