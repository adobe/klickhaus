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
import { DataChunks, utils } from '@adobe/rum-distiller';
import {
  getGranularity,
  buildApiUrls,
  getTimeBucketConfig,
  fetchChunk,
  fetchAllChunks,
  transformToChartData,
  transformToBreakdownData,
  addSeriesDefinitions,
  addFacetDefinitions,
  fetchRumData,
} from './rum-adapter.js';

describe('rum-adapter', () => {
  describe('getGranularity', () => {
    it('returns hourly for ranges up to 7 days', () => {
      const start = new Date('2025-01-01T00:00:00Z');
      const end = new Date('2025-01-07T23:59:59Z');
      assert.strictEqual(getGranularity(start, end), 'hourly');
    });

    it('returns hourly for 1-day range', () => {
      const start = new Date('2025-01-01T00:00:00Z');
      const end = new Date('2025-01-01T23:59:59Z');
      assert.strictEqual(getGranularity(start, end), 'hourly');
    });

    it('returns daily for ranges of 8-31 days', () => {
      const start = new Date('2025-01-01T00:00:00Z');
      const end = new Date('2025-01-20T00:00:00Z');
      assert.strictEqual(getGranularity(start, end), 'daily');
    });

    it('returns daily for exactly 31 days', () => {
      const start = new Date('2025-01-01T00:00:00Z');
      const end = new Date('2025-02-01T00:00:00Z');
      assert.strictEqual(getGranularity(start, end), 'daily');
    });

    it('returns monthly for ranges over 31 days', () => {
      const start = new Date('2025-01-01T00:00:00Z');
      const end = new Date('2025-06-01T00:00:00Z');
      assert.strictEqual(getGranularity(start, end), 'monthly');
    });

    it('returns hourly for very short ranges', () => {
      const start = new Date('2025-01-01T12:00:00Z');
      const end = new Date('2025-01-01T18:00:00Z');
      assert.strictEqual(getGranularity(start, end), 'hourly');
    });
  });

  describe('buildApiUrls', () => {
    const domain = 'www.example.com';
    const domainkey = 'test-key-123';

    it('builds hourly URLs for a short range', () => {
      const start = new Date('2025-03-15T10:00:00Z');
      const end = new Date('2025-03-15T12:00:00Z');
      const urls = buildApiUrls(domain, domainkey, start, end, 'hourly');

      assert.strictEqual(urls.length, 3); // 10, 11, 12
      assert.strictEqual(
        urls[0],
        'https://bundles.aem.page/bundles/www.example.com/2025/03/15/10?domainkey=test-key-123',
      );
      assert.include(urls[1], '/2025/03/15/11?');
      assert.include(urls[2], '/2025/03/15/12?');
    });

    it('builds daily URLs for a multi-day range', () => {
      const start = new Date('2025-03-01T00:00:00Z');
      const end = new Date('2025-03-03T00:00:00Z');
      const urls = buildApiUrls(domain, domainkey, start, end, 'daily');

      assert.strictEqual(urls.length, 3);
      assert.strictEqual(
        urls[0],
        'https://bundles.aem.page/bundles/www.example.com/2025/03/01?domainkey=test-key-123',
      );
      assert.include(urls[1], '/2025/03/02?');
      assert.include(urls[2], '/2025/03/03?');
    });

    it('builds monthly URLs for a long range', () => {
      const start = new Date('2025-01-15T00:00:00Z');
      const end = new Date('2025-04-15T00:00:00Z');
      const urls = buildApiUrls(domain, domainkey, start, end, 'monthly');

      assert.strictEqual(urls.length, 4); // Jan, Feb, Mar, Apr
      assert.strictEqual(
        urls[0],
        'https://bundles.aem.page/bundles/www.example.com/2025/01?domainkey=test-key-123',
      );
      assert.include(urls[3], '/2025/04?');
    });

    it('encodes special characters in domainkey', () => {
      const key = 'key with spaces&special=chars';
      const urls = buildApiUrls(domain, key, new Date('2025-01-01T00:00:00Z'), new Date('2025-01-01T01:00:00Z'), 'hourly');

      assert.include(urls[0], 'domainkey=key%20with%20spaces%26special%3Dchars');
    });

    it('returns empty array when start > end for hourly', () => {
      const start = new Date('2025-03-15T12:00:00Z');
      const end = new Date('2025-03-15T10:00:00Z');
      const urls = buildApiUrls(domain, domainkey, start, end, 'hourly');
      assert.strictEqual(urls.length, 0);
    });

    it('produces single URL when start equals end (daily)', () => {
      const date = new Date('2025-03-15T00:00:00Z');
      const urls = buildApiUrls(domain, domainkey, date, date, 'daily');
      assert.strictEqual(urls.length, 1);
    });
  });

  describe('getTimeBucketConfig', () => {
    it('truncates to hour for hourly granularity', () => {
      const fn = getTimeBucketConfig('hourly');
      const bundle = { timeSlot: '2025-03-15T14:35:22Z' };
      const result = fn(bundle);
      assert.strictEqual(result, new Date('2025-03-15T14:00:00Z').toISOString());
    });

    it('truncates to day for daily granularity', () => {
      const fn = getTimeBucketConfig('daily');
      const bundle = { timeSlot: '2025-03-15T14:35:22Z' };
      const result = fn(bundle);
      assert.strictEqual(result, new Date('2025-03-15T00:00:00Z').toISOString());
    });

    it('truncates to month for monthly granularity', () => {
      const fn = getTimeBucketConfig('monthly');
      const bundle = { timeSlot: '2025-03-15T14:35:22Z' };
      const result = fn(bundle);
      assert.strictEqual(result, new Date('2025-03-01T00:00:00Z').toISOString());
    });
  });

  describe('fetchChunk', () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = window.fetch;
    });

    afterEach(() => {
      window.fetch = originalFetch;
    });

    it('returns rumBundles from successful response', async () => {
      const bundles = [{ id: '1', weight: 100 }];
      const body = JSON.stringify({ rumBundles: bundles });
      window.fetch = async () => new Response(body, { status: 200 });

      const result = await fetchChunk('https://bundles.aem.page/bundles/test/2025/01/01');
      assert.deepEqual(result, bundles);
    });

    it('returns empty array on 404', async () => {
      window.fetch = async () => new Response('', { status: 404 });

      const result = await fetchChunk('https://bundles.aem.page/bundles/test/2025/01/01');
      assert.deepEqual(result, []);
    });

    it('throws on 403 with auth error message', async () => {
      window.fetch = async () => new Response('Forbidden', { status: 403 });

      try {
        await fetchChunk('https://bundles.aem.page/bundles/test/2025/01/01');
        assert.fail('Should have thrown');
      } catch (err) {
        assert.include(err.message, 'Authentication failed');
        assert.strictEqual(err.status, 403);
      }
    });

    it('throws on server error', async () => {
      window.fetch = async () => new Response('Server Error', { status: 500, statusText: 'Internal Server Error' });

      try {
        await fetchChunk('https://bundles.aem.page/bundles/test/2025/01/01');
        assert.fail('Should have thrown');
      } catch (err) {
        assert.include(err.message, '500');
        assert.strictEqual(err.status, 500);
      }
    });

    it('returns empty array when rumBundles is missing', async () => {
      window.fetch = async () => new Response(JSON.stringify({}), { status: 200 });

      const result = await fetchChunk('https://bundles.aem.page/bundles/test/2025/01/01');
      assert.deepEqual(result, []);
    });

    it('passes abort signal to fetch', async () => {
      const controller = new AbortController();
      let capturedOpts;
      window.fetch = async (url, opts) => {
        capturedOpts = opts;
        return new Response(JSON.stringify({ rumBundles: [] }), { status: 200 });
      };

      await fetchChunk('https://bundles.aem.page/bundles/test/2025/01/01', controller.signal);
      assert.strictEqual(capturedOpts.signal, controller.signal);
    });
  });

  describe('fetchAllChunks', () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = window.fetch;
    });

    afterEach(() => {
      window.fetch = originalFetch;
    });

    it('merges bundles from multiple chunks', async () => {
      const chunk1 = [{ id: '1' }, { id: '2' }];
      const chunk2 = [{ id: '3' }];
      let callCount = 0;

      window.fetch = async () => {
        callCount += 1;
        const data = callCount === 1 ? chunk1 : chunk2;
        return new Response(JSON.stringify({ rumBundles: data }), { status: 200 });
      };

      const result = await fetchAllChunks(['url1', 'url2']);
      assert.strictEqual(result.length, 3);
      assert.deepEqual(result.map((b) => b.id), ['1', '2', '3']);
    });

    it('handles empty chunks gracefully', async () => {
      window.fetch = async () => new Response('', { status: 404 });

      const result = await fetchAllChunks(['url1', 'url2']);
      assert.deepEqual(result, []);
    });

    it('propagates 403 errors', async () => {
      window.fetch = async () => new Response('Forbidden', { status: 403 });

      try {
        await fetchAllChunks(['url1']);
        assert.fail('Should have thrown');
      } catch (err) {
        assert.strictEqual(err.status, 403);
      }
    });
  });

  describe('transformToChartData', () => {
    it('transforms aggregates to chart data format', () => {
      const aggregates = {
        '2025-03-15T10:00:00.000Z': {
          ok: { sum: 100.5 },
          meh: { sum: 20.3 },
          poor: { sum: 5.1 },
        },
        '2025-03-15T11:00:00.000Z': {
          ok: { sum: 150.7 },
          meh: { sum: 30.2 },
          poor: { sum: 8.9 },
        },
      };

      const result = transformToChartData(aggregates);

      assert.strictEqual(result.length, 2);
      assert.deepEqual(result[0], {
        t: '2025-03-15T10:00:00.000Z',
        cnt_ok: 101,
        cnt_4xx: 20,
        cnt_5xx: 5,
      });
      assert.deepEqual(result[1], {
        t: '2025-03-15T11:00:00.000Z',
        cnt_ok: 151,
        cnt_4xx: 30,
        cnt_5xx: 9,
      });
    });

    it('sorts by timestamp', () => {
      const aggregates = {
        '2025-03-15T12:00:00.000Z': { ok: { sum: 10 }, meh: { sum: 0 }, poor: { sum: 0 } },
        '2025-03-15T10:00:00.000Z': { ok: { sum: 20 }, meh: { sum: 0 }, poor: { sum: 0 } },
        '2025-03-15T11:00:00.000Z': { ok: { sum: 15 }, meh: { sum: 0 }, poor: { sum: 0 } },
      };

      const result = transformToChartData(aggregates);
      assert.strictEqual(result[0].t, '2025-03-15T10:00:00.000Z');
      assert.strictEqual(result[1].t, '2025-03-15T11:00:00.000Z');
      assert.strictEqual(result[2].t, '2025-03-15T12:00:00.000Z');
    });

    it('handles missing series in aggregate', () => {
      const aggregates = {
        '2025-03-15T10:00:00.000Z': {
          ok: { sum: 100 },
        },
      };

      const result = transformToChartData(aggregates);
      assert.deepEqual(result[0], {
        t: '2025-03-15T10:00:00.000Z',
        cnt_ok: 100,
        cnt_4xx: 0,
        cnt_5xx: 0,
      });
    });

    it('returns empty array for empty aggregates', () => {
      const result = transformToChartData({});
      assert.deepEqual(result, []);
    });

    it('handles zero values correctly', () => {
      const aggregates = {
        '2025-03-15T10:00:00.000Z': {
          ok: { sum: 0 },
          meh: { sum: 0 },
          poor: { sum: 0 },
        },
      };

      const result = transformToChartData(aggregates);
      assert.deepEqual(result[0], {
        t: '2025-03-15T10:00:00.000Z',
        cnt_ok: 0,
        cnt_4xx: 0,
        cnt_5xx: 0,
      });
    });
  });

  describe('transformToBreakdownData', () => {
    function makeFacetEntry(value, weight, metrics) {
      return {
        value,
        weight,
        getMetrics: () => metrics,
      };
    }

    it('transforms facet data to breakdown format', () => {
      const facetData = [
        makeFacetEntry('/home', 100, {
          ok: { sum: 80 },
          meh: { sum: 15 },
          poor: { sum: 5 },
        }),
        makeFacetEntry('/about', 50, {
          ok: { sum: 40 },
          meh: { sum: 8 },
          poor: { sum: 2 },
        }),
      ];

      const result = transformToBreakdownData(facetData);
      assert.strictEqual(result.length, 2);
      assert.deepEqual(result[0], {
        dim: '/home', cnt: 100, cnt_ok: 80, cnt_4xx: 15, cnt_5xx: 5,
      });
      assert.deepEqual(result[1], {
        dim: '/about', cnt: 50, cnt_ok: 40, cnt_4xx: 8, cnt_5xx: 2,
      });
    });

    it('maintains sum invariant: cnt_ok + cnt_4xx + cnt_5xx == cnt', () => {
      const facetData = [
        makeFacetEntry('/page', 200, {
          ok: { sum: 150 },
          meh: { sum: 30 },
          poor: { sum: 20 },
        }),
      ];

      const result = transformToBreakdownData(facetData);
      const row = result[0];
      assert.strictEqual(row.cnt, row.cnt_ok + row.cnt_4xx + row.cnt_5xx);
    });

    it('filters out zero-weight entries', () => {
      const facetData = [
        makeFacetEntry('/home', 100, { ok: { sum: 100 }, meh: { sum: 0 }, poor: { sum: 0 } }),
        makeFacetEntry('/empty', 0, { ok: { sum: 0 }, meh: { sum: 0 }, poor: { sum: 0 } }),
      ];

      const result = transformToBreakdownData(facetData);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].dim, '/home');
    });

    it('returns empty array for null input', () => {
      assert.deepEqual(transformToBreakdownData(null), []);
    });

    it('returns empty array for undefined input', () => {
      assert.deepEqual(transformToBreakdownData(undefined), []);
    });

    it('returns empty array for empty array input', () => {
      assert.deepEqual(transformToBreakdownData([]), []);
    });

    it('handles missing metric series gracefully', () => {
      const facetData = [
        makeFacetEntry('/page', 50, {
          ok: { sum: 50 },
        }),
      ];

      const result = transformToBreakdownData(facetData);
      assert.deepEqual(result[0], {
        dim: '/page', cnt: 50, cnt_ok: 50, cnt_4xx: 0, cnt_5xx: 0,
      });
    });
  });

  describe('addSeriesDefinitions', () => {
    it('adds traffic series with correct classification', () => {
      const dc = new DataChunks();
      addSeriesDefinitions(dc, 'traffic');

      // Check that all expected series are defined
      assert.isFunction(dc.series.pageViews);
      assert.isFunction(dc.series.visits);
      assert.isFunction(dc.series.bounces);
      assert.isFunction(dc.series.engagement);
      assert.isFunction(dc.series.ok);
      assert.isFunction(dc.series.meh);
      assert.isFunction(dc.series.poor);
    });

    it('traffic ok series: engaged visit returns weight', () => {
      const dc = new DataChunks();
      addSeriesDefinitions(dc, 'traffic');

      const bundle = {
        visit: true,
        weight: 100,
        events: [{ checkpoint: 'click' }],
      };
      assert.strictEqual(dc.series.ok(bundle), 100);
    });

    it('traffic ok series: non-visit returns 0', () => {
      const dc = new DataChunks();
      addSeriesDefinitions(dc, 'traffic');

      const bundle = {
        visit: false,
        weight: 100,
        events: [{ checkpoint: 'click' }],
      };
      assert.strictEqual(dc.series.ok(bundle), 0);
    });

    it('traffic meh series: non-visit returns weight', () => {
      const dc = new DataChunks();
      addSeriesDefinitions(dc, 'traffic');

      const bundle = { visit: false, weight: 100, events: [] };
      assert.strictEqual(dc.series.meh(bundle), 100);
    });

    it('traffic meh series: visit returns 0', () => {
      const dc = new DataChunks();
      addSeriesDefinitions(dc, 'traffic');

      const bundle = { visit: true, weight: 100, events: [] };
      assert.strictEqual(dc.series.meh(bundle), 0);
    });

    it('traffic poor series: bouncing visit returns weight', () => {
      const dc = new DataChunks();
      addSeriesDefinitions(dc, 'traffic');

      const bundle = {
        visit: true,
        weight: 100,
        events: [{ checkpoint: 'enter' }],
      };
      assert.strictEqual(dc.series.poor(bundle), 100);
    });

    it('traffic poor series: engaged visit returns 0', () => {
      const dc = new DataChunks();
      addSeriesDefinitions(dc, 'traffic');

      const bundle = {
        visit: true,
        weight: 100,
        events: [{ checkpoint: 'click' }],
      };
      assert.strictEqual(dc.series.poor(bundle), 0);
    });

    it('adds lcp CWV series', () => {
      const dc = new DataChunks();
      addSeriesDefinitions(dc, 'lcp');

      const goodBundle = { cwvLCP: 1000, weight: 100, events: [] };
      const niBundle = { cwvLCP: 3000, weight: 100, events: [] };
      const poorBundle = { cwvLCP: 5000, weight: 100, events: [] };

      assert.strictEqual(dc.series.ok(goodBundle), 100);
      assert.strictEqual(dc.series.ok(niBundle), 0);
      assert.strictEqual(dc.series.ok(poorBundle), 0);

      assert.strictEqual(dc.series.meh(goodBundle), 0);
      assert.strictEqual(dc.series.meh(niBundle), 100);
      assert.strictEqual(dc.series.meh(poorBundle), 0);

      assert.strictEqual(dc.series.poor(goodBundle), 0);
      assert.strictEqual(dc.series.poor(niBundle), 0);
      assert.strictEqual(dc.series.poor(poorBundle), 100);
    });

    it('adds cls CWV series', () => {
      const dc = new DataChunks();
      addSeriesDefinitions(dc, 'cls');

      const goodBundle = { cwvCLS: 0.05, weight: 100, events: [] };
      const niBundle = { cwvCLS: 0.15, weight: 100, events: [] };
      const poorBundle = { cwvCLS: 0.3, weight: 100, events: [] };

      assert.strictEqual(dc.series.ok(goodBundle), 100);
      assert.strictEqual(dc.series.meh(niBundle), 100);
      assert.strictEqual(dc.series.poor(poorBundle), 100);
    });

    it('adds inp CWV series', () => {
      const dc = new DataChunks();
      addSeriesDefinitions(dc, 'inp');

      const goodBundle = { cwvINP: 100, weight: 100, events: [] };
      const niBundle = { cwvINP: 300, weight: 100, events: [] };
      const poorBundle = { cwvINP: 600, weight: 100, events: [] };

      assert.strictEqual(dc.series.ok(goodBundle), 100);
      assert.strictEqual(dc.series.meh(niBundle), 100);
      assert.strictEqual(dc.series.poor(poorBundle), 100);
    });

    it('CWV series returns 0 for null metric', () => {
      const dc = new DataChunks();
      addSeriesDefinitions(dc, 'lcp');

      const noMetricBundle = { weight: 100, events: [] };
      assert.strictEqual(dc.series.ok(noMetricBundle), 0);
      assert.strictEqual(dc.series.meh(noMetricBundle), 0);
      assert.strictEqual(dc.series.poor(noMetricBundle), 0);
    });
  });

  describe('addFacetDefinitions', () => {
    it('adds all core facets', () => {
      const dc = new DataChunks();
      addFacetDefinitions(dc);

      // Verify facets are registered by adding data and checking facets property
      const testBundle = utils.addCalculatedProps({
        id: 'test',
        host: 'www.example.com',
        time: '2025-01-01T00:00:00Z',
        timeSlot: '2025-01-01T00:00:00Z',
        url: 'https://www.example.com/page',
        weight: 100,
        events: [
          { checkpoint: 'enter', source: 'https://www.google.com', target: '' },
          {
            checkpoint: 'cwv-lcp', value: 1500, source: '', target: '',
          },
        ],
        userAgent: 'desktop:windows',
      });

      dc.load([{ rumBundles: [testBundle] }]);
      const facetNames = Object.keys(dc.facets);
      assert.include(facetNames, 'userAgent');
      assert.include(facetNames, 'url');
      assert.include(facetNames, 'checkpoint');
    });
  });

  describe('DataChunks integration', () => {
    it('ingests bundles and produces aggregations', () => {
      const dc = new DataChunks();
      addSeriesDefinitions(dc, 'traffic');
      addFacetDefinitions(dc);

      const bundles = [
        utils.addCalculatedProps({
          id: 'b1',
          host: 'www.example.com',
          time: '2025-01-01T10:00:00Z',
          timeSlot: '2025-01-01T10:00:00Z',
          url: 'https://www.example.com/page1',
          weight: 100,
          events: [
            { checkpoint: 'enter', source: 'https://www.google.com', target: '' },
            { checkpoint: 'click', source: '.btn', target: '/next' },
          ],
          userAgent: 'desktop:windows',
        }),
        utils.addCalculatedProps({
          id: 'b2',
          host: 'www.example.com',
          time: '2025-01-01T11:00:00Z',
          timeSlot: '2025-01-01T11:00:00Z',
          url: 'https://www.example.com/page2',
          weight: 100,
          events: [],
          userAgent: 'mobile:ios',
        }),
      ];

      dc.load([{ rumBundles: bundles }]);

      // First bundle: visit=true, has click → ok
      // Second bundle: visit=false → meh
      const { totals } = dc;
      assert.isAbove(totals.ok.sum, 0);
      assert.isAbove(totals.meh.sum, 0);
    });

    it('groups by time bucket and produces chart data', () => {
      const dc = new DataChunks();
      addSeriesDefinitions(dc, 'traffic');

      const bundles = [
        utils.addCalculatedProps({
          id: 'b1',
          host: 'www.example.com',
          time: '2025-01-01T10:30:00Z',
          timeSlot: '2025-01-01T10:00:00Z',
          url: 'https://www.example.com/page1',
          weight: 100,
          events: [{ checkpoint: 'enter', source: '', target: '' }],
          userAgent: 'desktop:windows',
        }),
        utils.addCalculatedProps({
          id: 'b2',
          host: 'www.example.com',
          time: '2025-01-01T11:30:00Z',
          timeSlot: '2025-01-01T11:00:00Z',
          url: 'https://www.example.com/page2',
          weight: 100,
          events: [
            { checkpoint: 'enter', source: '', target: '' },
            { checkpoint: 'click', source: '.btn', target: '/next' },
          ],
          userAgent: 'desktop:windows',
        }),
      ];

      dc.load([{ rumBundles: bundles }]);
      const bucketFn = getTimeBucketConfig('hourly');
      dc.group(bucketFn);

      const chartData = transformToChartData(dc.aggregates);
      assert.isAbove(chartData.length, 0);

      // Each chart point should have the expected shape
      chartData.forEach((point) => {
        assert.isString(point.t);
        assert.isNumber(point.cnt_ok);
        assert.isNumber(point.cnt_4xx);
        assert.isNumber(point.cnt_5xx);
        assert.isAtLeast(point.cnt_ok, 0);
        assert.isAtLeast(point.cnt_4xx, 0);
        assert.isAtLeast(point.cnt_5xx, 0);
      });
    });
  });

  describe('fetchRumData integration', () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = window.fetch;
    });

    afterEach(() => {
      window.fetch = originalFetch;
    });

    function createMockBundles() {
      return [
        {
          id: 'b1',
          host: 'www.example.com',
          time: '2025-01-01T10:00:00Z',
          timeSlot: '2025-01-01T10:00:00Z',
          url: 'https://www.example.com/',
          weight: 100,
          events: [
            { checkpoint: 'enter', source: 'https://www.google.com', target: '' },
            { checkpoint: 'click', source: '.hero-btn', target: '/products' },
            { checkpoint: 'cwv-lcp', value: 1500 },
          ],
          userAgent: 'desktop:windows',
        },
        {
          id: 'b2',
          host: 'www.example.com',
          time: '2025-01-01T10:05:00Z',
          timeSlot: '2025-01-01T10:00:00Z',
          url: 'https://www.example.com/about',
          weight: 100,
          events: [],
          userAgent: 'mobile:ios',
        },
      ];
    }

    it('returns chart data in correct format', async () => {
      const mockBundles = createMockBundles();
      window.fetch = async () => new Response(
        JSON.stringify({ rumBundles: mockBundles }),
        { status: 200 },
      );

      const result = await fetchRumData({
        domain: 'www.example.com',
        domainkey: 'test-key',
        startDate: new Date('2025-01-01T10:00:00Z'),
        endDate: new Date('2025-01-01T11:00:00Z'),
        viewType: 'traffic',
      });

      assert.isNull(result.error);
      assert.isArray(result.chartData);
      result.chartData.forEach((point) => {
        assert.isString(point.t);
        assert.isNumber(point.cnt_ok);
        assert.isNumber(point.cnt_4xx);
        assert.isNumber(point.cnt_5xx);
      });
    });

    it('returns breakdown data with sum invariant', async () => {
      const mockBundles = createMockBundles();
      window.fetch = async () => new Response(
        JSON.stringify({ rumBundles: mockBundles }),
        { status: 200 },
      );

      const result = await fetchRumData({
        domain: 'www.example.com',
        domainkey: 'test-key',
        startDate: new Date('2025-01-01T10:00:00Z'),
        endDate: new Date('2025-01-01T11:00:00Z'),
        viewType: 'traffic',
      });

      assert.isNull(result.error);
      assert.isObject(result.breakdowns);

      // Check all breakdowns maintain sum invariant
      Object.values(result.breakdowns).forEach((facetRows) => {
        facetRows.forEach((row) => {
          assert.isString(row.dim);
          assert.isNumber(row.cnt);
          assert.isNumber(row.cnt_ok);
          assert.isNumber(row.cnt_4xx);
          assert.isNumber(row.cnt_5xx);
          assert.strictEqual(row.cnt, row.cnt_ok + row.cnt_4xx + row.cnt_5xx);
        });
      });
    });

    it('returns totals with correct metrics', async () => {
      const mockBundles = createMockBundles();
      window.fetch = async () => new Response(
        JSON.stringify({ rumBundles: mockBundles }),
        { status: 200 },
      );

      const result = await fetchRumData({
        domain: 'www.example.com',
        domainkey: 'test-key',
        startDate: new Date('2025-01-01T10:00:00Z'),
        endDate: new Date('2025-01-01T11:00:00Z'),
        viewType: 'traffic',
      });

      assert.isNull(result.error);
      assert.isObject(result.totals);
      assert.isNumber(result.totals.pageViews);
      assert.isNumber(result.totals.visits);
      assert.isNumber(result.totals.bounces);
      assert.isNumber(result.totals.lcpP75);
      assert.isNumber(result.totals.clsP75);
      assert.isNumber(result.totals.inpP75);
    });

    it('handles 403 error gracefully', async () => {
      window.fetch = async () => new Response('Forbidden', { status: 403 });

      const result = await fetchRumData({
        domain: 'www.example.com',
        domainkey: 'invalid-key',
        startDate: new Date('2025-01-01T00:00:00Z'),
        endDate: new Date('2025-01-01T01:00:00Z'),
        viewType: 'traffic',
      });

      assert.strictEqual(result.error, 'auth');
      assert.deepEqual(result.chartData, []);
    });

    it('handles network error gracefully', async () => {
      window.fetch = async () => {
        throw new Error('Network error');
      };

      const result = await fetchRumData({
        domain: 'www.example.com',
        domainkey: 'test-key',
        startDate: new Date('2025-01-01T00:00:00Z'),
        endDate: new Date('2025-01-01T01:00:00Z'),
        viewType: 'traffic',
      });

      assert.isNotNull(result.error);
      assert.deepEqual(result.chartData, []);
    });

    it('handles empty data (no bundles) gracefully', async () => {
      window.fetch = async () => new Response(
        JSON.stringify({ rumBundles: [] }),
        { status: 200 },
      );

      const result = await fetchRumData({
        domain: 'www.example.com',
        domainkey: 'test-key',
        startDate: new Date('2025-01-01T00:00:00Z'),
        endDate: new Date('2025-01-01T01:00:00Z'),
        viewType: 'traffic',
      });

      assert.isNull(result.error);
      assert.deepEqual(result.chartData, []);
      assert.isObject(result.breakdowns);
    });

    it('handles abort signal cancellation', async () => {
      const controller = new AbortController();
      controller.abort();

      window.fetch = async (url, opts) => {
        if (opts?.signal?.aborted) {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          throw err;
        }
        return new Response('{}', { status: 200 });
      };

      const result = await fetchRumData({
        domain: 'www.example.com',
        domainkey: 'test-key',
        startDate: new Date('2025-01-01T00:00:00Z'),
        endDate: new Date('2025-01-01T01:00:00Z'),
        viewType: 'traffic',
        signal: controller.signal,
      });

      // Aborted requests should not be treated as errors
      assert.isNull(result.error);
    });

    it('works with LCP view type', async () => {
      const mockBundles = [{
        id: 'b1',
        host: 'www.example.com',
        time: '2025-01-01T10:00:00Z',
        timeSlot: '2025-01-01T10:00:00Z',
        url: 'https://www.example.com/',
        weight: 100,
        events: [
          { checkpoint: 'enter', source: '', target: '' },
          { checkpoint: 'cwv-lcp', value: 1500 },
        ],
        userAgent: 'desktop:windows',
      }];

      window.fetch = async () => new Response(
        JSON.stringify({ rumBundles: mockBundles }),
        { status: 200 },
      );

      const result = await fetchRumData({
        domain: 'www.example.com',
        domainkey: 'test-key',
        startDate: new Date('2025-01-01T10:00:00Z'),
        endDate: new Date('2025-01-01T11:00:00Z'),
        viewType: 'lcp',
      });

      assert.isNull(result.error);
      assert.isArray(result.chartData);
      // LCP 1500ms is "good", so we expect cnt_ok > 0
      const total = result.chartData.reduce((s, p) => s + p.cnt_ok, 0);
      assert.isAbove(total, 0);
    });
  });
});
