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
import { assert } from 'chai';
import { PAGE_SIZE, PaginationState } from './pagination.js';

describe('PAGE_SIZE', () => {
  it('is 500', () => {
    assert.strictEqual(PAGE_SIZE, 500);
  });
});

describe('PaginationState', () => {
  describe('constructor', () => {
    it('initializes with default page size', () => {
      const ps = new PaginationState();
      assert.strictEqual(ps.cursor, null);
      assert.strictEqual(ps.hasMore, true);
      assert.strictEqual(ps.loading, false);
      assert.strictEqual(ps.pageSize, PAGE_SIZE);
    });

    it('accepts custom page size', () => {
      const ps = new PaginationState(100);
      assert.strictEqual(ps.pageSize, 100);
    });
  });

  describe('reset', () => {
    it('resets cursor, hasMore, and loading', () => {
      const ps = new PaginationState();
      ps.cursor = '2025-01-15 10:30:00.123';
      ps.hasMore = false;
      ps.loading = true;

      ps.reset();

      assert.strictEqual(ps.cursor, null);
      assert.strictEqual(ps.hasMore, true);
      assert.strictEqual(ps.loading, false);
    });

    it('preserves pageSize', () => {
      const ps = new PaginationState(100);
      ps.cursor = '2025-01-15 10:30:00.123';

      ps.reset();

      assert.strictEqual(ps.pageSize, 100);
    });
  });

  describe('recordPage', () => {
    it('sets hasMore=true when result is a full page', () => {
      const rows = Array.from({ length: PAGE_SIZE }, (_, i) => ({
        timestamp: `2025-01-15 10:30:00.${String(i).padStart(3, '0')}`,
      }));
      const ps = new PaginationState();
      ps.recordPage(rows);

      assert.strictEqual(ps.hasMore, true);
    });

    it('sets hasMore=false when result is smaller than page size', () => {
      const rows = [
        { timestamp: '2025-01-15 10:30:00.100' },
        { timestamp: '2025-01-15 10:30:00.050' },
        { timestamp: '2025-01-15 10:30:00.001' },
      ];
      const ps = new PaginationState();
      ps.recordPage(rows);

      assert.strictEqual(ps.hasMore, false);
    });

    it('sets hasMore=false when result is empty', () => {
      const ps = new PaginationState();
      ps.recordPage([]);

      assert.strictEqual(ps.hasMore, false);
    });

    it('extracts cursor from last row timestamp', () => {
      const rows = [
        { timestamp: '2025-01-15 10:30:00.300' },
        { timestamp: '2025-01-15 10:30:00.200' },
        { timestamp: '2025-01-15 10:30:00.100' },
      ];
      const ps = new PaginationState();
      ps.recordPage(rows);

      assert.strictEqual(ps.cursor, '2025-01-15 10:30:00.100');
    });

    it('does not update cursor when result is empty', () => {
      const ps = new PaginationState();
      ps.cursor = '2025-01-15 10:30:00.100';
      ps.recordPage([]);

      assert.strictEqual(ps.cursor, '2025-01-15 10:30:00.100');
    });

    it('updates cursor across multiple pages', () => {
      const ps = new PaginationState(2);

      ps.recordPage([
        { timestamp: '2025-01-15 10:30:00.300' },
        { timestamp: '2025-01-15 10:30:00.200' },
      ]);
      assert.strictEqual(ps.cursor, '2025-01-15 10:30:00.200');
      assert.strictEqual(ps.hasMore, true);

      ps.recordPage([
        { timestamp: '2025-01-15 10:30:00.100' },
      ]);
      assert.strictEqual(ps.cursor, '2025-01-15 10:30:00.100');
      assert.strictEqual(ps.hasMore, false);
    });

    it('uses custom page size for hasMore check', () => {
      const ps = new PaginationState(2);
      ps.recordPage([
        { timestamp: '2025-01-15 10:30:00.200' },
        { timestamp: '2025-01-15 10:30:00.100' },
      ]);
      assert.strictEqual(ps.hasMore, true);

      ps.recordPage([
        { timestamp: '2025-01-15 10:30:00.050' },
      ]);
      assert.strictEqual(ps.hasMore, false);
    });
  });

  describe('canLoadMore', () => {
    it('returns true when hasMore, not loading, and cursor is set', () => {
      const ps = new PaginationState();
      ps.cursor = '2025-01-15 10:30:00.000';
      assert.strictEqual(ps.canLoadMore(), true);
    });

    it('returns false when cursor is null', () => {
      const ps = new PaginationState();
      assert.strictEqual(ps.canLoadMore(), false);
    });

    it('returns false when loading', () => {
      const ps = new PaginationState();
      ps.loading = true;
      assert.strictEqual(ps.canLoadMore(), false);
    });

    it('returns false when no more data', () => {
      const ps = new PaginationState();
      ps.hasMore = false;
      assert.strictEqual(ps.canLoadMore(), false);
    });

    it('returns false when both loading and no more data', () => {
      const ps = new PaginationState();
      ps.loading = true;
      ps.hasMore = false;
      assert.strictEqual(ps.canLoadMore(), false);
    });
  });

  describe('shouldTriggerLoad', () => {
    it('triggers when scrolled past 50% and can load more', () => {
      const ps = new PaginationState();
      ps.cursor = '2025-01-15 10:30:00.000';
      assert.strictEqual(ps.shouldTriggerLoad(0.6, false), true);
    });

    it('does not trigger when scroll is below threshold', () => {
      const ps = new PaginationState();
      assert.strictEqual(ps.shouldTriggerLoad(0.3, false), false);
    });

    it('does not trigger at exactly 50%', () => {
      const ps = new PaginationState();
      assert.strictEqual(ps.shouldTriggerLoad(0.5, false), false);
    });

    it('does not trigger when globally loading', () => {
      const ps = new PaginationState();
      assert.strictEqual(ps.shouldTriggerLoad(0.9, true), false);
    });

    it('does not trigger when pagination is loading', () => {
      const ps = new PaginationState();
      ps.loading = true;
      assert.strictEqual(ps.shouldTriggerLoad(0.9, false), false);
    });

    it('does not trigger when no more data', () => {
      const ps = new PaginationState();
      ps.hasMore = false;
      assert.strictEqual(ps.shouldTriggerLoad(0.9, false), false);
    });
  });
});
