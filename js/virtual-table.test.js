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
import { VirtualTable } from './virtual-table.js';

function makeContainer(height = 280) {
  const el = document.createElement('div');
  // Simulate a sized container
  Object.defineProperty(el, 'clientHeight', { value: height, writable: true });
  Object.defineProperty(el, 'scrollTop', { value: 0, writable: true });
  document.body.appendChild(el);
  return el;
}

function makeColumns() {
  return [
    { key: 'timestamp', label: 'Time', width: 180 },
    { key: 'status', label: 'Status', width: 60 },
  ];
}

function makeGetData(rows) {
  const calls = [];
  const fn = async (startIdx, count) => {
    calls.push({ startIdx, count });
    return rows.slice(startIdx, startIdx + count);
  };
  fn.calls = calls;
  return fn;
}

function renderCell(col, value) {
  return value != null ? String(value) : '';
}

describe('VirtualTable', () => {
  let container;
  let vt;

  afterEach(() => {
    if (vt) vt.destroy();
    if (container && container.parentNode) container.parentNode.removeChild(container);
  });

  describe('constructor', () => {
    it('creates table elements in the container', () => {
      container = makeContainer();
      vt = new VirtualTable({
        container, columns: makeColumns(), getData: makeGetData([]), renderCell,
      });
      assert.ok(container.querySelector('table'));
      assert.ok(container.querySelector('thead'));
      assert.ok(container.querySelector('tbody'));
    });

    it('renders column headers', () => {
      container = makeContainer();
      vt = new VirtualTable({
        container, columns: makeColumns(), getData: makeGetData([]), renderCell,
      });
      const ths = container.querySelectorAll('thead th');
      assert.strictEqual(ths.length, 2);
      assert.strictEqual(ths[0].textContent, 'Time');
      assert.strictEqual(ths[1].textContent, 'Status');
    });

    it('sets container overflow-y to auto', () => {
      container = makeContainer();
      vt = new VirtualTable({
        container, columns: makeColumns(), getData: makeGetData([]), renderCell,
      });
      assert.strictEqual(container.style.overflowY, 'auto');
    });
  });

  describe('setTotalRows', () => {
    it('sets spacer heights to create virtual scroll space', () => {
      container = makeContainer();
      vt = new VirtualTable({
        container, columns: makeColumns(), getData: makeGetData([]), renderCell,
      });
      vt.setTotalRows(1000);
      const topH = parseInt(vt.spacerTop.style.height, 10);
      const bottomH = parseInt(vt.spacerBottom.style.height, 10);
      const renderedRows = vt.tbody.querySelectorAll('tr').length;
      // Total virtual height = topH + renderedRows*rowHeight + bottomH
      assert.strictEqual(topH + renderedRows * 28 + bottomH, 1000 * 28);
    });

    it('uses custom row height', () => {
      container = makeContainer();
      vt = new VirtualTable({
        container, columns: makeColumns(), getData: makeGetData([]), renderCell, rowHeight: 40,
      });
      vt.setTotalRows(500);
      const topH = parseInt(vt.spacerTop.style.height, 10);
      const bottomH = parseInt(vt.spacerBottom.style.height, 10);
      const renderedRows = vt.tbody.querySelectorAll('tr').length;
      assert.strictEqual(topH + renderedRows * 40 + bottomH, 500 * 40);
    });
  });

  describe('row index calculation', () => {
    it('calculates start index from scroll position', () => {
      container = makeContainer(280); // 10 visible rows at 28px
      const getData = makeGetData(Array.from({ length: 100 }, (_, i) => ({
        timestamp: `2026-01-01 00:00:00.${String(i).padStart(3, '0')}`,
        status: 200,
      })));
      vt = new VirtualTable({
        container, columns: makeColumns(), getData, renderCell,
      });
      vt.setTotalRows(100);

      // Scroll to row 20 (scrollTop = 20 * 28 = 560)
      Object.defineProperty(container, 'scrollTop', { value: 560, writable: true });
      vt.invalidate();

      const rows = container.querySelectorAll('tbody tr');
      assert.ok(rows.length > 0, 'should render some rows');
      // First row should be around index 10 (20 - overscan of 10)
      const firstIdx = parseInt(rows[0].dataset.rowIdx, 10);
      assert.strictEqual(firstIdx, 10, 'first rendered row should be start index minus overscan');
    });
  });

  describe('visible range with overscan', () => {
    it('renders overscan rows above and below viewport', () => {
      container = makeContainer(280);
      const totalRows = 200;
      const allRows = Array.from({ length: totalRows }, (_, i) => ({
        timestamp: `row-${i}`, status: 200,
      }));
      const getData = makeGetData(allRows);
      vt = new VirtualTable({
        container, columns: makeColumns(), getData, renderCell,
      });
      vt.setTotalRows(totalRows);

      // Scroll to middle
      Object.defineProperty(container, 'scrollTop', { value: 100 * 28, writable: true });
      vt.invalidate();

      const rows = container.querySelectorAll('tbody tr');
      // With overscan=10, visible=10, total rendered should be ~30
      assert.ok(rows.length >= 20, `should render at least 20 rows but got ${rows.length}`);
      assert.ok(rows.length <= 40, `should render at most 40 rows but got ${rows.length}`);
    });
  });

  describe('cache', () => {
    it('calls getData for missing rows', () => {
      container = makeContainer(280);
      const getData = makeGetData([]);
      vt = new VirtualTable({
        container, columns: makeColumns(), getData, renderCell,
      });
      vt.setTotalRows(50);

      // getData should have been called for the visible range
      assert.ok(getData.calls.length > 0, 'should call getData');
    });

    it('does not re-fetch cached rows', async () => {
      container = makeContainer(280);
      const allRows = Array.from({ length: 50 }, (_, i) => ({
        timestamp: `row-${i}`, status: 200,
      }));
      const getData = makeGetData(allRows);
      vt = new VirtualTable({
        container, columns: makeColumns(), getData, renderCell,
      });
      vt.setTotalRows(50);

      // Wait for initial fetch
      await new Promise((r) => {
        setTimeout(r, 50);
      });
      const initialCalls = getData.calls.length;

      // Invalidate without scrolling — same range, data cached
      vt.invalidate();
      await new Promise((r) => {
        setTimeout(r, 50);
      });
      assert.strictEqual(getData.calls.length, initialCalls, 'should not re-fetch cached data');
    });

    it('clearCache empties the cache', async () => {
      container = makeContainer(280);
      const allRows = Array.from({ length: 50 }, (_, i) => ({
        timestamp: `row-${i}`, status: 200,
      }));
      const getData = makeGetData(allRows);
      vt = new VirtualTable({
        container, columns: makeColumns(), getData, renderCell,
      });
      vt.setTotalRows(50);
      await new Promise((r) => {
        setTimeout(r, 50);
      });

      const callsBefore = getData.calls.length;
      vt.clearCache();
      vt.invalidate();
      await new Promise((r) => {
        setTimeout(r, 50);
      });
      assert.ok(getData.calls.length > callsBefore, 'should re-fetch after cache clear');
    });

    it('seedCache pre-populates rows so getData is not called', () => {
      container = makeContainer(280);
      const allRows = Array.from({ length: 20 }, (_, i) => ({
        timestamp: `row-${i}`, status: 200,
      }));
      const getData = makeGetData([]);
      vt = new VirtualTable({
        container, columns: makeColumns(), getData, renderCell,
      });

      // Seed cache before setting total rows
      vt.seedCache(0, allRows);
      const callsBefore = getData.calls.length;
      vt.setTotalRows(20);

      // Should render cached rows without calling getData
      const rows = container.querySelectorAll('tbody tr:not(.loading-row)');
      assert.ok(rows.length > 0, 'should render seeded rows');
      assert.strictEqual(getData.calls.length, callsBefore, 'should not call getData for seeded data');
    });
  });

  describe('layout', () => {
    it('renders rows in normal flow without position absolute', async () => {
      container = makeContainer(280);
      const allRows = Array.from({ length: 30 }, (_, i) => ({
        timestamp: `row-${i}`, status: 200,
      }));
      vt = new VirtualTable({
        container, columns: makeColumns(), getData: makeGetData(allRows), renderCell,
      });
      vt.setTotalRows(30);
      await new Promise((r) => {
        setTimeout(r, 50);
      });

      const rows = container.querySelectorAll('tbody tr');
      for (const row of rows) {
        assert.notInclude(row.style.position, 'absolute', 'rows should not be absolute positioned');
      }
    });

    it('uses colgroup for column widths', () => {
      container = makeContainer();
      const cols = [
        { key: 'timestamp', label: 'Time', width: 180 },
        { key: 'status', label: 'Status', width: 60 },
      ];
      vt = new VirtualTable({
        container, columns: cols, getData: makeGetData([]), renderCell,
      });
      const colEls = container.querySelectorAll('colgroup col');
      assert.strictEqual(colEls.length, 2);
      assert.strictEqual(colEls[0].style.width, '180px');
      assert.strictEqual(colEls[1].style.width, '60px');
    });

    it('sets table width to sum of column widths for horizontal scrolling', () => {
      container = makeContainer();
      const cols = [
        { key: 'timestamp', label: 'Time', width: 180 },
        { key: 'status', label: 'Status', width: 60 },
        { key: 'host', label: 'Host', width: 200 },
      ];
      vt = new VirtualTable({
        container, columns: cols, getData: makeGetData([]), renderCell,
      });
      assert.strictEqual(vt.table.style.width, '440px');
    });

    it('defaults column width to 120 when not specified', () => {
      container = makeContainer();
      const cols = [
        { key: 'timestamp', label: 'Time', width: 180 },
        { key: 'other', label: 'Other' },
      ];
      vt = new VirtualTable({
        container, columns: cols, getData: makeGetData([]), renderCell,
      });
      const colEls = container.querySelectorAll('colgroup col');
      assert.strictEqual(colEls[1].style.width, '120px');
      assert.strictEqual(vt.table.style.width, '300px');
    });

    it('sets spacer heights for virtual scroll area', () => {
      container = makeContainer(280);
      const allRows = Array.from({ length: 100 }, (_, i) => ({
        timestamp: `row-${i}`, status: 200,
      }));
      vt = new VirtualTable({
        container, columns: makeColumns(), getData: makeGetData(allRows), renderCell,
      });
      vt.setTotalRows(100);

      const topH = parseInt(vt.spacerTop.style.height, 10);
      const bottomH = parseInt(vt.spacerBottom.style.height, 10);
      // With scrollTop=0, spacerTop should be 0 (start=0)
      assert.strictEqual(topH, 0, 'spacerTop height should be 0 at scroll position 0');
      assert.ok(bottomH > 0, 'spacerBottom height should be positive');
    });
  });

  describe('scrollToRow', () => {
    it('sets scrollTop to row index times row height', () => {
      container = makeContainer();
      vt = new VirtualTable({
        container, columns: makeColumns(), getData: makeGetData([]), renderCell,
      });
      vt.setTotalRows(100);
      vt.scrollToRow(25);
      assert.strictEqual(container.scrollTop, 25 * 28);
    });

    it('clamps to zero for negative index', () => {
      container = makeContainer();
      vt = new VirtualTable({
        container, columns: makeColumns(), getData: makeGetData([]), renderCell,
      });
      vt.setTotalRows(100);
      vt.scrollToRow(-5);
      assert.strictEqual(container.scrollTop, 0);
    });
  });

  describe('scrollToTimestamp', () => {
    it('scrolls to the row closest to the target timestamp', async () => {
      // Use 30 rows so all fit in visible + overscan range and get cached
      container = makeContainer(840); // 30 rows * 28px = 840px
      const rows = Array.from({ length: 30 }, (_, i) => ({
        timestamp: 1000 - i * 10, // descending: 1000, 990, 980, ...
        status: 200,
      }));
      const getData = makeGetData(rows);
      vt = new VirtualTable({
        container, columns: makeColumns(), getData, renderCell,
      });
      vt.setTotalRows(30);
      await new Promise((r) => {
        setTimeout(r, 50);
      });

      vt.scrollToTimestamp(800, (row) => row.timestamp);
      // Row with ts=800 is at index 20 => scrollTop = 20*28 = 560
      assert.strictEqual(container.scrollTop, 20 * 28);
    });
  });

  describe('placeholder rendering', () => {
    it('adds loading-row class for rows without data', () => {
      container = makeContainer(280);
      // getData returns empty — simulates data not yet loaded
      const getData = async () => [];
      vt = new VirtualTable({
        container, columns: makeColumns(), getData, renderCell,
      });
      vt.setTotalRows(50);

      const loadingRows = container.querySelectorAll('tbody tr.loading-row');
      assert.ok(loadingRows.length > 0, 'should have loading placeholder rows');
    });
  });

  describe('onVisibleRangeChange', () => {
    it('fires with visible row indices', () => {
      container = makeContainer(280);
      const ranges = [];
      const allRows = Array.from({ length: 50 }, (_, i) => ({
        timestamp: `row-${i}`, status: 200,
      }));
      vt = new VirtualTable({
        container,
        columns: makeColumns(),
        getData: makeGetData(allRows),
        renderCell,
        onVisibleRangeChange: (first, last) => ranges.push({ first, last }),
      });
      vt.setTotalRows(50);

      assert.ok(ranges.length > 0, 'should fire onVisibleRangeChange');
      assert.ok(ranges[0].first >= 0);
      assert.ok(ranges[0].last > ranges[0].first);
    });
  });

  describe('onRowClick', () => {
    it('fires when a row is clicked', async () => {
      container = makeContainer(280);
      const allRows = Array.from({ length: 50 }, (_, i) => ({
        timestamp: `row-${i}`, status: 200,
      }));
      const clicks = [];
      vt = new VirtualTable({
        container,
        columns: makeColumns(),
        getData: makeGetData(allRows),
        renderCell,
        onRowClick: (idx, row) => clicks.push({ idx, row }),
      });
      vt.setTotalRows(50);
      await new Promise((r) => {
        setTimeout(r, 50);
      });

      // Simulate click on first rendered row's td
      const td = container.querySelector('tbody tr[data-row-idx] td');
      if (td) td.click();
      assert.ok(clicks.length > 0, 'should fire onRowClick');
    });
  });

  describe('setColumns', () => {
    it('re-renders header with new columns', () => {
      container = makeContainer();
      vt = new VirtualTable({
        container, columns: makeColumns(), getData: makeGetData([]), renderCell,
      });
      vt.setColumns([
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
        { key: 'c', label: 'C' },
      ]);
      const ths = container.querySelectorAll('thead th');
      assert.strictEqual(ths.length, 3);
      assert.strictEqual(ths[2].textContent, 'C');
    });
  });

  describe('pinned columns', () => {
    it('applies sticky positioning to pinned header cells', () => {
      container = makeContainer();
      const cols = [
        {
          key: 'ts', label: 'Time', pinned: true, width: 180,
        },
        { key: 'status', label: 'Status', width: 60 },
      ];
      vt = new VirtualTable({
        container, columns: cols, getData: makeGetData([]), renderCell,
      });
      const th = container.querySelector('thead th');
      assert.strictEqual(th.style.position, 'sticky');
      assert.strictEqual(th.style.left, '0px');
    });
  });

  describe('infinite scroll (totalRows growth)', () => {
    // Simulates how logs.js getData works: internally fetches a full page from
    // the server, checks if the page is full/partial, and adjusts totalRows.
    // The VirtualTable only sees the sliced result, but totalRows is updated
    // via setTotalRows as a side effect.
    const INTERNAL_PAGE_SIZE = 50;

    function makePagedGetData(opts = {}) {
      const { totalAvailable = Infinity } = opts;
      const cache = new Map();
      return async (startIdx, count) => {
        const pageIdx = Math.floor(startIdx / INTERNAL_PAGE_SIZE);
        if (!cache.has(pageIdx)) {
          // Simulate server fetch of a full page
          const pageStart = pageIdx * INTERNAL_PAGE_SIZE;
          const available = Math.max(0, totalAvailable - pageStart);
          const fetchedCount = Math.min(INTERNAL_PAGE_SIZE, available);
          const fetched = Array.from({ length: fetchedCount }, (_, i) => ({
            timestamp: `row-${pageStart + i}`, status: 200,
          }));
          cache.set(pageIdx, fetched);

          // Adjust totalRows based on page fullness (mirrors logs.js fix)
          if (fetched.length < INTERNAL_PAGE_SIZE) {
            const actualTotal = pageIdx * INTERNAL_PAGE_SIZE + fetched.length;
            if (actualTotal < vt.totalRows) {
              vt.setTotalRows(actualTotal);
            }
          } else {
            const minTotal = (pageIdx + 2) * INTERNAL_PAGE_SIZE;
            if (minTotal > vt.totalRows) {
              vt.setTotalRows(minTotal);
            }
          }
        }
        const page = cache.get(pageIdx);
        const offset = startIdx - pageIdx * INTERNAL_PAGE_SIZE;
        return page.slice(offset, offset + count);
      };
    }

    it('grows totalRows when a full page is fetched', async () => {
      container = makeContainer(280);
      const initialTotal = INTERNAL_PAGE_SIZE * 2; // 100
      const fn = makePagedGetData({ totalAvailable: 500 });

      vt = new VirtualTable({
        container, columns: makeColumns(), getData: fn, renderCell,
      });
      vt.seedCache(0, Array.from({ length: INTERNAL_PAGE_SIZE }, (_, i) => ({
        timestamp: `row-${i}`, status: 200,
      })));
      vt.setTotalRows(initialTotal);

      // Scroll near end of initial estimate — triggers fetch in uncached page 1
      Object.defineProperty(container, 'scrollTop', {
        value: (initialTotal - 5) * 28, writable: true,
      });
      vt.invalidate();
      await new Promise((r) => {
        setTimeout(r, 150);
      });

      // Full page fetched for page 1 → totalRows should grow to (1+2)*50=150
      assert.ok(
        vt.totalRows > initialTotal,
        `totalRows should grow beyond ${initialTotal}, got ${vt.totalRows}`,
      );
    });

    it('caps totalRows when a partial page is fetched', async () => {
      container = makeContainer(280);
      const totalAvailable = INTERNAL_PAGE_SIZE + 10; // 60 rows total
      const fn = makePagedGetData({ totalAvailable });

      vt = new VirtualTable({
        container, columns: makeColumns(), getData: fn, renderCell,
      });
      vt.seedCache(0, Array.from({ length: INTERNAL_PAGE_SIZE }, (_, i) => ({
        timestamp: `row-${i}`, status: 200,
      })));
      vt.setTotalRows(500); // Large initial estimate

      // Scroll to trigger fetch for page 1 (which has only 10 rows)
      Object.defineProperty(container, 'scrollTop', {
        value: INTERNAL_PAGE_SIZE * 28, writable: true,
      });
      vt.invalidate();
      await new Promise((r) => {
        setTimeout(r, 150);
      });

      assert.strictEqual(
        vt.totalRows,
        totalAvailable,
        `totalRows should be capped to ${totalAvailable}`,
      );
    });
  });

  describe('destroy', () => {
    it('cleans up without errors', () => {
      container = makeContainer();
      vt = new VirtualTable({
        container, columns: makeColumns(), getData: makeGetData([]), renderCell,
      });
      vt.destroy();
      // Should not throw
      vt = null;
    });
  });
});
