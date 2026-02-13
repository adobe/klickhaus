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
import { LOG_COLUMN_ORDER } from './columns.js';

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

  it('computes headHeight proportional to row count for small buckets', () => {
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
    assert.strictEqual(buckets[0].headHeight, 13 * 28);
    assert.strictEqual(buckets[0].tailHeight, 0);
    assert.strictEqual(buckets[1].count, 5);
    assert.strictEqual(buckets[1].headHeight, 5 * 28);
    assert.strictEqual(buckets[1].tailHeight, 0);
  });

  it('enforces minimum headHeight of 28px for empty buckets', () => {
    const data = [
      {
        t: '2026-01-15 00:00:00.000', cnt_ok: '0', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    const { buckets } = computeBucketHeights(data);
    assert.strictEqual(buckets[0].count, 0);
    assert.strictEqual(buckets[0].headHeight, 28); // min 1 * ROW_HEIGHT
    assert.strictEqual(buckets[0].tailHeight, 0);
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
    assert.ok(totalHeight <= 10_000_000 + 200 * 28, 'total height should be capped near 10M');
    // All buckets should still have at least ROW_HEIGHT for head
    for (const b of buckets) {
      assert.ok(b.headHeight >= 28, 'each bucket head should have at least 28px height');
    }
  });

  it('bucket with count <= 500 has headCount = count and tailCount = 0', () => {
    const data = [
      {
        t: '2026-01-15 00:00:00.000', cnt_ok: '200', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    const { buckets } = computeBucketHeights(data);
    assert.strictEqual(buckets[0].headCount, 200);
    assert.strictEqual(buckets[0].tailCount, 0);
    assert.strictEqual(buckets[0].headHeight, 200 * 28);
    assert.strictEqual(buckets[0].tailHeight, 0);
  });

  it('bucket with count > 500 has headCount = 500 and tailCount = count - 500', () => {
    const data = [
      {
        t: '2026-01-15 00:00:00.000', cnt_ok: '1000', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    const { buckets } = computeBucketHeights(data);
    assert.strictEqual(buckets[0].headCount, 500);
    assert.strictEqual(buckets[0].tailCount, 500);
    assert.strictEqual(buckets[0].headHeight, 500 * 28);
    assert.strictEqual(buckets[0].tailHeight, 500 * 28);
  });

  it('head + tail height equals total bucket height', () => {
    const data = [
      {
        t: '2026-01-15 00:00:00.000', cnt_ok: '800', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    const { buckets } = computeBucketHeights(data);
    assert.strictEqual(buckets[0].headHeight + buckets[0].tailHeight, 800 * 28);
  });

  it('bucket with exactly 500 rows has no tail', () => {
    const data = [
      {
        t: '2026-01-15 00:00:00.000', cnt_ok: '500', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    const { buckets } = computeBucketHeights(data);
    assert.strictEqual(buckets[0].headCount, 500);
    assert.strictEqual(buckets[0].tailCount, 0);
    assert.strictEqual(buckets[0].tailHeight, 0);
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

  it('renders correct number of head rows for small buckets', () => {
    const data = makeChartData(5);
    renderBucketTable(container, data);
    const headRows = container.querySelectorAll('tbody tr.bucket-head');
    assert.strictEqual(headRows.length, 5);
    // No tail rows (baseCnt 10+1=11 < 500)
    const tailRows = container.querySelectorAll('tbody tr.bucket-tail');
    assert.strictEqual(tailRows.length, 0);
  });

  it('renders head rows in newest-first order', () => {
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
    const rows = container.querySelectorAll('tbody tr.bucket-head');
    // First row should be the newest (last in chart data)
    assert.strictEqual(rows[0].id, 'bucket-head-2026-01-15 00:02:00.000');
    assert.strictEqual(rows[1].id, 'bucket-head-2026-01-15 00:01:00.000');
    assert.strictEqual(rows[2].id, 'bucket-head-2026-01-15 00:00:00.000');
  });

  it('each head row has correct id attribute', () => {
    const data = [
      {
        t: '2026-01-15 12:30:00.000', cnt_ok: '5', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    renderBucketTable(container, data);
    const row = container.querySelector('tbody tr.bucket-head');
    assert.strictEqual(row.id, 'bucket-head-2026-01-15 12:30:00.000');
  });

  it('each head row has proportional height for small buckets', () => {
    const data = [
      {
        t: '2026-01-15 00:00:00.000', cnt_ok: '10', cnt_4xx: '0', cnt_5xx: '0',
      },
      {
        t: '2026-01-15 00:01:00.000', cnt_ok: '20', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    renderBucketTable(container, data);
    const rows = container.querySelectorAll('tbody tr.bucket-head');
    // Newest first: row 0 = 20 rows, row 1 = 10 rows
    assert.strictEqual(rows[0].style.height, `${20 * 28}px`);
    assert.strictEqual(rows[1].style.height, `${10 * 28}px`);
  });

  it('displays row count in placeholder text for small bucket', () => {
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

  it('bucket with > 500 rows produces head and tail rows', () => {
    const data = [
      {
        t: '2026-01-15 00:00:00.000', cnt_ok: '1000', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    renderBucketTable(container, data);
    const headRows = container.querySelectorAll('tbody tr.bucket-head');
    const tailRows = container.querySelectorAll('tbody tr.bucket-tail');
    assert.strictEqual(headRows.length, 1);
    assert.strictEqual(tailRows.length, 1);
    assert.strictEqual(headRows[0].id, 'bucket-head-2026-01-15 00:00:00.000');
    assert.strictEqual(tailRows[0].id, 'bucket-tail-2026-01-15 00:00:00.000');
  });

  it('bucket with <= 500 rows produces only a head row', () => {
    const data = [
      {
        t: '2026-01-15 00:00:00.000', cnt_ok: '200', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    renderBucketTable(container, data);
    const headRows = container.querySelectorAll('tbody tr.bucket-head');
    const tailRows = container.querySelectorAll('tbody tr.bucket-tail');
    assert.strictEqual(headRows.length, 1);
    assert.strictEqual(tailRows.length, 0);
  });

  it('head row height = min(count, 500) * ROW_HEIGHT', () => {
    const data = [
      {
        t: '2026-01-15 00:00:00.000', cnt_ok: '800', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    renderBucketTable(container, data);
    const headRow = container.querySelector('tbody tr.bucket-head');
    assert.strictEqual(headRow.style.height, `${500 * 28}px`);
  });

  it('tail row height = (count - 500) * ROW_HEIGHT', () => {
    const data = [
      {
        t: '2026-01-15 00:00:00.000', cnt_ok: '800', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    renderBucketTable(container, data);
    const tailRow = container.querySelector('tbody tr.bucket-tail');
    assert.strictEqual(tailRow.style.height, `${300 * 28}px`);
  });

  it('head label says "500 of {count} rows" when there is a tail', () => {
    const data = [
      {
        t: '2026-01-15 00:00:00.000', cnt_ok: '1000', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    renderBucketTable(container, data);
    const headTd = container.querySelector('tbody tr.bucket-head .bucket-placeholder');
    assert.strictEqual(headTd.textContent, '500 of 1,000 rows');
  });

  it('head label says "{count} rows" when there is no tail', () => {
    const data = [
      {
        t: '2026-01-15 00:00:00.000', cnt_ok: '200', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    renderBucketTable(container, data);
    const headTd = container.querySelector('tbody tr.bucket-head .bucket-placeholder');
    assert.strictEqual(headTd.textContent, '200 rows');
  });

  it('tail label says "{tailCount} remaining rows"', () => {
    const data = [
      {
        t: '2026-01-15 00:00:00.000', cnt_ok: '1000', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    renderBucketTable(container, data);
    const tailTd = container.querySelector('tbody tr.bucket-tail .bucket-placeholder');
    assert.strictEqual(tailTd.textContent, '500 remaining rows');
  });

  it('total height is preserved (head + tail = original single row height)', () => {
    const data = [
      {
        t: '2026-01-15 00:00:00.000', cnt_ok: '800', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    renderBucketTable(container, data);
    const headRow = container.querySelector('tbody tr.bucket-head');
    const tailRow = container.querySelector('tbody tr.bucket-tail');
    const headH = parseInt(headRow.style.height, 10);
    const tailH = parseInt(tailRow.style.height, 10);
    assert.strictEqual(headH + tailH, 800 * 28);
  });

  it('renders actual column headers instead of generic "Log Buckets"', () => {
    const data = makeChartData(2);
    renderBucketTable(container, data);
    const thElements = container.querySelectorAll('thead th');
    assert.strictEqual(thElements.length, LOG_COLUMN_ORDER.length);
    // Should not contain old generic header
    const headerText = container.querySelector('thead').textContent;
    assert.notInclude(headerText, 'Log Buckets');
  });

  it('placeholder colspan matches column count', () => {
    const data = [
      {
        t: '2026-01-15 00:00:00.000', cnt_ok: '10', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    renderBucketTable(container, data);
    const td = container.querySelector('.bucket-placeholder');
    assert.strictEqual(td.getAttribute('colspan'), String(LOG_COLUMN_ORDER.length));
  });

  it('column headers have data-action for pin toggling', () => {
    const data = makeChartData(1);
    renderBucketTable(container, data);
    const thElements = container.querySelectorAll('thead th');
    for (const th of thElements) {
      assert.strictEqual(th.dataset.action, 'toggle-pinned-column');
      assert.ok(th.dataset.col, 'th should have data-col attribute');
    }
  });
});
