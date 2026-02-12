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
} from './index.js';
import { allBreakdowns } from './definitions.js';
import { lambdaBreakdowns } from './definitions-lambda.js';
import { TOP_N_OPTIONS, DEFAULT_TOP_N } from '../constants.js';
import { startRequestContext } from '../request-context.js';
import { setQueryTimestamp } from '../time.js';

// SQL templates used by loadBreakdown
const BREAKDOWN_SQL_TEMPLATE = 'SELECT\n  {{col}} as dim,\n  {{aggTotal}} as cnt,\n  {{aggOk}} as cnt_ok,\n  {{agg4xx}} as cnt_4xx,\n  {{agg5xx}} as cnt_5xx{{summaryCol}}\nFROM {{database}}.{{table}}\n{{sampleClause}}\nWHERE {{timeFilter}} {{hostFilter}} {{facetFilters}} {{extra}} {{additionalWhereClause}}\nGROUP BY dim WITH TOTALS\nORDER BY {{orderBy}}\nLIMIT {{topN}}\n';

const FACET_SQL_TEMPLATE = 'SELECT\n  dim,\n  sum(cnt) as cnt,\n  sum(cnt_ok) as cnt_ok,\n  sum(cnt_4xx) as cnt_4xx,\n  sum(cnt_5xx) as cnt_5xx{{summaryCol}}\nFROM (\n  SELECT dim, cnt, cnt_ok, cnt_4xx, cnt_5xx{{innerSummaryCol}}\n  FROM {{database}}.cdn_facet_minutes\n  WHERE facet = \'{{facetName}}\'\n    AND minute >= toDateTime(\'{{startTime}}\')\n    AND minute <= toDateTime(\'{{endTime}}\')\n    {{dimFilter}}\n)\nGROUP BY dim WITH TOTALS\nORDER BY {{orderBy}}\nLIMIT {{topN}}\n';

const BUCKETED_SQL_TEMPLATE = 'SELECT\n  {{bucketExpr}} as dim,\n  sum(agg_total) as cnt,\n  sum(agg_ok) as cnt_ok,\n  sum(agg_4xx) as cnt_4xx,\n  sum(agg_5xx) as cnt_5xx{{outerSummaryCol}}\nFROM (\n  SELECT\n    {{rawCol}} as val,\n    {{aggTotal}} as agg_total,\n    {{aggOk}} as agg_ok,\n    {{agg4xx}} as agg_4xx,\n    {{agg5xx}} as agg_5xx{{innerSummaryCol}}\n  FROM {{database}}.{{table}}\n  {{sampleClause}}\n  WHERE {{timeFilter}} {{hostFilter}} {{facetFilters}} {{extra}} {{additionalWhereClause}}\n  GROUP BY val\n)\nGROUP BY dim WITH TOTALS\nORDER BY min(val)\nLIMIT {{topN}}\n';

/**
 * Create a mock fetch that returns SQL templates and ClickHouse query results.
 * @param {object} [queryResponse] - The JSON to return for ClickHouse query POSTs
 * @returns {{ fetch: function, calls: Array }}
 */
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
    // SQL template requests (GET)
    if (typeof url === 'string' && url.endsWith('.sql')) {
      let template = BREAKDOWN_SQL_TEMPLATE;
      if (url.includes('breakdown-facet.sql')) template = FACET_SQL_TEMPLATE;
      else if (url.includes('breakdown-bucketed.sql')) template = BUCKETED_SQL_TEMPLATE;
      return { ok: true, text: async () => template };
    }
    // ClickHouse API POST requests
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

/**
 * Create a DOM card element for a breakdown facet.
 */
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

describe('loadBreakdown (facet table path)', () => {
  const facetId = 'breakdown-facet-table-test';
  let card;
  let originalFetch;

  beforeEach(() => {
    originalFetch = window.fetch;
    card = createCard(facetId, 'Facet Table Test');
    state.hostFilter = '';
    state.filters = [];
    state.additionalWhereClause = '';
  });

  afterEach(() => {
    window.fetch = originalFetch;
    if (card && card.parentNode) card.remove();
  });

  it('renders breakdown table via facet table path when canUseFacetTable is true', async () => {
    const { fetch: mockFetch, calls } = createMockFetch();
    window.fetch = mockFetch;

    const b = {
      id: facetId, col: '`source`', facetName: 'source',
    };
    const ctx = startRequestContext('facets');
    await loadBreakdown(b, '1=1', '', ctx);

    // Should have fetched the facet SQL template
    const sqlCalls = calls.filter((c) => c.url.endsWith('.sql'));
    assert.isAbove(sqlCalls.length, 0, 'should fetch SQL template');
    assert.ok(sqlCalls.some((c) => c.url.includes('breakdown-facet.sql')), 'should use facet template');

    // Should have posted a query
    const queryCalls = calls.filter((c) => c.options?.method === 'POST');
    assert.isAbove(queryCalls.length, 0, 'should execute query');

    // Card should contain rendered table content
    assert.isFalse(card.classList.contains('updating'), 'should remove updating class');
    assert.isFalse(card.classList.contains('facet-hidden'), 'should not be hidden');
  });

  it('records timing in facetTimings', async () => {
    const { fetch: mockFetch } = createMockFetch();
    window.fetch = mockFetch;

    const b = {
      id: facetId, col: '`source`', facetName: 'source',
    };
    const ctx = startRequestContext('facets');
    await loadBreakdown(b, '1=1', '', ctx);

    assert.ok(facetTimings[facetId] !== undefined, 'should record timing');
    assert.isAbove(facetTimings[facetId], -1, 'timing should be a number');
  });

  it('renders summary ratio when summaryDimCondition is set', async () => {
    const { fetch: mockFetch } = createMockFetch({
      data: [
        {
          dim: '2xx', cnt: '80', cnt_ok: '80', cnt_4xx: '0', cnt_5xx: '0',
        },
        {
          dim: '5xx', cnt: '20', cnt_ok: '0', cnt_4xx: '0', cnt_5xx: '20',
        },
      ],
      totals: {
        cnt: '100', cnt_ok: '80', cnt_4xx: '0', cnt_5xx: '20', summary_cnt: '20',
      },
    });
    window.fetch = mockFetch;

    const b = {
      id: facetId,
      col: "concat(toString(intDiv(`response.status`, 100)), 'xx')",
      facetName: 'status_range',
      summaryCountIf: '`response.status` >= 500',
      summaryDimCondition: "dim = '5xx'",
      summaryLabel: 'error rate',
      summaryColor: 'error',
    };
    const ctx = startRequestContext('facets');
    await loadBreakdown(b, '1=1', '', ctx);

    // Card should have rendered (not hidden, not updating)
    assert.isFalse(card.classList.contains('updating'));
    // The summary metric should be rendered (20% error rate)
    assert.include(card.innerHTML, '20%');
  });
});

describe('loadBreakdown (raw table path)', () => {
  const rawId = 'breakdown-raw-table-test';
  let card;
  let originalFetch;

  beforeEach(() => {
    originalFetch = window.fetch;
    card = createCard(rawId, 'Raw Table Test');
  });

  afterEach(() => {
    window.fetch = originalFetch;
    if (card && card.parentNode) card.remove();
  });

  it('uses raw table with sampling when host filter prevents facet table', async () => {
    state.hostFilter = 'example.com';
    const { fetch: mockFetch, calls } = createMockFetch();
    window.fetch = mockFetch;

    const b = {
      id: rawId, col: '`source`', facetName: 'source',
    };
    const ctx = startRequestContext('facets');
    await loadBreakdown(b, '1=1', "AND (`request.host` LIKE '%example.com%')", ctx);

    // Should use regular breakdown template, not facet template
    const sqlCalls = calls.filter((c) => c.url.endsWith('.sql'));
    assert.ok(
      sqlCalls.some((c) => c.url.includes('breakdown.sql') && !c.url.includes('breakdown-facet')),
      'should use raw table breakdown template',
    );

    assert.isFalse(card.classList.contains('updating'));
  });

  it('uses raw table when filters are active', async () => {
    state.filters = [{ col: '`request.host`', value: 'a.com', exclude: false }];
    const { fetch: mockFetch, calls } = createMockFetch();
    window.fetch = mockFetch;

    const b = {
      id: rawId, col: '`source`', facetName: 'source',
    };
    const ctx = startRequestContext('facets');
    await loadBreakdown(b, '1=1', '', ctx);

    // Verify query uses raw table (cdn_requests_v2, not cdn_facet_minutes)
    const queryCalls = calls.filter((c) => c.options?.method === 'POST');
    assert.isAbove(queryCalls.length, 0, 'should send query');
    const queryBody = queryCalls[0].options.body;
    assert.include(queryBody, 'cdn_requests_v2', 'should query raw table');
    assert.notInclude(queryBody, 'cdn_facet_minutes', 'should not query facet table');
  });

  it('uses raw table for high-cardinality facets', async () => {
    const { fetch: mockFetch, calls } = createMockFetch();
    window.fetch = mockFetch;

    const b = {
      id: rawId, col: '`request.host`', facetName: 'host', highCardinality: true,
    };
    const ctx = startRequestContext('facets');
    await loadBreakdown(b, '1=1', '', ctx);

    const queryCalls = calls.filter((c) => c.options?.method === 'POST');
    assert.isAbove(queryCalls.length, 0, 'should send query');
    const queryBody = queryCalls[0].options.body;
    assert.include(queryBody, 'cdn_requests_v2', 'should query raw table for high-cardinality');
  });

  it('uses raw table for breakdown without facetName', async () => {
    const { fetch: mockFetch, calls } = createMockFetch();
    window.fetch = mockFetch;

    const b = {
      id: rawId,
      col: '`request.headers.x_push_invalidation`',
      extraFilter: "AND `request.headers.x_push_invalidation` != ''",
    };
    const ctx = startRequestContext('facets');
    await loadBreakdown(b, '1=1', '', ctx);

    const queryCalls = calls.filter((c) => c.options?.method === 'POST');
    assert.isAbove(queryCalls.length, 0, 'should send query');
    const queryBody = queryCalls[0].options.body;
    assert.include(queryBody, 'cdn_requests_v2', 'should query raw table');
    assert.include(queryBody, 'x_push_invalidation', 'should include the column');
  });

  it('handles breakdown with modeToggle in bytes mode', async () => {
    state.contentTypeMode = 'bytes';
    const { fetch: mockFetch, calls } = createMockFetch();
    window.fetch = mockFetch;

    const b = {
      id: rawId, col: '`response.headers.content_type`', facetName: 'content_type', modeToggle: 'contentTypeMode',
    };
    const ctx = startRequestContext('facets');
    await loadBreakdown(b, '1=1', '', ctx);

    // Verify it used raw table (bytes mode disables facet table)
    const queryCalls = calls.filter((c) => c.options?.method === 'POST');
    assert.isAbove(queryCalls.length, 0);
    const queryBody = queryCalls[0].options.body;
    assert.include(queryBody, 'cdn_requests_v2', 'should query raw table in bytes mode');
    assert.include(queryBody, 'response.headers.content_length', 'should use bytes aggregation');
  });
});

describe('loadBreakdown (bucketed facets)', () => {
  const bucketId = 'breakdown-bucketed-test';
  let card;
  let originalFetch;

  beforeEach(() => {
    originalFetch = window.fetch;
    card = createCard(bucketId, 'Bucketed Test');
  });

  afterEach(() => {
    window.fetch = originalFetch;
    if (card && card.parentNode) card.remove();
  });

  it('uses bucketed template for facets with rawCol and function col', async () => {
    const { fetch: mockFetch, calls } = createMockFetch({
      data: [
        {
          dim: '0-100ms', cnt: '50', cnt_ok: '50', cnt_4xx: '0', cnt_5xx: '0',
        },
        {
          dim: '100-500ms', cnt: '30', cnt_ok: '30', cnt_4xx: '0', cnt_5xx: '0',
        },
      ],
      totals: {
        cnt: '80', cnt_ok: '80', cnt_4xx: '0', cnt_5xx: '0',
      },
    });
    window.fetch = mockFetch;

    const b = {
      id: bucketId,
      col: (topN, alias) => `multiIf(${alias || '`cdn.time_elapsed_msec`'} < 100, '0-100ms', '100ms+')`,
      rawCol: '`cdn.time_elapsed_msec`',
      orderBy: 'min(`cdn.time_elapsed_msec`)',
    };
    const ctx = startRequestContext('facets');
    await loadBreakdown(b, '1=1', '', ctx);

    const sqlCalls = calls.filter((c) => c.url.endsWith('.sql'));
    assert.ok(
      sqlCalls.some((c) => c.url.includes('breakdown-bucketed.sql')),
      'should use bucketed template',
    );

    assert.isFalse(card.classList.contains('updating'));
  });

  it('fills expected labels for bucketed facets with getExpectedLabels', async () => {
    const expectedLabels = ['0-100ms', '100-500ms', '500ms-1s', '1-5s'];
    const { fetch: mockFetch } = createMockFetch({
      data: [
        {
          dim: '0-100ms', cnt: '50', cnt_ok: '50', cnt_4xx: '0', cnt_5xx: '0',
        },
      ],
      totals: {
        cnt: '50', cnt_ok: '50', cnt_4xx: '0', cnt_5xx: '0',
      },
    });
    window.fetch = mockFetch;

    const b = {
      id: bucketId,
      col: (topN, alias) => `multiIf(${alias || 'val'} < 100, '0-100ms', '100ms+')`,
      rawCol: '`cdn.time_elapsed_msec`',
      orderBy: 'min(`cdn.time_elapsed_msec`)',
      getExpectedLabels: () => expectedLabels,
    };
    const ctx = startRequestContext('facets');
    await loadBreakdown(b, '1=1', '', ctx);

    // The breakdown should render without error (fillExpectedLabels fills in missing labels)
    assert.isFalse(card.classList.contains('updating'));
  });
});

describe('loadBreakdown (error handling)', () => {
  const errorId = 'breakdown-error-test';
  let card;
  let originalFetch;

  beforeEach(() => {
    originalFetch = window.fetch;
    card = createCard(errorId, 'Error Test');
  });

  afterEach(() => {
    window.fetch = originalFetch;
    if (card && card.parentNode) card.remove();
  });

  it('renders error state when query fails', async () => {
    const calls = [];
    window.fetch = async (url, options) => {
      calls.push({ url, options });
      if (typeof url === 'string' && url.endsWith('.sql')) {
        return { ok: true, text: async () => BREAKDOWN_SQL_TEMPLATE };
      }
      if (options && options.method === 'POST') {
        return {
          ok: false,
          status: 500,
          text: async () => 'Code: 241. DB::Exception: Memory limit exceeded',
        };
      }
      return { ok: false, status: 404 };
    };

    const b = { id: errorId, col: '`source`' };
    const ctx = startRequestContext('facets');
    await loadBreakdown(b, '1=1', '', ctx);

    // Card should show error state
    assert.isFalse(card.classList.contains('updating'), 'should remove updating class after error');
    assert.include(card.innerHTML, 'error', 'should render error content');
  });

  it('silently ignores abort errors', async () => {
    window.fetch = async (url, options) => {
      if (typeof url === 'string' && url.endsWith('.sql')) {
        return { ok: true, text: async () => BREAKDOWN_SQL_TEMPLATE };
      }
      if (options && options.method === 'POST') {
        const abortErr = new DOMException('The operation was aborted.', 'AbortError');
        throw abortErr;
      }
      return { ok: false, status: 404 };
    };

    const b = { id: errorId, col: '`source`' };
    const ctx = startRequestContext('facets');
    // Should not throw
    await loadBreakdown(b, '1=1', '', ctx);
  });
});

describe('loadBreakdown (prepareBreakdownCard)', () => {
  const prepId = 'breakdown-prep-test';
  let card;
  let originalFetch;

  beforeEach(() => {
    originalFetch = window.fetch;
    card = createCard(prepId, 'Prep Test');
  });

  afterEach(() => {
    window.fetch = originalFetch;
    if (card && card.parentNode) card.remove();
  });

  it('adds updating class during load and removes it after', async () => {
    let resolveQuery;
    const queryPromise = new Promise((resolve) => {
      resolveQuery = resolve;
    });
    window.fetch = async (url, options) => {
      if (typeof url === 'string' && url.endsWith('.sql')) {
        return { ok: true, text: async () => BREAKDOWN_SQL_TEMPLATE };
      }
      if (options && options.method === 'POST') {
        await queryPromise;
        return {
          ok: true,
          json: async () => ({
            data: [{
              dim: 'x', cnt: '1', cnt_ok: '1', cnt_4xx: '0', cnt_5xx: '0',
            }],
            totals: {
              cnt: '1', cnt_ok: '1', cnt_4xx: '0', cnt_5xx: '0',
            },
            networkTime: 10,
          }),
        };
      }
      return { ok: false, status: 404 };
    };

    const b = { id: prepId, col: '`source`' };
    const ctx = startRequestContext('facets');
    const promise = loadBreakdown(b, '1=1', '', ctx);

    // Before query resolves, card should have 'updating'
    // (we need a microtask to let the async function reach the fetch)
    await new Promise((r) => {
      setTimeout(r, 10);
    });
    assert.isTrue(card.classList.contains('updating'), 'should add updating class during load');

    resolveQuery();
    await promise;
    assert.isFalse(card.classList.contains('updating'), 'should remove updating class after load');
  });

  it('removes data-action and facet-hidden when facet is not hidden', async () => {
    card.dataset.action = 'toggle-facet-hide';
    card.dataset.facet = prepId;
    card.classList.add('facet-hidden');
    const { fetch: mockFetch } = createMockFetch();
    window.fetch = mockFetch;

    const b = { id: prepId, col: '`source`' };
    const ctx = startRequestContext('facets');
    await loadBreakdown(b, '1=1', '', ctx);

    assert.isFalse(card.classList.contains('facet-hidden'), 'should remove facet-hidden');
    assert.isFalse(card.hasAttribute('data-action'), 'should remove data-action');
    assert.isFalse(card.hasAttribute('data-facet'), 'should remove data-facet');
  });
});

describe('loadBreakdown (custom aggregations)', () => {
  const customId = 'breakdown-custom-agg-test';
  let card;
  let originalFetch;

  beforeEach(() => {
    originalFetch = window.fetch;
    card = createCard(customId, 'Custom Agg');
  });

  afterEach(() => {
    window.fetch = originalFetch;
    state.aggregations = null;
    if (card && card.parentNode) card.remove();
  });

  it('uses custom aggregations from state when set', async () => {
    state.aggregations = {
      aggTotal: 'count()',
      aggOk: 'countIf(`level` = \'INFO\')',
      agg4xx: 'countIf(`level` = \'WARN\')',
      agg5xx: 'countIf(`level` = \'ERROR\')',
    };
    const { fetch: mockFetch, calls } = createMockFetch();
    window.fetch = mockFetch;

    const b = { id: customId, col: '`level`' };
    const ctx = startRequestContext('facets');
    await loadBreakdown(b, '1=1', '', ctx);

    const queryCalls = calls.filter((c) => c.options?.method === 'POST');
    assert.isAbove(queryCalls.length, 0);
    const queryBody = queryCalls[0].options.body;
    assert.include(queryBody, "countIf(`level` = 'INFO')", 'should use custom aggOk');
    assert.include(queryBody, "countIf(`level` = 'ERROR')", 'should use custom agg5xx');
  });
});

describe('loadBreakdown (renderHiddenFacet edge cases)', () => {
  const hiddenId = 'breakdown-hidden-edge-test';
  let card;

  beforeEach(() => {
    card = createCard(hiddenId, 'Edge Test');
  });

  afterEach(() => {
    if (card && card.parentNode) card.remove();
    state.hiddenFacets = [];
  });

  it('uses dataset.title if already set when rendering hidden facet', async () => {
    card.dataset.title = 'Custom Title';
    state.hiddenFacets = [hiddenId];

    const b = { id: hiddenId, col: '`source`' };
    await loadBreakdown(b, '1=1', '');

    assert.include(card.innerHTML, 'Custom Title');
    assert.isTrue(card.classList.contains('facet-hidden'));
  });

  it('falls back to id-based title when no h3 and no dataset.title', async () => {
    // Create card without h3
    card.remove();
    card = document.createElement('div');
    card.id = hiddenId;
    document.body.appendChild(card);

    state.hiddenFacets = [hiddenId];

    const b = { id: hiddenId, col: '`source`' };
    await loadBreakdown(b, '1=1', '');

    // Should extract title from id: 'breakdown-hidden-edge-test' -> 'hidden-edge-test'
    assert.include(card.innerHTML, 'hidden-edge-test');
    assert.isTrue(card.classList.contains('facet-hidden'));
  });
});

describe('canUseFacetTable (highCardinality)', () => {
  beforeEach(() => {
    state.hostFilter = '';
    state.filters = [];
    state.additionalWhereClause = '';
  });

  it('returns false for highCardinality facets', () => {
    const b = {
      id: 'breakdown-hosts', col: '`request.host`', facetName: 'host', highCardinality: true,
    };
    assert.isFalse(canUseFacetTable(b));
  });

  it('returns true for count mode with modeToggle', () => {
    state.contentTypeMode = 'count';
    const b = {
      id: 'breakdown-content-types', col: 'x', facetName: 'content_type', modeToggle: 'contentTypeMode',
    };
    assert.isTrue(canUseFacetTable(b));
  });
});
