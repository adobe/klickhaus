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
import { state } from '../state.js';
import {
  getBreakdowns,
  resetFacetTimings,
  getFacetFilters,
  getFacetFiltersExcluding,
  facetTimings,
} from './index.js';
import { allBreakdowns } from './definitions.js';
import { lambdaBreakdowns } from './definitions-lambda.js';

beforeEach(() => {
  state.breakdowns = null;
  state.filters = [];
});

describe('getBreakdowns', () => {
  it('returns default breakdowns when state.breakdowns is null', () => {
    state.breakdowns = null;
    const result = getBreakdowns();
    assert.strictEqual(result, allBreakdowns);
    assert.isAbove(result.length, 5);
  });

  it('returns default breakdowns when state.breakdowns is empty array', () => {
    state.breakdowns = [];
    const result = getBreakdowns();
    assert.strictEqual(result, allBreakdowns);
  });

  it('returns state.breakdowns when set', () => {
    state.breakdowns = lambdaBreakdowns;
    const result = getBreakdowns();
    assert.strictEqual(result, lambdaBreakdowns);
    assert.strictEqual(result.length, 6);
  });
});

describe('resetFacetTimings', () => {
  it('clears all keys from facetTimings', () => {
    facetTimings['breakdown-level'] = 100;
    facetTimings['breakdown-host'] = 200;
    resetFacetTimings();
    assert.strictEqual(Object.keys(facetTimings).length, 0);
  });
});

describe('getFacetFilters', () => {
  it('returns empty SQL when no filters', () => {
    state.filters = [];
    const sql = getFacetFilters();
    assert.strictEqual(sql, '');
  });

  it('returns SQL for single include filter', () => {
    state.filters = [{ col: '`request.host`', value: 'example.com', exclude: false }];
    const sql = getFacetFilters();
    assert.ok(sql.includes("`request.host` = 'example.com'"));
  });
});

describe('getFacetFiltersExcluding', () => {
  it('omits filter for given column', () => {
    state.filters = [
      { col: '`request.host`', value: 'a.com', exclude: false },
      { col: '`request.method`', value: 'GET', exclude: false },
    ];
    const sql = getFacetFiltersExcluding('`request.host`');
    assert.ok(sql.includes("`request.method` = 'GET'"));
    assert.notInclude(sql, 'a.com');
  });
});
