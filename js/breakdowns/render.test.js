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
  getFiltersForColumn,
  getNextTopN,
  renderBreakdownTable,
  renderBreakdownError,
} from './render.js';
import { TOP_N_OPTIONS } from '../constants.js';

beforeEach(() => {
  state.filters = [];
  state.pinnedFacets = [];
  state.contentTypeMode = 'count';
});

describe('getFiltersForColumn', () => {
  it('returns empty array when no filters', () => {
    state.filters = [];
    assert.deepEqual(getFiltersForColumn('`request.host`'), []);
  });

  it('returns only filters matching the column', () => {
    state.filters = [
      { col: '`request.host`', value: 'a.com', exclude: false },
      { col: '`request.method`', value: 'GET', exclude: false },
      { col: '`request.host`', value: 'b.com', exclude: true },
    ];
    const result = getFiltersForColumn('`request.host`');
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].value, 'a.com');
    assert.strictEqual(result[1].value, 'b.com');
  });

  it('returns empty array when column has no filters', () => {
    state.filters = [{ col: '`request.method`', value: 'GET', exclude: false }];
    assert.deepEqual(getFiltersForColumn('`request.host`'), []);
  });
});

describe('getNextTopN', () => {
  it('returns next option when not at max', () => {
    const [first, second, third, fourth] = TOP_N_OPTIONS;
    state.topN = first;
    assert.strictEqual(getNextTopN(), second);
    state.topN = third;
    assert.strictEqual(getNextTopN(), fourth);
  });

  it('returns null when at max option', () => {
    state.topN = TOP_N_OPTIONS.at(-1);
    assert.strictEqual(getNextTopN(), null);
  });

  it('returns null when state.topN not in options', () => {
    state.topN = 99;
    assert.strictEqual(getNextTopN(), null);
  });
});

describe('renderBreakdownError', () => {
  let card;

  beforeEach(() => {
    card = document.getElementById('breakdown-test-error');
    if (!card) {
      card = document.createElement('div');
      card.id = 'breakdown-test-error';
      const h3 = document.createElement('h3');
      h3.textContent = 'Test Facet';
      card.appendChild(h3);
      document.body.appendChild(card);
    }
  });

  afterEach(() => {
    if (card && card.parentNode) {
      card.remove();
    }
  });

  it('renders error with default label and message', () => {
    renderBreakdownError('breakdown-test-error', {});
    assert.include(card.innerHTML, 'Query failed');
    assert.include(card.innerHTML, 'Error loading data');
    assert.include(card.innerHTML, 'Test Facet');
  });

  it('renders error with custom label and message', () => {
    renderBreakdownError('breakdown-test-error', {
      label: 'Connection failed',
      message: 'Timeout after 30s',
    });
    assert.include(card.innerHTML, 'Connection failed');
    assert.include(card.innerHTML, 'Timeout after 30s');
  });

  it('includes detail when provided', () => {
    renderBreakdownError('breakdown-test-error', {
      detail: 'Code: 241. Memory limit exceeded',
    });
    assert.include(card.innerHTML, 'facet-error-detail');
    assert.include(card.innerHTML, 'Memory limit exceeded');
  });

  it('includes meta when code, type, or status provided', () => {
    renderBreakdownError('breakdown-test-error', {
      code: 241,
      type: 'MEMORY_LIMIT_EXCEEDED',
      status: 500,
    });
    assert.include(card.innerHTML, 'facet-error-meta');
    assert.include(card.innerHTML, 'Code 241');
    assert.include(card.innerHTML, 'MEMORY_LIMIT_EXCEEDED');
    assert.include(card.innerHTML, 'HTTP 500');
  });

  it('uses card dataset.title when h3 not present', () => {
    card.innerHTML = '';
    card.dataset.title = 'Custom Title';
    card.id = 'breakdown-test-error';
    document.body.appendChild(card);

    renderBreakdownError('breakdown-test-error', {});
    assert.include(card.innerHTML, 'Custom Title');
  });
});

describe('renderBreakdownTable', () => {
  const cardId = 'breakdown-render-table-test';
  let card;

  beforeEach(() => {
    card = document.getElementById(cardId);
    if (!card) {
      card = document.createElement('div');
      card.id = cardId;
      const h3 = document.createElement('h3');
      h3.textContent = 'Test Table';
      card.appendChild(h3);
      document.body.appendChild(card);
    }
  });

  afterEach(() => {
    if (card && card.parentNode) {
      card.remove();
    }
  });

  it('renders empty state when data length is 0', () => {
    renderBreakdownTable(
      cardId,
      [],
      null,
      '`request.host`',
      null,
      null,
      null,
      100,
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      null,
      null,
      null,
    );
    assert.include(card.innerHTML, 'No data');
    assert.include(card.innerHTML, 'Test Table');
    assert.include(card.innerHTML, 'empty');
  });

  it('renders empty state with clear button when column has filters', () => {
    state.filters = [{ col: '`request.host`', value: 'example.com', exclude: false }];
    renderBreakdownTable(
      cardId,
      [],
      null,
      '`request.host`',
      null,
      null,
      null,
      100,
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      null,
      null,
      null,
    );
    assert.include(card.innerHTML, 'clear-facet-btn');
    assert.include(card.innerHTML, 'Clear');
  });

  it('renders table with data and stores facet data on card', () => {
    const data = [
      {
        dim: 'a.com', cnt: 100, cnt_ok: 98, cnt_4xx: 1, cnt_5xx: 1,
      },
      {
        dim: 'b.com', cnt: 50, cnt_ok: 50, cnt_4xx: 0, cnt_5xx: 0,
      },
    ];
    const totals = {
      cnt: 150, cnt_ok: 148, cnt_4xx: 1, cnt_5xx: 1, summary_cnt: 0,
    };
    renderBreakdownTable(
      cardId,
      data,
      totals,
      '`request.host`',
      null,
      null,
      null,
      500,
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      null,
      null,
      null,
    );
    assert.include(card.innerHTML, 'breakdown-table');
    assert.include(card.innerHTML, 'a.com');
    assert.include(card.innerHTML, 'b.com');
    assert.ok(card.dataset.facetData);
    const stored = JSON.parse(card.dataset.facetData);
    assert.strictEqual(stored.data.length, 2);
    assert.strictEqual(stored.totals.cnt, 150);
  });

  it('uses fast speed class when elapsed < 2500', () => {
    const data = [{
      dim: 'x', cnt: 1, cnt_ok: 1, cnt_4xx: 0, cnt_5xx: 0,
    }];
    const totals = {
      cnt: 1, cnt_ok: 1, cnt_4xx: 0, cnt_5xx: 0,
    };
    renderBreakdownTable(
      cardId,
      data,
      totals,
      '`col`',
      null,
      null,
      null,
      1000,
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      null,
      null,
      null,
    );
    assert.include(card.innerHTML, 'speed-indicator fast');
  });

  it('uses medium speed class when elapsed 2500–4000', () => {
    const data = [{
      dim: 'x', cnt: 1, cnt_ok: 1, cnt_4xx: 0, cnt_5xx: 0,
    }];
    const totals = {
      cnt: 1, cnt_ok: 1, cnt_4xx: 0, cnt_5xx: 0,
    };
    renderBreakdownTable(
      cardId,
      data,
      totals,
      '`col`',
      null,
      null,
      null,
      3000,
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      null,
      null,
      null,
    );
    assert.include(card.innerHTML, 'speed-indicator medium');
  });

  it('uses slow speed class when elapsed >= 4000', () => {
    const data = [{
      dim: 'x', cnt: 1, cnt_ok: 1, cnt_4xx: 0, cnt_5xx: 0,
    }];
    const totals = {
      cnt: 1, cnt_ok: 1, cnt_4xx: 0, cnt_5xx: 0,
    };
    renderBreakdownTable(
      cardId,
      data,
      totals,
      '`col`',
      null,
      null,
      null,
      5000,
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      null,
      null,
      null,
    );
    assert.include(card.innerHTML, 'speed-indicator slow');
  });

  it('renders mode toggle and summary when provided', () => {
    const data = [{
      dim: 'x', cnt: 10, cnt_ok: 8, cnt_4xx: 1, cnt_5xx: 1,
    }];
    const totals = {
      cnt: 10, cnt_ok: 8, cnt_4xx: 1, cnt_5xx: 1, summary_cnt: 1,
    };
    state.contentTypeMode = 'count';
    renderBreakdownTable(
      cardId,
      data,
      totals,
      '`col`',
      null,
      null,
      null,
      100,
      null,
      null,
      0.2,
      'error rate',
      'error',
      'contentTypeMode',
      false,
      null,
      null,
      null,
    );
    assert.include(card.innerHTML, 'mode-toggle');
    assert.include(card.innerHTML, 'summary-metric');
    assert.include(card.innerHTML, '20%');
  });

  it('renders pinned facet title in speed indicator', () => {
    state.pinnedFacets = [cardId];
    const data = [{
      dim: 'x', cnt: 1, cnt_ok: 1, cnt_4xx: 0, cnt_5xx: 0,
    }];
    const totals = {
      cnt: 1, cnt_ok: 1, cnt_4xx: 0, cnt_5xx: 0,
    };
    renderBreakdownTable(
      cardId,
      data,
      totals,
      '`col`',
      null,
      null,
      null,
      100,
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      null,
      null,
      null,
    );
    assert.include(card.innerHTML, 'Unpin facet');
  });

  it('renders bytes mode when modeToggle is set and state is bytes', () => {
    state.contentTypeMode = 'bytes';
    const data = [{
      dim: 'x', cnt: 1024, cnt_ok: 1024, cnt_4xx: 0, cnt_5xx: 0,
    }];
    const totals = {
      cnt: 1024, cnt_ok: 1024, cnt_4xx: 0, cnt_5xx: 0,
    };
    renderBreakdownTable(
      cardId,
      data,
      totals,
      '`col`',
      null,
      null,
      null,
      100,
      null,
      null,
      null,
      null,
      null,
      'contentTypeMode',
      false,
      null,
      null,
      null,
    );
    assert.include(card.innerHTML, 'mode-toggle active');
    assert.ok(card.dataset.facetData);
    const stored = JSON.parse(card.dataset.facetData);
    assert.strictEqual(stored.mode, 'bytes');
  });
});
