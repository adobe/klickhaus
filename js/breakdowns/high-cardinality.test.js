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
import { loadBreakdown, loadAllBreakdowns, resetFacetTimings } from './index.js';
import { DEFAULT_TOP_N } from '../constants.js';
import { startRequestContext } from '../request-context.js';
import { setQueryTimestamp } from '../time.js';

// SQL templates used by loadBreakdown
const BREAKDOWN_SQL_TEMPLATE = 'SELECT\n  {{col}} as dim,\n  {{aggTotal}} as cnt,\n  {{aggOk}} as cnt_ok,\n  {{agg4xx}} as cnt_4xx,\n  {{agg5xx}} as cnt_5xx{{summaryCol}}\nFROM {{database}}.{{table}}\nWHERE {{timeFilter}} {{hostFilter}} {{facetFilters}} {{extra}} {{additionalWhereClause}}\nGROUP BY dim WITH TOTALS\nORDER BY {{orderBy}}\nLIMIT {{topN}}\n';

function createMockFetch(queryResponse = {
  data: [{
    dim: 'test', cnt: '100', cnt_ok: '90', cnt_4xx: '8', cnt_5xx: '2',
  }],
  totals: {
    cnt: '100', cnt_ok: '90', cnt_4xx: '8', cnt_5xx: '2',
  },
}) {
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    if (typeof url === 'string' && url.endsWith('.sql')) {
      return { ok: true, text: async () => BREAKDOWN_SQL_TEMPLATE };
    }
    if (options && options.method === 'POST') {
      return {
        ok: true,
        json: async () => ({ ...queryResponse, networkTime: 42 }),
      };
    }
    return { ok: false, status: 404 };
  };
  return { fetch: mockFetch, calls };
}

function createCard(id, title) {
  let card = document.getElementById(id);
  if (card) {
    card.remove();
  }
  card = document.createElement('div');
  card.id = id;
  const h3 = document.createElement('h3');
  h3.textContent = title;
  card.appendChild(h3);
  document.body.appendChild(card);
  return card;
}

beforeEach(() => {
  state.breakdowns = null;
  state.filters = [];
  state.hiddenFacets = [];
  state.hostFilter = '';
  state.additionalWhereClause = '';
  state.contentTypeMode = 'count';
  state.topN = DEFAULT_TOP_N;
  state.aggregations = null;
  state.tableName = 'delivery';
  state.credentials = { user: 'test', password: 'test' };
  state.timeRange = '1h';
  state.pinnedFacets = [];
  setQueryTimestamp(new Date('2025-06-01T12:00:00Z'));
  startRequestContext('facets');
  resetFacetTimings();
});

describe('high-cardinality breakdowns use regular GROUP BY', () => {
  const hcId = 'breakdown-high-card-test';
  let card;
  let originalFetch;

  beforeEach(() => {
    originalFetch = window.fetch;
    card = createCard(hcId, 'High Cardinality');
  });

  afterEach(() => {
    window.fetch = originalFetch;
    state.breakdowns = null;
    if (card && card.parentNode) {
      card.remove();
    }
  });

  it('uses GROUP BY WITH TOTALS for high-cardinality breakdowns', async () => {
    const { fetch: mockFetch, calls } = createMockFetch();
    window.fetch = mockFetch;

    const b = { id: hcId, col: '`message`', highCardinality: true };
    const ctx = startRequestContext('facets');
    await loadBreakdown(b, '1=1', '', ctx);

    const queryCalls = calls.filter((c) => c.options?.method === 'POST');
    assert.isAbove(queryCalls.length, 0, 'should send query');
    const queryBody = queryCalls[0].options.body;
    assert.include(queryBody, 'GROUP BY dim WITH TOTALS', 'should use regular GROUP BY');
    assert.notInclude(queryBody, 'approx_top_count', 'should not use approx_top_count');
  });

  it('uses GROUP BY WITH TOTALS for non-high-cardinality breakdowns', async () => {
    const { fetch: mockFetch, calls } = createMockFetch();
    window.fetch = mockFetch;

    const b = { id: hcId, col: '`source`' };
    const ctx = startRequestContext('facets');
    await loadBreakdown(b, '1=1', '', ctx);

    const queryCalls = calls.filter((c) => c.options?.method === 'POST');
    assert.isAbove(queryCalls.length, 0, 'should send query');
    const queryBody = queryCalls[0].options.body;
    assert.include(queryBody, 'GROUP BY dim WITH TOTALS', 'should use regular GROUP BY');
  });

  it('uses GROUP BY WITH TOTALS via loadAllBreakdowns', async () => {
    state.breakdowns = [{ id: hcId, col: '`message`', highCardinality: true }];
    const { fetch: mockFetch, calls } = createMockFetch();
    window.fetch = mockFetch;

    await loadAllBreakdowns(startRequestContext('facets'));

    const queryCalls = calls.filter((c) => c.options?.method === 'POST');
    assert.isAbove(queryCalls.length, 0, 'should send query');
    const queryBody = queryCalls[0].options.body;
    assert.include(queryBody, 'GROUP BY dim WITH TOTALS', 'should use regular GROUP BY');
    assert.notInclude(queryBody, 'approx_top_count', 'should not use approx_top_count');
  });
});
