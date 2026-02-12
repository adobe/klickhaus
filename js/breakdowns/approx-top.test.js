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
import { loadBreakdown, loadAllBreakdownsRefined, resetFacetTimings } from './index.js';
import { DEFAULT_TOP_N } from '../constants.js';
import { startRequestContext } from '../request-context.js';
import { setQueryTimestamp } from '../time.js';

// SQL templates used by loadBreakdown
const BREAKDOWN_SQL_TEMPLATE = 'SELECT\n  {{col}} as dim,\n  {{aggTotal}} as cnt,\n  {{aggOk}} as cnt_ok,\n  {{agg4xx}} as cnt_4xx,\n  {{agg5xx}} as cnt_5xx{{summaryCol}}\nFROM {{database}}.{{table}}\n{{sampleClause}}\nWHERE {{timeFilter}} {{hostFilter}} {{facetFilters}} {{extra}} {{additionalWhereClause}}\nGROUP BY dim WITH TOTALS\nORDER BY {{orderBy}}\nLIMIT {{topN}}\n';

const APPROX_TOP_SQL_TEMPLATE = 'WITH top_dims AS (\n  SELECT tupleElement(pair, 1) AS dim\n  FROM (\n    SELECT arrayJoin(approx_top_count({{topN}})({{col}})) AS pair\n    FROM {{database}}.{{table}}\n    {{sampleClause}}\n    WHERE {{timeFilter}} {{hostFilter}} {{extra}} {{additionalWhereClause}}\n  )\n)\nSELECT {{col}} AS dim, {{aggTotal}} AS cnt, {{aggOk}} AS cnt_ok,\n  {{agg4xx}} AS cnt_4xx, {{agg5xx}} AS cnt_5xx{{summaryCol}}\nFROM {{database}}.{{table}}\nWHERE {{timeFilter}} {{hostFilter}} {{extra}} {{additionalWhereClause}}\n  AND {{col}} IN (SELECT dim FROM top_dims)\nGROUP BY dim\nORDER BY cnt DESC\nLIMIT {{topN}}\nUNION ALL\nSELECT \'\' AS dim, {{aggTotal}} AS cnt, {{aggOk}} AS cnt_ok,\n  {{agg4xx}} AS cnt_4xx, {{agg5xx}} AS cnt_5xx{{summaryCol}}\nFROM {{database}}.{{table}}\nWHERE {{timeFilter}} {{hostFilter}} {{extra}} {{additionalWhereClause}}\n';

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
      let template = BREAKDOWN_SQL_TEMPLATE;
      if (url.includes('breakdown-approx-top.sql')) template = APPROX_TOP_SQL_TEMPLATE;
      return { ok: true, text: async () => template };
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
  if (card) card.remove();
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
  state.tableName = 'cdn_requests_v2';
  state.credentials = { user: 'test', password: 'test' };
  state.timeRange = '1h';
  state.pinnedFacets = [];
  setQueryTimestamp(new Date('2025-06-01T12:00:00Z'));
  startRequestContext('facets');
  resetFacetTimings();
});

describe('approx_top_count refinement for high-cardinality breakdowns', () => {
  const approxId = 'breakdown-approx-top-test';
  let card;
  let originalFetch;

  beforeEach(() => {
    originalFetch = window.fetch;
    card = createCard(approxId, 'Approx Top');
  });

  afterEach(() => {
    window.fetch = originalFetch;
    state.breakdowns = null;
    if (card && card.parentNode) card.remove();
  });

  it('uses approx_top_count for high-cardinality refinement', async () => {
    const { fetch: mockFetch, calls } = createMockFetch({
      data: [
        {
          dim: 'msg-a', cnt: '500', cnt_ok: '500', cnt_4xx: '0', cnt_5xx: '0',
        },
        {
          dim: '', cnt: '1000', cnt_ok: '900', cnt_4xx: '80', cnt_5xx: '20',
        },
      ],
      totals: {},
    });
    window.fetch = mockFetch;

    const b = { id: approxId, col: '`message`', highCardinality: true };
    const ctx = startRequestContext('facets');
    await loadBreakdown(b, '1=1', '', ctx, { sampleClause: '', multiplier: 1 });

    const queryCalls = calls.filter((c) => c.options?.method === 'POST');
    assert.isAbove(queryCalls.length, 0, 'should send query');
    const queryBody = queryCalls[0].options.body;
    assert.include(queryBody, 'approx_top_count', 'should use approx_top_count');
    assert.include(queryBody, 'UNION ALL', 'should include UNION ALL for totals');
  });

  it('extracts dim="" row as totals from UNION ALL result', async () => {
    const { fetch: mockFetch } = createMockFetch({
      data: [
        {
          dim: 'msg-a', cnt: '500', cnt_ok: '450', cnt_4xx: '40', cnt_5xx: '10',
        },
        {
          dim: 'msg-b', cnt: '300', cnt_ok: '280', cnt_4xx: '15', cnt_5xx: '5',
        },
        {
          dim: '', cnt: '1000', cnt_ok: '900', cnt_4xx: '80', cnt_5xx: '20',
        },
      ],
      totals: {},
    });
    window.fetch = mockFetch;

    const b = { id: approxId, col: '`message`', highCardinality: true };
    const ctx = startRequestContext('facets');
    await loadBreakdown(b, '1=1', '', ctx, { sampleClause: '', multiplier: 1 });

    // The totals row (dim='') should be extracted, not displayed as data
    const rows = card.querySelectorAll('tr');
    const dimCells = Array.from(rows).map((r) => r.querySelector('td')?.textContent).filter(Boolean);
    assert.notInclude(dimCells, '', 'totals row should not appear as data');
  });

  it('does not use approx-top for non-high-cardinality refinement', async () => {
    const { fetch: mockFetch, calls } = createMockFetch();
    window.fetch = mockFetch;

    const b = { id: approxId, col: '`source`' };
    const ctx = startRequestContext('facets');
    await loadBreakdown(b, '1=1', '', ctx, { sampleClause: '', multiplier: 1 });

    const queryCalls = calls.filter((c) => c.options?.method === 'POST');
    assert.isAbove(queryCalls.length, 0, 'should send query');
    const queryBody = queryCalls[0].options.body;
    assert.notInclude(queryBody, 'approx_top_count', 'should not use approx_top_count');
    assert.include(queryBody, 'GROUP BY dim WITH TOTALS', 'should use regular GROUP BY');
  });

  it('does not use approx-top for initial sampled load', async () => {
    const { fetch: mockFetch, calls } = createMockFetch();
    window.fetch = mockFetch;

    const b = { id: approxId, col: '`message`', highCardinality: true };
    const ctx = startRequestContext('facets');
    await loadBreakdown(b, '1=1', '', ctx, { sampleClause: 'SAMPLE 0.01', multiplier: 100 });

    const queryCalls = calls.filter((c) => c.options?.method === 'POST');
    assert.isAbove(queryCalls.length, 0, 'should send query');
    const queryBody = queryCalls[0].options.body;
    assert.notInclude(queryBody, 'approx_top_count', 'should not use approx_top_count');
    assert.include(queryBody, 'SAMPLE 0.01', 'should use sampling');
  });

  it('uses approx-top via loadAllBreakdownsRefined', async () => {
    state.breakdowns = [{ id: approxId, col: '`message`', highCardinality: true }];
    const { fetch: mockFetch, calls } = createMockFetch({
      data: [
        {
          dim: 'msg-a', cnt: '500', cnt_ok: '500', cnt_4xx: '0', cnt_5xx: '0',
        },
        {
          dim: '', cnt: '1000', cnt_ok: '900', cnt_4xx: '80', cnt_5xx: '20',
        },
      ],
      totals: {},
    });
    window.fetch = mockFetch;

    await loadAllBreakdownsRefined(startRequestContext('facets'));

    const queryCalls = calls.filter((c) => c.options?.method === 'POST');
    assert.isAbove(queryCalls.length, 0, 'should send query');
    const queryBody = queryCalls[0].options.body;
    assert.include(queryBody, 'approx_top_count', 'should use approx_top_count');
    assert.include(queryBody, 'UNION ALL', 'should include UNION ALL for totals');
  });
});
