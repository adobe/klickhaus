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
  LCP_BREAKDOWNS,
  interpolateCwvGaps,
} from './rum-lcp-utils.js';
import { checkpointFacet } from './rum-adapter.js';

describe('rum-lcp-utils', () => {
  describe('LCP_BREAKDOWNS', () => {
    it('defines all 16 facets from the full facet set', () => {
      assert.lengthOf(LCP_BREAKDOWNS, 16);
    });

    it('includes URL, Device Type/OS, and Checkpoint as first three', () => {
      assert.strictEqual(LCP_BREAKDOWNS[0].facetName, 'url');
      assert.strictEqual(LCP_BREAKDOWNS[1].facetName, 'userAgent');
      assert.strictEqual(LCP_BREAKDOWNS[2].facetName, 'checkpoint');
    });

    it('includes External Referrer', () => {
      const facet = LCP_BREAKDOWNS.find((b) => b.facetName === 'enterSource');
      assert.isNotNull(facet);
      assert.strictEqual(facet.id, 'breakdown-enterSource');
    });

    it('includes Click targets', () => {
      const facet = LCP_BREAKDOWNS.find((b) => b.facetName === 'clickTarget');
      assert.isNotNull(facet);
      assert.strictEqual(facet.id, 'breakdown-clickTarget');
    });

    it('includes Viewmedia', () => {
      const facet = LCP_BREAKDOWNS.find((b) => b.facetName === 'mediaTarget');
      assert.isNotNull(facet);
    });

    it('includes Viewblock', () => {
      const facet = LCP_BREAKDOWNS.find((b) => b.facetName === 'viewblock');
      assert.isNotNull(facet);
    });

    it('includes Navigate', () => {
      const facet = LCP_BREAKDOWNS.find((b) => b.facetName === 'navigate');
      assert.isNotNull(facet);
    });

    it('includes Language', () => {
      const facet = LCP_BREAKDOWNS.find((b) => b.facetName === 'language');
      assert.isNotNull(facet);
    });

    it('includes Accessibility', () => {
      const facet = LCP_BREAKDOWNS.find((b) => b.facetName === 'accessibility');
      assert.isNotNull(facet);
    });

    it('includes Consent', () => {
      const facet = LCP_BREAKDOWNS.find((b) => b.facetName === 'consent');
      assert.isNotNull(facet);
    });

    it('includes Loadresource', () => {
      const facet = LCP_BREAKDOWNS.find((b) => b.facetName === 'loadresource');
      assert.isNotNull(facet);
    });

    it('includes Acquisition', () => {
      const facet = LCP_BREAKDOWNS.find((b) => b.facetName === 'acquisitionSource');
      assert.isNotNull(facet);
    });

    it('includes Error', () => {
      const facet = LCP_BREAKDOWNS.find((b) => b.facetName === 'error');
      assert.isNotNull(facet);
    });

    it('includes 404', () => {
      const facet = LCP_BREAKDOWNS.find((b) => b.facetName === 'four04');
      assert.isNotNull(facet);
    });

    it('includes Redirect', () => {
      const facet = LCP_BREAKDOWNS.find((b) => b.facetName === 'redirect');
      assert.isNotNull(facet);
    });

    it('has matching col and facetName for all entries', () => {
      for (const bd of LCP_BREAKDOWNS) {
        assert.strictEqual(bd.col, bd.facetName, `col should match facetName for ${bd.id}`);
      }
    });

    it('has unique IDs', () => {
      const ids = LCP_BREAKDOWNS.map((b) => b.id);
      assert.strictEqual(new Set(ids).size, ids.length, 'All IDs should be unique');
    });
  });

  describe('checkpointFacet', () => {
    it('extracts target values for click checkpoint', () => {
      const fn = checkpointFacet('click', 'target');
      const bundle = {
        events: [
          { checkpoint: 'click', source: '.btn', target: '/products' },
          { checkpoint: 'enter', source: 'https://google.com', target: '' },
          { checkpoint: 'click', source: '.link', target: '/about' },
        ],
      };
      const result = fn(bundle);
      assert.deepEqual(result, ['/products', '/about']);
    });

    it('extracts source values for viewblock checkpoint', () => {
      const fn = checkpointFacet('viewblock', 'source');
      const bundle = {
        events: [
          { checkpoint: 'viewblock', source: '.hero', target: '' },
          { checkpoint: 'viewblock', source: '.footer', target: '' },
        ],
      };
      const result = fn(bundle);
      assert.deepEqual(result, ['.hero', '.footer']);
    });

    it('filters out falsy values', () => {
      const fn = checkpointFacet('click', 'target');
      const bundle = {
        events: [
          { checkpoint: 'click', source: '.btn', target: '' },
          { checkpoint: 'click', source: '.btn', target: '/page' },
        ],
      };
      const result = fn(bundle);
      assert.deepEqual(result, ['/page']);
    });

    it('returns empty array when no matching events', () => {
      const fn = checkpointFacet('click', 'target');
      const bundle = {
        events: [
          { checkpoint: 'enter', source: 'https://google.com', target: '' },
        ],
      };
      const result = fn(bundle);
      assert.deepEqual(result, []);
    });

    it('returns empty array for empty events', () => {
      const fn = checkpointFacet('click', 'target');
      const bundle = { events: [] };
      const result = fn(bundle);
      assert.deepEqual(result, []);
    });

    it('uses target as default field', () => {
      const fn = checkpointFacet('navigate');
      const bundle = {
        events: [
          { checkpoint: 'navigate', source: '', target: '/other-page' },
        ],
      };
      const result = fn(bundle);
      assert.deepEqual(result, ['/other-page']);
    });
  });

  describe('interpolateCwvGaps', () => {
    it('returns empty array for empty input', () => {
      assert.deepEqual(interpolateCwvGaps([]), []);
    });

    it('returns single-element array unchanged', () => {
      const data = [{
        t: 'a', cnt_ok: 10, cnt_4xx: 5, cnt_5xx: 2,
      }];
      assert.deepEqual(interpolateCwvGaps(data), data);
    });

    it('does not modify data above threshold', () => {
      const data = [
        {
          t: 'a', cnt_ok: 50, cnt_4xx: 30, cnt_5xx: 20,
        },
        {
          t: 'b', cnt_ok: 60, cnt_4xx: 25, cnt_5xx: 15,
        },
        {
          t: 'c', cnt_ok: 40, cnt_4xx: 35, cnt_5xx: 25,
        },
      ];
      const result = interpolateCwvGaps(data);
      assert.deepEqual(result, data);
    });

    it('interpolates a sparse point between two non-sparse neighbors', () => {
      const data = [
        {
          t: 'a', cnt_ok: 100, cnt_4xx: 0, cnt_5xx: 0,
        },
        {
          t: 'b', cnt_ok: 0, cnt_4xx: 0, cnt_5xx: 0,
        },
        {
          t: 'c', cnt_ok: 0, cnt_4xx: 100, cnt_5xx: 0,
        },
      ];
      const result = interpolateCwvGaps(data);

      // Middle point should be interpolated
      assert.strictEqual(result[1].t, 'b');
      const total = result[1].cnt_ok + result[1].cnt_4xx + result[1].cnt_5xx;
      assert.isAbove(total, 0, 'Interpolated point should have non-zero total');
    });

    it('preserves proportions in interpolation', () => {
      const data = [
        {
          t: 'a', cnt_ok: 80, cnt_4xx: 10, cnt_5xx: 10,
        },
        {
          t: 'b', cnt_ok: 0, cnt_4xx: 0, cnt_5xx: 0,
        },
        {
          t: 'c', cnt_ok: 80, cnt_4xx: 10, cnt_5xx: 10,
        },
      ];
      const result = interpolateCwvGaps(data);

      // Should be 80% ok, 10% ni, 10% poor (same as neighbors)
      assert.strictEqual(result[1].cnt_ok, 80);
      assert.strictEqual(result[1].cnt_4xx, 10);
      assert.strictEqual(result[1].cnt_5xx, 10);
    });

    it('extrapolates from previous neighbor when no next', () => {
      const data = [
        {
          t: 'a', cnt_ok: 70, cnt_4xx: 20, cnt_5xx: 10,
        },
        {
          t: 'b', cnt_ok: 0, cnt_4xx: 0, cnt_5xx: 0,
        },
      ];
      const result = interpolateCwvGaps(data);

      assert.strictEqual(result[1].cnt_ok, 70);
      assert.strictEqual(result[1].cnt_4xx, 20);
      assert.strictEqual(result[1].cnt_5xx, 10);
    });

    it('extrapolates from next neighbor when no previous', () => {
      const data = [
        {
          t: 'a', cnt_ok: 0, cnt_4xx: 0, cnt_5xx: 0,
        },
        {
          t: 'b', cnt_ok: 60, cnt_4xx: 30, cnt_5xx: 10,
        },
      ];
      const result = interpolateCwvGaps(data);

      assert.strictEqual(result[0].cnt_ok, 60);
      assert.strictEqual(result[0].cnt_4xx, 30);
      assert.strictEqual(result[0].cnt_5xx, 10);
    });

    it('handles multiple consecutive sparse points', () => {
      const data = [
        {
          t: 'a', cnt_ok: 100, cnt_4xx: 0, cnt_5xx: 0,
        },
        {
          t: 'b', cnt_ok: 0, cnt_4xx: 0, cnt_5xx: 0,
        },
        {
          t: 'c', cnt_ok: 0, cnt_4xx: 0, cnt_5xx: 0,
        },
        {
          t: 'd', cnt_ok: 0, cnt_4xx: 0, cnt_5xx: 100,
        },
      ];
      const result = interpolateCwvGaps(data);

      // Each sparse point should have non-zero interpolated values
      const totalB = result[1].cnt_ok + result[1].cnt_4xx + result[1].cnt_5xx;
      const totalC = result[2].cnt_ok + result[2].cnt_4xx + result[2].cnt_5xx;
      assert.isAbove(totalB, 0);
      assert.isAbove(totalC, 0);
    });

    it('uses custom threshold', () => {
      const data = [
        {
          t: 'a', cnt_ok: 50, cnt_4xx: 30, cnt_5xx: 20,
        },
        {
          t: 'b', cnt_ok: 3, cnt_4xx: 1, cnt_5xx: 0,
        },
        {
          t: 'c', cnt_ok: 50, cnt_4xx: 30, cnt_5xx: 20,
        },
      ];

      // With default threshold (5), point b (total=4) is sparse
      const result5 = interpolateCwvGaps(data, 5);
      assert.notDeepEqual(result5[1], data[1]);

      // With threshold 3, point b (total=4) is not sparse
      const result3 = interpolateCwvGaps(data, 3);
      assert.deepEqual(result3[1], data[1]);
    });

    it('preserves timestamp in interpolated points', () => {
      const data = [
        {
          t: '2025-01-01T10:00:00Z', cnt_ok: 100, cnt_4xx: 0, cnt_5xx: 0,
        },
        {
          t: '2025-01-01T11:00:00Z', cnt_ok: 0, cnt_4xx: 0, cnt_5xx: 0,
        },
        {
          t: '2025-01-01T12:00:00Z', cnt_ok: 100, cnt_4xx: 0, cnt_5xx: 0,
        },
      ];
      const result = interpolateCwvGaps(data);
      assert.strictEqual(result[1].t, '2025-01-01T11:00:00Z');
    });

    it('does not mutate the original array', () => {
      const data = [
        {
          t: 'a', cnt_ok: 100, cnt_4xx: 0, cnt_5xx: 0,
        },
        {
          t: 'b', cnt_ok: 0, cnt_4xx: 0, cnt_5xx: 0,
        },
        {
          t: 'c', cnt_ok: 100, cnt_4xx: 0, cnt_5xx: 0,
        },
      ];
      const originalB = { ...data[1] };
      interpolateCwvGaps(data);
      assert.deepEqual(data[1], originalB);
    });

    it('handles all-sparse data gracefully', () => {
      const data = [
        {
          t: 'a', cnt_ok: 0, cnt_4xx: 0, cnt_5xx: 0,
        },
        {
          t: 'b', cnt_ok: 0, cnt_4xx: 0, cnt_5xx: 0,
        },
      ];
      // Should not throw and should return data unchanged
      const result = interpolateCwvGaps(data);
      assert.lengthOf(result, 2);
    });

    it('ensures cnt_5xx is never negative', () => {
      const data = [
        {
          t: 'a', cnt_ok: 33, cnt_4xx: 34, cnt_5xx: 33,
        },
        {
          t: 'b', cnt_ok: 0, cnt_4xx: 0, cnt_5xx: 0,
        },
        {
          t: 'c', cnt_ok: 33, cnt_4xx: 34, cnt_5xx: 33,
        },
      ];
      const result = interpolateCwvGaps(data);
      assert.isAtLeast(result[1].cnt_5xx, 0);
    });
  });
});
