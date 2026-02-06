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
  markSlowestFacet,
  increaseTopN,
  loadBreakdown,
  facetTimings,
} from './index.js';
import { allBreakdowns } from './definitions.js';
import { lambdaBreakdowns } from './definitions-lambda.js';
import { TOP_N_OPTIONS } from '../constants.js';

beforeEach(() => {
  state.breakdowns = null;
  state.filters = [];
  state.hiddenFacets = [];
  resetFacetTimings();
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

describe('markSlowestFacet', () => {
  let queryTimerEl;
  let facetCard;

  beforeEach(() => {
    queryTimerEl = document.getElementById('queryTimer');
    if (!queryTimerEl) {
      queryTimerEl = document.createElement('span');
      queryTimerEl.id = 'queryTimer';
      document.body.appendChild(queryTimerEl);
    }
    facetCard = document.getElementById('breakdown-level');
    if (!facetCard) {
      facetCard = document.createElement('div');
      facetCard.id = 'breakdown-level';
      facetCard.dataset.title = 'Level';
      const h3 = document.createElement('h3');
      h3.textContent = 'Level';
      facetCard.appendChild(h3);
      document.body.appendChild(facetCard);
    }
  });

  afterEach(() => {
    if (facetTimings['breakdown-level'] !== undefined) delete facetTimings['breakdown-level'];
    if (facetTimings['breakdown-host'] !== undefined) delete facetTimings['breakdown-host'];
  });

  it('sets queryTimer title to slowest facet when facetTimings has entries', () => {
    facetTimings['breakdown-level'] = 150;
    facetTimings['breakdown-host'] = 80;
    markSlowestFacet();
    assert.include(queryTimerEl.title, 'Level');
    assert.include(queryTimerEl.title, '150');
  });

  it('clears queryTimer title when no facet timings', () => {
    queryTimerEl.title = 'previous';
    markSlowestFacet();
    assert.strictEqual(queryTimerEl.title, '');
  });
});

describe('increaseTopN', () => {
  it('updates state and select value when next option exists', () => {
    const [first, second] = TOP_N_OPTIONS;
    state.topN = first;
    const topNSelectEl = document.createElement('select');
    topNSelectEl.value = '5';
    let saveCalled = false;
    let loadCalled = false;
    increaseTopN(
      topNSelectEl,
      () => { saveCalled = true; },
      () => { loadCalled = true; },
    );
    assert.strictEqual(state.topN, second);
    assert.strictEqual(topNSelectEl.value, String(second));
    assert.isTrue(saveCalled);
    assert.isTrue(loadCalled);
  });

  it('does not call save or load when already at max topN', () => {
    const last = TOP_N_OPTIONS.at(-1);
    state.topN = last;
    const topNSelectEl = document.createElement('select');
    topNSelectEl.value = '100';
    let saveCalled = false;
    let loadCalled = false;
    increaseTopN(
      topNSelectEl,
      () => { saveCalled = true; },
      () => { loadCalled = true; },
    );
    assert.isFalse(saveCalled);
    assert.isFalse(loadCalled);
  });
});

describe('loadBreakdown', () => {
  const hiddenFacetId = 'breakdown-hidden-facet-test';
  let card;

  beforeEach(() => {
    card = document.getElementById(hiddenFacetId);
    if (!card) {
      card = document.createElement('div');
      card.id = hiddenFacetId;
      const h3 = document.createElement('h3');
      h3.textContent = 'Hidden Facet';
      card.appendChild(h3);
      document.body.appendChild(card);
    }
  });

  afterEach(() => {
    if (card && card.parentNode) {
      card.remove();
    }
    state.hiddenFacets = [];
  });

  it('renders hidden facet and returns early when facet is in hiddenFacets', async () => {
    state.hiddenFacets = [hiddenFacetId];
    const b = { id: hiddenFacetId, col: '`level`' };
    await loadBreakdown(b, '1=1', '');
    assert.isTrue(card.classList.contains('facet-hidden'));
    assert.include(card.innerHTML, 'Hidden Facet');
    assert.include(card.innerHTML, 'facet-hide-btn');
    assert.include(card.innerHTML, 'Show facet');
  });
});
