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
      assert.strictEqual(ps.offset, 0);
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
    it('resets offset, hasMore, and loading', () => {
      const ps = new PaginationState();
      ps.offset = 250;
      ps.hasMore = false;
      ps.loading = true;

      ps.reset();

      assert.strictEqual(ps.offset, 0);
      assert.strictEqual(ps.hasMore, true);
      assert.strictEqual(ps.loading, false);
    });

    it('preserves pageSize', () => {
      const ps = new PaginationState(100);
      ps.offset = 50;

      ps.reset();

      assert.strictEqual(ps.pageSize, 100);
    });
  });

  describe('recordPage', () => {
    it('sets hasMore=true when result is a full page', () => {
      const ps = new PaginationState();
      ps.recordPage(PAGE_SIZE);

      assert.strictEqual(ps.offset, PAGE_SIZE);
      assert.strictEqual(ps.hasMore, true);
    });

    it('sets hasMore=false when result is smaller than page size', () => {
      const ps = new PaginationState();
      ps.recordPage(123);

      assert.strictEqual(ps.offset, 123);
      assert.strictEqual(ps.hasMore, false);
    });

    it('sets hasMore=false when result is empty', () => {
      const ps = new PaginationState();
      ps.recordPage(0);

      assert.strictEqual(ps.offset, 0);
      assert.strictEqual(ps.hasMore, false);
    });

    it('accumulates offset across multiple pages', () => {
      const ps = new PaginationState();
      ps.recordPage(PAGE_SIZE);
      ps.recordPage(PAGE_SIZE);
      ps.recordPage(200);

      assert.strictEqual(ps.offset, PAGE_SIZE * 2 + 200);
      assert.strictEqual(ps.hasMore, false);
    });

    it('uses custom page size for hasMore check', () => {
      const ps = new PaginationState(10);
      ps.recordPage(10);
      assert.strictEqual(ps.hasMore, true);

      ps.recordPage(5);
      assert.strictEqual(ps.hasMore, false);
    });
  });

  describe('canLoadMore', () => {
    it('returns true when hasMore and not loading', () => {
      const ps = new PaginationState();
      assert.strictEqual(ps.canLoadMore(), true);
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
