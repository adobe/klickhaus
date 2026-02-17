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
import { buildTimeSeriesQuery, buildQuery } from './time-series.dataprime.js';

describe('time-series.dataprime', () => {
  const start = new Date('2025-02-16T18:00:00.000Z');
  const end = new Date('2025-02-16T19:00:00.000Z');

  describe('buildTimeSeriesQuery', () => {
    it('builds basic time-series query with 1-minute buckets', () => {
      const query = buildTimeSeriesQuery({
        start,
        end,
        bucket: 'toStartOfMinute(timestamp)',
      });

      assert.include(query, 'source logs');
      assert.include(query, "filter $l.subsystemname in ['cloudflare', 'fastly']");
      assert.include(query, "timestamp >= timestamp('2025-02-16T18:00:00.000Z')");
      assert.include(query, "timestamp <= timestamp('2025-02-16T19:00:00.000Z')");
      assert.include(query, 'create status_ok = $d.response.status < 400 ? 1 : 0');
      assert.include(query, 'create status_4xx = ($d.response.status >= 400 && $d.response.status < 500) ? 1 : 0');
      assert.include(query, 'create status_5xx = $d.response.status >= 500 ? 1 : 0');
      assert.include(query, 'groupby timestamp.bucket(1m) as t aggregate');
      assert.include(query, 'sum(status_ok) as cnt_ok');
      assert.include(query, 'sum(status_4xx) as cnt_4xx');
      assert.include(query, 'sum(status_5xx) as cnt_5xx');
      assert.include(query, 'sort t asc');
    });

    it('converts bucket intervals correctly', () => {
      const testCases = [
        { bucket: 'toStartOfInterval(timestamp, INTERVAL 5 SECOND)', expected: '5s' },
        { bucket: 'toStartOfInterval(timestamp, INTERVAL 10 SECOND)', expected: '10s' },
        { bucket: 'toStartOfMinute(timestamp)', expected: '1m' },
        { bucket: 'toStartOfFiveMinutes(timestamp)', expected: '5m' },
        { bucket: 'toStartOfTenMinutes(timestamp)', expected: '10m' },
        { bucket: 'toStartOfInterval(timestamp, INTERVAL 1 MINUTE)', expected: '1m' },
        { bucket: 'toStartOfInterval(timestamp, INTERVAL 5 MINUTE)', expected: '5m' },
        { bucket: 'toStartOfInterval(timestamp, INTERVAL 1 HOUR)', expected: '1h' },
      ];

      testCases.forEach(({ bucket, expected }) => {
        const query = buildTimeSeriesQuery({ start, end, bucket });
        assert.include(query, `timestamp.bucket(${expected})`);
      });
    });

    it('includes host filter when provided', () => {
      const query = buildTimeSeriesQuery({
        start,
        end,
        bucket: 'toStartOfMinute(timestamp)',
        hostFilter: 'example.com',
      });

      assert.include(query, "$d.request.host.includes('example.com')");
      assert.include(query, "$d.request.headers.x_forwarded_host.includes('example.com')");
    });

    it('includes facet filters when provided', () => {
      const query = buildTimeSeriesQuery({
        start,
        end,
        bucket: 'toStartOfMinute(timestamp)',
        facetFilters: [
          { col: 'cdn.cache_status', op: '=', value: 'MISS' },
          { col: 'response.status', op: '>=', value: '400' },
        ],
      });

      assert.include(query, "$d.cdn.cache_status == 'MISS'");
      assert.include(query, '$d.response.status >= 400');
    });

    it('includes additional WHERE clause when provided', () => {
      const query = buildTimeSeriesQuery({
        start,
        end,
        bucket: 'toStartOfMinute(timestamp)',
        additionalWhereClause: '$d.helix.request_type == "static"',
      });

      assert.include(query, 'filter $d.helix.request_type == "static"');
    });

    it('handles sampling rate', () => {
      const query = buildTimeSeriesQuery({
        start,
        end,
        bucket: 'toStartOfMinute(timestamp)',
        samplingRate: 0.25,
      });

      // Currently adds a TODO comment
      assert.include(query, 'TODO: Apply sampling rate 0.25');
    });

    it('applies multiplier when sampling is enabled', () => {
      const query = buildTimeSeriesQuery({
        start,
        end,
        bucket: 'toStartOfMinute(timestamp)',
        samplingRate: 0.25,
        multiplier: true,
      });

      assert.include(query, 'sum(status_ok) * 4 as cnt_ok');
      assert.include(query, 'sum(status_4xx) * 4 as cnt_4xx');
      assert.include(query, 'sum(status_5xx) * 4 as cnt_5xx');
    });

    it('does not apply multiplier when multiplier is false', () => {
      const query = buildTimeSeriesQuery({
        start,
        end,
        bucket: 'toStartOfMinute(timestamp)',
        samplingRate: 0.25,
        multiplier: false,
      });

      assert.include(query, 'sum(status_ok) as cnt_ok');
      assert.include(query, 'sum(status_4xx) as cnt_4xx');
      assert.include(query, 'sum(status_5xx) as cnt_5xx');
      assert.notInclude(query, ' * 4 ');
    });

    it('handles complex query with all options', () => {
      const query = buildTimeSeriesQuery({
        start,
        end,
        bucket: 'toStartOfInterval(timestamp, INTERVAL 10 SECOND)',
        hostFilter: 'example.com',
        facetFilters: [
          { col: 'cdn.cache_status', op: '=', value: 'MISS' },
        ],
        additionalWhereClause: '$d.helix.request_type != ""',
        samplingRate: 0.1,
        multiplier: true,
      });

      assert.include(query, 'source logs');
      assert.include(query, "filter $l.subsystemname in ['cloudflare', 'fastly']");
      assert.include(query, "timestamp >= timestamp('2025-02-16T18:00:00.000Z')");
      assert.include(query, "filter ($d.request.host.includes('example.com')");
      assert.include(query, "$d.cdn.cache_status == 'MISS'");
      assert.include(query, 'filter $d.helix.request_type != ""');
      assert.include(query, 'timestamp.bucket(10s)');
      assert.include(query, 'sum(status_ok) * 10 as cnt_ok');
    });

    it('escapes single quotes in filter values', () => {
      const query = buildTimeSeriesQuery({
        start,
        end,
        bucket: 'toStartOfMinute(timestamp)',
        hostFilter: "test's-domain.com",
      });

      assert.include(query, "test\\'s-domain.com");
    });
  });

  describe('buildQuery', () => {
    it('accepts params object with sampling config', () => {
      const query = buildQuery({
        start,
        end,
        bucket: 'toStartOfMinute(timestamp)',
        hostFilter: 'example.com',
        facetFilters: [],
        additionalWhereClause: '',
        sampling: {
          rate: 0.5,
          multiplier: true,
        },
      });

      assert.include(query, 'timestamp.bucket(1m)');
      assert.include(query, 'sum(status_ok) * 2 as cnt_ok');
    });

    it('works without sampling config', () => {
      const query = buildQuery({
        start,
        end,
        bucket: 'toStartOfMinute(timestamp)',
      });

      assert.include(query, 'source logs');
      assert.include(query, 'sum(status_ok) as cnt_ok');
      assert.notInclude(query, '* ');
    });
  });

  describe('facet filter operators', () => {
    it('handles equality operator', () => {
      const query = buildTimeSeriesQuery({
        start,
        end,
        bucket: 'toStartOfMinute(timestamp)',
        facetFilters: [{ col: 'source', op: '=', value: 'cloudflare' }],
      });

      assert.include(query, "$l.subsystemname == 'cloudflare'");
    });

    it('handles inequality operator', () => {
      const query = buildTimeSeriesQuery({
        start,
        end,
        bucket: 'toStartOfMinute(timestamp)',
        facetFilters: [{ col: 'cdn.cache_status', op: '!=', value: 'HIT' }],
      });

      assert.include(query, "$d.cdn.cache_status != 'HIT'");
    });

    it('handles LIKE operator', () => {
      const query = buildTimeSeriesQuery({
        start,
        end,
        bucket: 'toStartOfMinute(timestamp)',
        facetFilters: [{ col: 'request.url', op: 'LIKE', value: '/api/' }],
      });

      assert.include(query, "$d.request.url.includes('/api/')");
    });

    it('handles NOT LIKE operator', () => {
      const query = buildTimeSeriesQuery({
        start,
        end,
        bucket: 'toStartOfMinute(timestamp)',
        facetFilters: [{ col: 'request.url', op: 'NOT LIKE', value: '/static/' }],
      });

      assert.include(query, "!$d.request.url.includes('/static/')");
    });

    it('handles comparison operators', () => {
      const query = buildTimeSeriesQuery({
        start,
        end,
        bucket: 'toStartOfMinute(timestamp)',
        facetFilters: [
          { col: 'response.status', op: '>', value: '399' },
          { col: 'response.status', op: '<', value: '500' },
          { col: 'response.status', op: '>=', value: '400' },
          { col: 'response.status', op: '<=', value: '499' },
        ],
      });

      assert.include(query, '$d.response.status > 399');
      assert.include(query, '$d.response.status < 500');
      assert.include(query, '$d.response.status >= 400');
      assert.include(query, '$d.response.status <= 499');
    });

    it('handles IN operator with array values', () => {
      const query = buildTimeSeriesQuery({
        start,
        end,
        bucket: 'toStartOfMinute(timestamp)',
        facetFilters: [
          { col: 'cdn.cache_status', op: 'IN', value: ['HIT', 'MISS', 'PASS'] },
        ],
      });

      assert.include(query, "$d.cdn.cache_status in ['HIT', 'MISS', 'PASS']");
    });
  });

  describe('time range boundaries', () => {
    it('handles different time ranges', () => {
      const testCases = [
        {
          start: new Date('2025-02-16T00:00:00.000Z'),
          end: new Date('2025-02-16T23:59:59.999Z'),
          label: '24 hours',
        },
        {
          start: new Date('2025-02-09T00:00:00.000Z'),
          end: new Date('2025-02-16T00:00:00.000Z'),
          label: '7 days',
        },
        {
          start: new Date('2025-02-16T18:45:00.000Z'),
          end: new Date('2025-02-16T19:00:00.000Z'),
          label: '15 minutes',
        },
      ];

      testCases.forEach(({ start: testStart, end: testEnd }) => {
        const query = buildTimeSeriesQuery({
          start: testStart,
          end: testEnd,
          bucket: 'toStartOfMinute(timestamp)',
        });

        assert.include(query, `timestamp >= timestamp('${testStart.toISOString()}')`);
        assert.include(query, `timestamp <= timestamp('${testEnd.toISOString()}')`);
      });
    });
  });

  describe('output format', () => {
    it('maintains consistent data structure', () => {
      const query = buildTimeSeriesQuery({
        start,
        end,
        bucket: 'toStartOfMinute(timestamp)',
      });

      // Verify the query includes all required aggregations
      assert.include(query, 'cnt_ok');
      assert.include(query, 'cnt_4xx');
      assert.include(query, 'cnt_5xx');

      // Verify time field is named 't'
      assert.include(query, 'as t aggregate');

      // Verify sort order
      assert.include(query, 'sort t asc');
    });
  });
});
