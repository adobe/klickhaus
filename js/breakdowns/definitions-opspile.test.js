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
  opspileBreakdowns, OPSPILE_AGGREGATIONS, OPSPILE_RED, OPSPILE_YELLOW, THREAD_KEY_RE,
  formatMeanDuration,
} from './definitions-opspile.js';
import { state } from '../state.js';
import { loadStateFromURL } from '../url-state.js';
import { compileFilters, clearAllowedColumnsCache } from '../filter-sql.js';
import { loadSql } from '../sql-loader.js';
import { canUseFacetTable } from './index.js';
import {
  OPSPILE_TIME_RANGE_ORDER, OPSPILE_DEFAULT_TIME_RANGE, TIME_RANGES,
} from '../constants.js';

const byId = (id) => opspileBreakdowns.find((b) => b.id === id);

describe('opspileBreakdowns', () => {
  it('each facet has a unique id and a string col', () => {
    const ids = new Set();
    opspileBreakdowns.forEach((b) => {
      assert.isString(b.col);
      assert.isFalse(ids.has(b.id), `duplicate id: ${b.id}`);
      ids.add(b.id);
    });
  });

  it('covers the planned facets', () => {
    [
      'breakdown-team', 'breakdown-teams', 'breakdown-org', 'breakdown-org-type',
      'breakdown-channel', 'breakdown-channel-kind', 'breakdown-source',
      'breakdown-author-relation', 'breakdown-author', 'breakdown-author-domain',
      'breakdown-kind', 'breakdown-waiting-on', 'breakdown-next-actor', 'breakdown-urgency', 'breakdown-resolved',
      'breakdown-is-root', 'breakdown-edited', 'breakdown-tickets', 'breakdown-sites',
      'breakdown-cves', 'breakdown-problems', 'breakdown-thread', 'breakdown-title',
    ].forEach((id) => assert.ok(byId(id), id));
  });

  it('array columns arrayJoin for the facet and filter with has()', () => {
    const arrays = {
      'breakdown-teams': 'teams',
      'breakdown-author-ops-teams': 'author.ops_teams',
      'breakdown-tickets': 'facts_tickets',
      'breakdown-sites': 'facts_sites',
      'breakdown-cves': 'facts_cves',
      'breakdown-problems': 'facts_problems',
      'breakdown-fact-urls': 'facts_urls',
    };
    Object.entries(arrays).forEach(([id, column]) => {
      const b = byId(id);
      assert.strictEqual(b.col, `arrayJoin(\`${column}\`)`, id);
      assert.strictEqual(b.filterCol, `\`${column}\``, id);
      assert.strictEqual(b.filterOp, 'HAS', id);
    });
  });

  it('thread and title are high cardinality', () => {
    assert.isTrue(byId('breakdown-thread').highCardinality);
    assert.isTrue(byId('breakdown-title').highCardinality);
  });

  it('opspile.html has exactly one facet card per breakdown, in order', async () => {
    const html = await (await fetch('/opspile.html')).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const cardIds = [...doc.querySelectorAll('#breakdowns .breakdown-card')].map((c) => c.id);
    assert.deepEqual(cardIds, opspileBreakdowns.map((b) => b.id));
    const link = doc.getElementById('logDetailOpenLink');
    assert.ok(link, 'Open in opspile button');
    assert.strictEqual(link.getAttribute('target'), '_blank');
    assert.include(link.getAttribute('rel'), 'noopener');
  });
});

describe('THREAD_KEY_RE', () => {
  it('matches real thread keys from every platform', () => {
    [
      'slack:T0000:C0001:1793251847.000100',
      'discord:123456789:987654321:111222333',
      'teams:tenant-1:team-1:19:c@thread.tacv2:1792584000000',
    ].forEach((key) => assert.isTrue(THREAD_KEY_RE.test(key), key));
  });

  it('rejects anything that could carry SQL', () => {
    [
      "slack:\\'OR(1=1)--",
      "slack:x'",
      'slack:a\\b',
      'slack:a b',
      'slack:',
      'outage',
    ].forEach((input) => assert.isFalse(THREAD_KEY_RE.test(input), input));
  });
});

describe('opspile time ranges', () => {
  it('offers 24h through 18mo, default 1mo, all defined presets', () => {
    assert.deepEqual(
      OPSPILE_TIME_RANGE_ORDER,
      ['24h', '7d', '14d', '1mo', '3mo', '6mo', '12mo', '18mo'],
    );
    assert.strictEqual(OPSPILE_DEFAULT_TIME_RANGE, '1mo');
    OPSPILE_TIME_RANGE_ORDER.forEach((t) => assert.ok(TIME_RANGES[t], t));
  });
});

describe('opspile chart aggregations', () => {
  it('red, yellow and green are disjoint by construction', () => {
    assert.include(OPSPILE_RED, "`label.urgency_level` IN ('critical', 'high')");
    assert.include(OPSPILE_RED, "`label.kind` IN ('incident', 'security')");
    assert.include(OPSPILE_YELLOW, `NOT ${OPSPILE_RED}`);
    assert.include(OPSPILE_YELLOW, "`thread.waiting_on` = 'us'");
    assert.notInclude(OPSPILE_YELLOW, 'label.next_actor');
    assert.include(OPSPILE_YELLOW, '`thread.resolved` = 0');
    assert.strictEqual(OPSPILE_AGGREGATIONS.agg5xx, `countIf(${OPSPILE_RED})`);
    assert.strictEqual(OPSPILE_AGGREGATIONS.agg4xx, `countIf(${OPSPILE_YELLOW})`);
    assert.strictEqual(
      OPSPILE_AGGREGATIONS.aggOk,
      `countIf(NOT ${OPSPILE_RED} AND NOT ${OPSPILE_YELLOW})`,
    );
  });

  it('time-series-opspile.sql uses the same expressions as the facet aggregations', async () => {
    const params = Object.fromEntries([
      'bucket', 'database', 'table', 'timeFilter', 'hostFilter', 'facetFilters',
      'additionalWhereClause', 'rangeStart', 'rangeEnd', 'step',
    ].map((k) => [k, '']));
    const sql = await loadSql('time-series-opspile', params);
    assert.include(sql, `${OPSPILE_AGGREGATIONS.aggOk} as cnt_ok`);
    assert.include(sql, `${OPSPILE_AGGREGATIONS.agg4xx} as cnt_4xx`);
    assert.include(sql, `${OPSPILE_AGGREGATIONS.agg5xx} as cnt_5xx`);
  });
});

describe('opspile facet routing', () => {
  let saved;
  beforeEach(() => {
    saved = { tableName: state.tableName, filters: state.filters, hostFilter: state.hostFilter };
    state.tableName = 'opspile_messages';
    state.filters = [];
    state.hostFilter = '';
  });
  afterEach(() => Object.assign(state, saved));

  it('never uses a facet-minutes table', () => {
    opspileBreakdowns.forEach((b) => {
      assert.isFalse(canUseFacetTable({ ...b, facetName: 'x' }), b.id);
    });
  });
});

describe('opspile deep links (the Stats link from opspile)', () => {
  const ORIGINAL_PATH = window.location.pathname;
  let saved;
  beforeEach(() => {
    saved = { breakdowns: state.breakdowns, filters: state.filters, timeRange: state.timeRange };
    state.breakdowns = opspileBreakdowns;
    state.filters = [];
    clearAllowedColumnsCache();
  });
  afterEach(() => {
    Object.assign(state, saved);
    clearAllowedColumnsCache();
    window.history.replaceState({}, '', ORIGINAL_PATH);
  });

  function open(filters) {
    const params = new URLSearchParams({ t: '1mo', filters: JSON.stringify(filters) });
    window.history.replaceState({}, '', `${ORIGINAL_PATH}?${params}`);
    loadStateFromURL();
  }

  it('accepts t=1mo and an org.slug filter', () => {
    open([{ col: '`org.slug`', value: 'example-org', exclude: false }]);
    assert.strictEqual(state.timeRange, '1mo');
    assert.lengthOf(state.filters, 1);
    assert.strictEqual(compileFilters(state.filters).sql, "AND `org.slug` = 'example-org'");
  });

  it('accepts a filed-team filter', () => {
    open([{ col: '`team`', value: 'example-team', exclude: false }]);
    assert.strictEqual(compileFilters(state.filters).sql, "AND `team` = 'example-team'");
  });

  it('accepts a teams (filed + shared) array filter with HAS', () => {
    open([
      { col: '`org.slug`', value: 'example-org', exclude: false },
      {
        col: 'arrayJoin(`teams`)',
        value: 'example-team',
        exclude: false,
        filterCol: '`teams`',
        filterOp: 'HAS',
      },
    ]);
    assert.lengthOf(state.filters, 2);
    assert.strictEqual(
      compileFilters(state.filters).sql,
      "AND `org.slug` = 'example-org' AND has(`teams`, 'example-team')",
    );
  });

  it("escapes a backslash-quote (\\') value so it cannot close the string", () => {
    open([{ col: '`org.slug`', value: "x\\' OR 1=1 --", exclude: false }]);
    assert.strictEqual(
      compileFilters(state.filters).sql,
      "AND `org.slug` = 'x\\\\\\' OR 1=1 --'",
    );
  });

  it('rejects filters on columns the view does not facet', () => {
    open([{ col: '`message`', value: 'x', exclude: false }]);
    assert.lengthOf(state.filters, 0);
  });
});

describe('formatMeanDuration', () => {
  it('rounds to the minute', () => {
    assert.strictEqual(formatMeanDuration({ mean_s: 2856 }), '48m');
    assert.strictEqual(formatMeanDuration({ mean_s: 13800 }), '3h 50m');
    assert.strictEqual(formatMeanDuration({ mean_s: 183600 }), '2d 3h');
  });

  it('never rounds down to nothing', () => {
    assert.strictEqual(formatMeanDuration({ mean_s: 5 }), '1m');
  });

  it('is empty without resolved threads', () => {
    assert.isNull(formatMeanDuration({ mean_s: null }));
    assert.isNull(formatMeanDuration(undefined));
  });
});

describe('opspile-mttr.sql', () => {
  const sqlFor = () => loadSql('opspile-mttr', {
    database: 'db',
    table: 'opspile_messages',
    timeFilter: 'TIME',
    hostFilter: 'HOST',
    facetFilters: 'FACETS',
    additionalWhereClause: 'EXTRA',
  });

  it('belongs to the Resolved facet', () => {
    assert.strictEqual(byId('breakdown-resolved').summaryTemplate, 'opspile-mttr');
    assert.strictEqual(byId('breakdown-resolved').summaryFormat, formatMeanDuration);
  });

  it('picks entries by range and filters, and durations by the range alone', async () => {
    const sql = await sqlFor();
    assert.include(sql, 'WHERE TIME HOST FACETS EXTRA');
    assert.match(sql, /\)\nWHERE TIME\s*$/);
  });

  it('counts re-threaded threads once and ends an entry at a human message', async () => {
    const sql = await sqlFor();
    assert.include(sql, "if(logical_thread != '', logical_thread, thread) AS entry");
    assert.include(sql, "maxIf(timestamp, `author.kind` = 'person')");
  });
});

describe('opspile-first-response.sql', () => {
  const sqlFor = () => loadSql('opspile-first-response', {
    database: 'db',
    table: 'opspile_messages',
    timeFilter: 'TIME',
    hostFilter: 'HOST',
    facetFilters: 'FACETS',
    additionalWhereClause: 'EXTRA',
  });

  it('belongs to the Waiting On facet, as its only badge', () => {
    const facet = byId('breakdown-waiting-on');
    assert.strictEqual(facet.summaryTemplate, 'opspile-first-response');
    assert.strictEqual(facet.summaryFormat, formatMeanDuration);
    assert.isUndefined(facet.summaryCountIf);
  });

  it('picks entries by range and filters, and durations by the range alone', async () => {
    const sql = await sqlFor();
    assert.include(sql, 'WHERE TIME HOST FACETS EXTRA');
    assert.match(sql, /\)\nWHERE TIME\s*$/);
  });

  it('only counts humans, and only entries Adobe did not start', async () => {
    const sql = await sqlFor();
    assert.include(sql, "minIf(timestamp, `author.kind` = 'person' AND `author.relation` = 'adobe')");
    assert.include(sql, "opened_by NOT IN ('', 'adobe')");
  });
});
