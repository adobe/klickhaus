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
  renderBreakdownError,
} from './render.js';
import { TOP_N_OPTIONS } from '../constants.js';

beforeEach(() => {
  state.filters = [];
  state.pinnedFacets = [];
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
