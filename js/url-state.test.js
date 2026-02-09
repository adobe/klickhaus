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
import { loadStateFromURL, saveStateToURL } from './url-state.js';
import { state } from './state.js';
import { DEFAULT_TIME_RANGE, DEFAULT_TOP_N } from './constants.js';
import {
  queryTimestamp, customTimeRange, setQueryTimestamp, clearCustomTimeRange,
} from './time.js';

const ORIGINAL_PATH = window.location.pathname;

function resetState() {
  state.timeRange = DEFAULT_TIME_RANGE;
  state.hostFilter = '';
  state.topN = DEFAULT_TOP_N;
  state.filters = [];
  state.showLogs = false;
  state.title = '';
  state.contentTypeMode = 'count';
  state.hiddenControls = [];
  state.pinnedColumns = [];
  state.pinnedFacets = [];
  state.hiddenFacets = [];
}

function setURL(params) {
  const search = params ? `?${new URLSearchParams(params).toString()}` : '';
  window.history.replaceState({}, '', `${ORIGINAL_PATH}${search}`);
}

describe('loadStateFromURL', () => {
  beforeEach(() => {
    resetState();
    clearCustomTimeRange();
    setQueryTimestamp(null);
  });

  afterEach(() => {
    window.history.replaceState({}, '', ORIGINAL_PATH);
  });

  describe('time range', () => {
    it('loads valid time range', () => {
      setURL({ t: '24h' });
      loadStateFromURL();
      assert.strictEqual(state.timeRange, '24h');
    });

    it('loads all valid time ranges', () => {
      for (const key of ['15m', '1h', '12h', '24h', '7d']) {
        resetState();
        setURL({ t: key });
        loadStateFromURL();
        assert.strictEqual(state.timeRange, key);
      }
    });

    it('ignores invalid time range', () => {
      setURL({ t: '99h' });
      loadStateFromURL();
      assert.strictEqual(state.timeRange, DEFAULT_TIME_RANGE);
    });

    it('ignores empty time range', () => {
      setURL({ t: '' });
      loadStateFromURL();
      assert.strictEqual(state.timeRange, DEFAULT_TIME_RANGE);
    });

    it('keeps default when t is absent', () => {
      setURL({});
      loadStateFromURL();
      assert.strictEqual(state.timeRange, DEFAULT_TIME_RANGE);
    });
  });

  describe('host filter', () => {
    it('loads host filter', () => {
      setURL({ host: 'example.com' });
      loadStateFromURL();
      assert.strictEqual(state.hostFilter, 'example.com');
    });

    it('loads AEM domain', () => {
      setURL({ host: 'main--site--org.aem.live' });
      loadStateFromURL();
      assert.strictEqual(state.hostFilter, 'main--site--org.aem.live');
    });

    it('keeps empty when host is absent', () => {
      setURL({});
      loadStateFromURL();
      assert.strictEqual(state.hostFilter, '');
    });
  });

  describe('topN', () => {
    it('loads valid topN values', () => {
      for (const n of [5, 10, 20, 50, 100]) {
        resetState();
        setURL({ n: String(n) });
        loadStateFromURL();
        assert.strictEqual(state.topN, n);
      }
    });

    it('ignores invalid topN', () => {
      setURL({ n: '7' });
      loadStateFromURL();
      assert.strictEqual(state.topN, DEFAULT_TOP_N);
    });

    it('ignores non-numeric topN', () => {
      setURL({ n: 'abc' });
      loadStateFromURL();
      assert.strictEqual(state.topN, DEFAULT_TOP_N);
    });

    it('ignores negative topN', () => {
      setURL({ n: '-5' });
      loadStateFromURL();
      assert.strictEqual(state.topN, DEFAULT_TOP_N);
    });
  });

  describe('view mode', () => {
    it('sets showLogs when view=logs', () => {
      setURL({ view: 'logs' });
      loadStateFromURL();
      assert.strictEqual(state.showLogs, true);
    });

    it('does not set showLogs for other values', () => {
      setURL({ view: 'other' });
      loadStateFromURL();
      assert.strictEqual(state.showLogs, false);
    });

    it('does not set showLogs when absent', () => {
      setURL({});
      loadStateFromURL();
      assert.strictEqual(state.showLogs, false);
    });
  });

  describe('title', () => {
    it('loads custom title', () => {
      setURL({ title: 'My Dashboard' });
      loadStateFromURL();
      assert.strictEqual(state.title, 'My Dashboard');
    });

    it('keeps empty when title is absent', () => {
      setURL({});
      loadStateFromURL();
      assert.strictEqual(state.title, '');
    });
  });

  describe('content type mode', () => {
    it('loads bytes mode', () => {
      setURL({ ctm: 'bytes' });
      loadStateFromURL();
      assert.strictEqual(state.contentTypeMode, 'bytes');
    });

    it('loads count mode', () => {
      setURL({ ctm: 'count' });
      loadStateFromURL();
      assert.strictEqual(state.contentTypeMode, 'count');
    });

    it('ignores invalid mode', () => {
      setURL({ ctm: 'invalid' });
      loadStateFromURL();
      assert.strictEqual(state.contentTypeMode, 'count');
    });
  });

  describe('hidden controls', () => {
    it('parses comma-separated hidden controls', () => {
      setURL({ hide: 'timeRange,topN,host' });
      loadStateFromURL();
      assert.deepEqual(state.hiddenControls, ['timeRange', 'topN', 'host']);
    });

    it('filters empty segments', () => {
      setURL({ hide: 'timeRange,,host,' });
      loadStateFromURL();
      assert.deepEqual(state.hiddenControls, ['timeRange', 'host']);
    });
  });

  describe('filters', () => {
    it('loads valid filter from URL', () => {
      const filters = [{ col: '`request.host`', value: 'example.com', exclude: false }];
      setURL({ filters: JSON.stringify(filters) });
      loadStateFromURL();
      assert.strictEqual(state.filters.length, 1);
      assert.strictEqual(state.filters[0].col, '`request.host`');
      assert.strictEqual(state.filters[0].value, 'example.com');
      assert.strictEqual(state.filters[0].exclude, false);
    });

    it('loads exclusion filter', () => {
      const filters = [{ col: '`request.host`', value: 'bad.com', exclude: true }];
      setURL({ filters: JSON.stringify(filters) });
      loadStateFromURL();
      assert.strictEqual(state.filters.length, 1);
      assert.strictEqual(state.filters[0].exclude, true);
    });

    it('loads filter with LIKE operator', () => {
      const filters = [{
        col: '`request.url`', value: '%/path%', exclude: false, filterOp: 'LIKE',
      }];
      setURL({ filters: JSON.stringify(filters) });
      loadStateFromURL();
      assert.strictEqual(state.filters.length, 1);
      assert.strictEqual(state.filters[0].filterOp, 'LIKE');
    });

    it('loads filter with filterCol override', () => {
      const filters = [{
        col: '`request.host`', value: 'display', exclude: false, filterCol: '`request.url`', filterValue: '/actual',
      }];
      setURL({ filters: JSON.stringify(filters) });
      loadStateFromURL();
      assert.strictEqual(state.filters.length, 1);
      assert.strictEqual(state.filters[0].filterCol, '`request.url`');
      assert.strictEqual(state.filters[0].filterValue, '/actual');
    });

    it('rejects filter with missing col', () => {
      const filters = [{ value: 'example.com', exclude: false }];
      setURL({ filters: JSON.stringify(filters) });
      loadStateFromURL();
      assert.strictEqual(state.filters.length, 0);
    });

    it('rejects filter with non-boolean exclude', () => {
      const filters = [{ col: '`request.host`', value: 'example.com', exclude: 'yes' }];
      setURL({ filters: JSON.stringify(filters) });
      loadStateFromURL();
      assert.strictEqual(state.filters.length, 0);
    });

    it('rejects filter with non-string value', () => {
      const filters = [{ col: '`request.host`', value: 123, exclude: false }];
      setURL({ filters: JSON.stringify(filters) });
      loadStateFromURL();
      assert.strictEqual(state.filters.length, 0);
    });

    it('rejects filter with invalid SQL column', () => {
      const filters = [{ col: "'; DROP TABLE cdn_requests_v2; --", value: 'x', exclude: false }];
      setURL({ filters: JSON.stringify(filters) });
      loadStateFromURL();
      assert.strictEqual(state.filters.length, 0);
    });

    it('rejects filter with invalid operator', () => {
      const filters = [{
        col: '`request.host`', value: 'x', exclude: false, filterOp: 'OR 1=1 --',
      }];
      setURL({ filters: JSON.stringify(filters) });
      loadStateFromURL();
      assert.strictEqual(state.filters.length, 0);
    });

    it('keeps valid filters while rejecting invalid', () => {
      const filters = [
        { col: '`request.host`', value: 'good.com', exclude: false },
        { col: 'INVALID_COL', value: 'bad', exclude: false },
      ];
      setURL({ filters: JSON.stringify(filters) });
      loadStateFromURL();
      assert.strictEqual(state.filters.length, 1);
      assert.strictEqual(state.filters[0].value, 'good.com');
    });

    it('handles invalid JSON gracefully', () => {
      setURL({ filters: 'not-json' });
      loadStateFromURL();
      assert.deepEqual(state.filters, []);
    });

    it('handles non-array JSON gracefully', () => {
      setURL({ filters: JSON.stringify({ col: '`request.host`' }) });
      loadStateFromURL();
      assert.deepEqual(state.filters, []);
    });
  });

  describe('time state', () => {
    it('loads single timestamp', () => {
      const ts = '2025-06-15T10:30:00.000Z';
      setURL({ ts });
      loadStateFromURL();
      assert.ok(queryTimestamp());
      assert.strictEqual(queryTimestamp().toISOString(), ts);
    });

    it('loads custom time range', () => {
      const ts = '2025-06-15T10:00:00.000Z';
      const te = '2025-06-15T11:00:00.000Z';
      setURL({ ts, te });
      loadStateFromURL();
      const ctr = customTimeRange();
      assert.ok(ctr);
      assert.ok(ctr.start instanceof Date);
      assert.ok(ctr.end instanceof Date);
    });

    it('ignores invalid timestamp', () => {
      setURL({ ts: 'not-a-date' });
      loadStateFromURL();
      assert.isNull(queryTimestamp());
    });

    it('ignores invalid end timestamp without setting any time state', () => {
      const ts = '2025-06-15T10:00:00.000Z';
      setURL({ ts, te: 'not-a-date' });
      loadStateFromURL();
      // When te is present but invalid, neither timestamp nor custom range is set
      assert.isNull(customTimeRange());
    });
  });

  describe('pinned columns', () => {
    it('loads pinned columns', () => {
      setURL({ pinned: 'request.host,response.status' });
      loadStateFromURL();
      assert.deepEqual(state.pinnedColumns, ['request.host', 'response.status']);
    });

    it('filters empty segments', () => {
      setURL({ pinned: 'request.host,,response.status,' });
      loadStateFromURL();
      assert.deepEqual(state.pinnedColumns, ['request.host', 'response.status']);
    });
  });

  describe('facet preferences', () => {
    it('loads pinned facets', () => {
      setURL({ pf: 'host,url,status' });
      loadStateFromURL();
      assert.deepEqual(state.pinnedFacets, ['host', 'url', 'status']);
    });

    it('loads hidden facets', () => {
      setURL({ hf: 'user_agent,referer' });
      loadStateFromURL();
      assert.deepEqual(state.hiddenFacets, ['user_agent', 'referer']);
    });

    it('filters empty segments from facets', () => {
      setURL({ pf: 'host,,url', hf: 'referer,' });
      loadStateFromURL();
      assert.deepEqual(state.pinnedFacets, ['host', 'url']);
      assert.deepEqual(state.hiddenFacets, ['referer']);
    });
  });

  describe('combined parameters', () => {
    it('loads multiple parameters at once', () => {
      const filters = [{ col: '`request.host`', value: 'example.com', exclude: false }];
      setURL({
        t: '7d',
        host: 'cdn.example.com',
        n: '20',
        view: 'logs',
        title: 'Test Dashboard',
        filters: JSON.stringify(filters),
      });
      loadStateFromURL();
      assert.strictEqual(state.timeRange, '7d');
      assert.strictEqual(state.hostFilter, 'cdn.example.com');
      assert.strictEqual(state.topN, 20);
      assert.strictEqual(state.showLogs, true);
      assert.strictEqual(state.title, 'Test Dashboard');
      assert.strictEqual(state.filters.length, 1);
    });
  });
});

describe('saveStateToURL', () => {
  beforeEach(() => {
    resetState();
    clearCustomTimeRange();
    setQueryTimestamp(null);
  });

  afterEach(() => {
    window.history.replaceState({}, '', ORIGINAL_PATH);
  });

  it('encodes time range into URL', () => {
    state.timeRange = '7d';
    saveStateToURL();
    const params = new URLSearchParams(window.location.search);
    assert.strictEqual(params.get('t'), '7d');
  });

  it('omits default time range', () => {
    state.timeRange = DEFAULT_TIME_RANGE;
    saveStateToURL();
    const params = new URLSearchParams(window.location.search);
    assert.isFalse(params.has('t'));
  });

  it('encodes host filter', () => {
    state.hostFilter = 'example.com';
    saveStateToURL();
    const params = new URLSearchParams(window.location.search);
    assert.strictEqual(params.get('host'), 'example.com');
  });

  it('encodes non-default topN', () => {
    state.topN = 50;
    saveStateToURL();
    const params = new URLSearchParams(window.location.search);
    assert.strictEqual(params.get('n'), '50');
  });

  it('omits default topN', () => {
    state.topN = DEFAULT_TOP_N;
    saveStateToURL();
    const params = new URLSearchParams(window.location.search);
    assert.isFalse(params.has('n'));
  });

  it('encodes filters as JSON', () => {
    state.filters = [{ col: '`request.host`', value: 'test.com', exclude: false }];
    saveStateToURL();
    const params = new URLSearchParams(window.location.search);
    const filters = JSON.parse(params.get('filters'));
    assert.strictEqual(filters.length, 1);
    assert.strictEqual(filters[0].value, 'test.com');
  });

  it('encodes pinned facets', () => {
    state.pinnedFacets = ['host', 'url'];
    saveStateToURL();
    const params = new URLSearchParams(window.location.search);
    assert.strictEqual(params.get('pf'), 'host,url');
  });

  it('encodes hidden facets', () => {
    state.hiddenFacets = ['referer'];
    saveStateToURL();
    const params = new URLSearchParams(window.location.search);
    assert.strictEqual(params.get('hf'), 'referer');
  });

  it('produces clean URL with all defaults', () => {
    saveStateToURL();
    assert.strictEqual(window.location.search, '');
  });
});
