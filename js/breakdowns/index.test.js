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
import { state } from '../state.js';
import {
  getBreakdowns,
  resetFacetTimings,
  getFacetFilters,
  getFacetFiltersExcluding,
  markSlowestFacet,
  increaseTopN,
  loadBreakdown,
  canUseFacetTable,
  facetTimings,
  isPreviewActive,
  loadPreviewBreakdowns,
  revertPreviewBreakdowns,
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
    TOP_N_OPTIONS.forEach((n) => {
      const opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = String(n);
      topNSelectEl.appendChild(opt);
    });
    topNSelectEl.value = String(first);
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

describe('canUseFacetTable', () => {
  beforeEach(() => {
    state.hostFilter = '';
    state.filters = [];
    state.additionalWhereClause = '';
  });

  it('returns true for a simple facet with facetName and no filters', () => {
    const b = { id: 'breakdown-status-range', col: 'x', facetName: 'status_range' };
    assert.isTrue(canUseFacetTable(b));
  });

  it('returns false when facetName is missing', () => {
    const b = { id: 'breakdown-push-invalidation', col: 'x' };
    assert.isFalse(canUseFacetTable(b));
  });

  it('returns false for bucketed facets (rawCol set)', () => {
    const b = {
      id: 'breakdown-time-elapsed', col: () => 'x', facetName: 'time_elapsed', rawCol: '`cdn.time_elapsed_msec`',
    };
    assert.isFalse(canUseFacetTable(b));
  });

  it('returns false when host filter is active', () => {
    state.hostFilter = 'example.com';
    const b = { id: 'breakdown-status-range', col: 'x', facetName: 'status_range' };
    assert.isFalse(canUseFacetTable(b));
  });

  it('returns false when facet filters are active', () => {
    state.filters = [{ col: '`request.host`', value: 'a.com', exclude: false }];
    const b = { id: 'breakdown-status-range', col: 'x', facetName: 'status_range' };
    assert.isFalse(canUseFacetTable(b));
  });

  it('returns false for ASN breakdown (dictGet mismatch)', () => {
    const b = { id: 'breakdown-asn', col: 'x', facetName: 'asn' };
    assert.isFalse(canUseFacetTable(b));
  });

  it('returns false when bytes mode is active', () => {
    state.contentTypeMode = 'bytes';
    const b = {
      id: 'breakdown-content-types', col: 'x', facetName: 'content_type', modeToggle: 'contentTypeMode',
    };
    assert.isFalse(canUseFacetTable(b));
    state.contentTypeMode = 'count';
  });

  it('returns false when additionalWhereClause is set', () => {
    state.additionalWhereClause = "AND source = 'fastly'";
    const b = { id: 'breakdown-status-range', col: 'x', facetName: 'status_range' };
    assert.isFalse(canUseFacetTable(b));
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

describe('isPreviewActive', () => {
  it('returns false initially', () => {
    assert.isFalse(isPreviewActive());
  });
});

describe('revertPreviewBreakdowns', () => {
  it('is a no-op when preview is not active', async () => {
    // Add a card with .preview class to verify the guard skips DOM changes
    const testCard = document.createElement('div');
    testCard.className = 'breakdown-card preview';
    document.body.appendChild(testCard);

    assert.isFalse(isPreviewActive());
    await revertPreviewBreakdowns();

    // Card should still have .preview class since guard returned early
    assert.isTrue(testCard.classList.contains('preview'));
    testCard.remove();
  });
});

describe('loadPreviewBreakdowns', () => {
  const previewFacetId = 'breakdown-preview-test';
  let previewCard;

  beforeEach(() => {
    previewCard = document.createElement('div');
    previewCard.id = previewFacetId;
    previewCard.className = 'breakdown-card';
    document.body.appendChild(previewCard);
    // Use a single hidden breakdown to prevent actual queries
    state.hiddenFacets = [previewFacetId];
    state.breakdowns = [{ id: previewFacetId, col: '`level`' }];
  });

  afterEach(async () => {
    // Clean up preview state if active
    if (isPreviewActive()) {
      // Force previewActive to false by calling revert (which will
      // try loadAllBreakdowns, but hidden facets cause early return)
      await revertPreviewBreakdowns();
    }
    previewCard.remove();
    state.breakdowns = null;
    state.hiddenFacets = [];
  });

  it('sets preview active flag', async () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2025-01-01T00:30:00Z');
    await loadPreviewBreakdowns(start, end);
    assert.isTrue(isPreviewActive());
  });

  it('skips hidden facets without adding preview class', async () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2025-01-01T00:30:00Z');
    await loadPreviewBreakdowns(start, end);
    // Hidden facets should not get the preview class
    assert.isFalse(previewCard.classList.contains('preview'));
  });

  it('revert clears preview active flag and removes preview class', async () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2025-01-01T00:30:00Z');
    await loadPreviewBreakdowns(start, end);
    assert.isTrue(isPreviewActive());

    // Manually add .preview class to simulate what non-hidden facets would have
    previewCard.classList.add('preview');

    await revertPreviewBreakdowns();
    assert.isFalse(isPreviewActive());
    assert.isFalse(previewCard.classList.contains('preview'));
  });

  it('revert cancels in-flight preview requests', async () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2025-01-01T00:30:00Z');
    await loadPreviewBreakdowns(start, end);

    // Calling revert should not throw even if there were in-flight requests
    await revertPreviewBreakdowns();
    assert.isFalse(isPreviewActive());
  });
});
