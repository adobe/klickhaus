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
import { CLICKHOUSE_URL } from '../config.js';
import { initFacetSearch, openFacetSearch } from './facet-search.js';
import { addFilter } from '../filters.js';
import { compileFilters, clearAllowedColumnsCache } from '../filter-sql.js';
import { opspileBreakdowns } from '../breakdowns/definitions-opspile.js';
import { lambdaBreakdowns } from '../breakdowns/definitions-lambda.js';

function ensureElement(tag, id) {
  if (!document.getElementById(id)) {
    const el = document.createElement(tag);
    el.id = id;
    document.body.appendChild(el);
  }
}

function ensureDom() {
  ensureElement('div', 'activeFilters');
  if (document.getElementById('facetSearchPopover')) { return; }
  const dialog = document.createElement('dialog');
  dialog.id = 'facetSearchPopover';
  dialog.innerHTML = '<h4 id="facetSearchTitle"></h4><input id="facetSearchInput">'
    + '<div id="facetSearchResults"></div>';
  document.body.appendChild(dialog);
}

const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) { return; }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 10); });
  }
  throw new Error('timed out');
};

describe('facet search on array (HAS) facets', () => {
  const originalFetch = window.fetch;
  let saved;
  let sqls;

  beforeEach(() => {
    ensureDom();
    saved = {
      breakdowns: state.breakdowns,
      filters: state.filters,
      credentials: state.credentials,
      tableName: state.tableName,
    };
    state.filters = [];
    state.credentials = { user: 'u', password: 'p' };
    state.tableName = 'opspile_messages';
    sqls = [];
    window.fetch = async (url, opts) => {
      if (String(url).startsWith(CLICKHOUSE_URL)) {
        sqls.push(opts.body);
        return new Response(JSON.stringify({ data: [{ dim: 'team-beta', cnt: 3 }] }), { status: 200 });
      }
      return originalFetch(url, opts);
    };
    // The real addFilter (no reload callbacks): this is what the dashboard wires up.
    initFacetSearch({
      addFilter: (col, value, exclude, filterCol, filterValue, filterOp) => addFilter(
        col,
        value,
        exclude,
        filterCol,
        filterValue,
        filterOp,
        true,
      ),
    });
  });

  afterEach(() => {
    window.fetch = originalFetch;
    Object.assign(state, saved);
    clearAllowedColumnsCache();
  });

  async function pickFirstResult(breakdowns, id) {
    state.breakdowns = breakdowns;
    clearAllowedColumnsCache();
    const b = breakdowns.find((x) => x.id === id);
    // The "(other/search)" row passes the breakdown's col and filterCol.
    openFacetSearch(b.col, id, b.filterCol, 'Teams');
    await waitFor(() => document.querySelector('#facetSearchResults .facet-search-btn'));
    document.querySelector('#facetSearchResults .facet-search-btn[data-exclude="false"]').click();
    return b;
  }

  it('searches array elements and filters with has() (opspile teams)', async () => {
    await pickFirstResult(opspileBreakdowns, 'breakdown-teams');
    assert.include(sqls[0], 'SELECT arrayJoin(`teams`) as dim');
    assert.notInclude(sqls[0], 'SELECT `teams` as dim');
    assert.strictEqual(compileFilters(state.filters).sql, "AND has(`teams`, 'team-beta')");
  });

  it('does the same for lambda array facets', async () => {
    state.tableName = 'lambda_logs';
    await pickFirstResult(lambdaBreakdowns, 'breakdown-url');
    assert.include(sqls[0], 'SELECT arrayJoin(`urls`) as dim');
    assert.strictEqual(compileFilters(state.filters).sql, "AND has(`urls`, 'team-beta')");
  });

  it('every HAS facet defines searchCol as its arrayJoin col', () => {
    [...opspileBreakdowns, ...lambdaBreakdowns]
      .filter((b) => b.filterOp === 'HAS')
      .forEach((b) => assert.strictEqual(b.searchCol, b.col, b.id));
  });
});
