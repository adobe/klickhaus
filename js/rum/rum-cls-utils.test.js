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
  CLS_BREAKDOWNS,
  interpolateCwvGaps,
} from './rum-cls-utils.js';

describe('rum-cls-utils', () => {
  describe('CLS_BREAKDOWNS', () => {
    it('defines all 16 facets from the full facet set', () => {
      assert.lengthOf(CLS_BREAKDOWNS, 16);
    });

    it('includes URL, Device Type/OS, and Checkpoint as first three', () => {
      assert.strictEqual(CLS_BREAKDOWNS[0].facetName, 'url');
      assert.strictEqual(CLS_BREAKDOWNS[1].facetName, 'userAgent');
      assert.strictEqual(CLS_BREAKDOWNS[2].facetName, 'checkpoint');
    });

    it('includes External Referrer', () => {
      const facet = CLS_BREAKDOWNS.find((b) => b.facetName === 'enterSource');
      assert.isNotNull(facet);
      assert.strictEqual(facet.id, 'breakdown-enterSource');
    });

    it('includes Click targets', () => {
      const facet = CLS_BREAKDOWNS.find((b) => b.facetName === 'clickTarget');
      assert.isNotNull(facet);
      assert.strictEqual(facet.id, 'breakdown-clickTarget');
    });

    it('includes Viewmedia', () => {
      const facet = CLS_BREAKDOWNS.find((b) => b.facetName === 'mediaTarget');
      assert.isNotNull(facet);
    });

    it('includes Viewblock', () => {
      const facet = CLS_BREAKDOWNS.find((b) => b.facetName === 'viewblock');
      assert.isNotNull(facet);
    });

    it('includes Navigate', () => {
      const facet = CLS_BREAKDOWNS.find((b) => b.facetName === 'navigate');
      assert.isNotNull(facet);
    });

    it('includes Language', () => {
      const facet = CLS_BREAKDOWNS.find((b) => b.facetName === 'language');
      assert.isNotNull(facet);
    });

    it('includes Accessibility', () => {
      const facet = CLS_BREAKDOWNS.find((b) => b.facetName === 'accessibility');
      assert.isNotNull(facet);
    });

    it('includes Consent', () => {
      const facet = CLS_BREAKDOWNS.find((b) => b.facetName === 'consent');
      assert.isNotNull(facet);
    });

    it('includes Loadresource', () => {
      const facet = CLS_BREAKDOWNS.find((b) => b.facetName === 'loadresource');
      assert.isNotNull(facet);
    });

    it('includes Acquisition', () => {
      const facet = CLS_BREAKDOWNS.find((b) => b.facetName === 'acquisitionSource');
      assert.isNotNull(facet);
    });

    it('includes Error', () => {
      const facet = CLS_BREAKDOWNS.find((b) => b.facetName === 'error');
      assert.isNotNull(facet);
    });

    it('includes 404', () => {
      const facet = CLS_BREAKDOWNS.find((b) => b.facetName === 'four04');
      assert.isNotNull(facet);
    });

    it('includes Redirect', () => {
      const facet = CLS_BREAKDOWNS.find((b) => b.facetName === 'redirect');
      assert.isNotNull(facet);
    });

    it('has matching col and facetName for all entries', () => {
      for (const bd of CLS_BREAKDOWNS) {
        assert.strictEqual(bd.col, bd.facetName, `col should match facetName for ${bd.id}`);
      }
    });

    it('has unique IDs', () => {
      const ids = CLS_BREAKDOWNS.map((b) => b.id);
      assert.strictEqual(new Set(ids).size, ids.length, 'All IDs should be unique');
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
  });
});
