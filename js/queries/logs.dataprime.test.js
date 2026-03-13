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
import {
  buildTimeFilter,
  buildHostFilter,
  buildFacetFilters,
  buildChooseClause,
  buildLogsQuery,
  parseTimeFilterBounds,
} from './logs.dataprime.js';

describe('Data Prime Logs Query Builder', () => {
  describe('buildTimeFilter', () => {
    it('should build time filter with start and end timestamps', () => {
      const start = new Date('2025-02-16T18:00:00.000Z');
      const end = new Date('2025-02-16T19:00:00.000Z');

      const filter = buildTimeFilter({ start, end });

      assert.strictEqual(
        filter,
        "timestamp >= timestamp('2025-02-16T18:00:00.000Z') && timestamp <= timestamp('2025-02-16T19:00:00.000Z')",
      );
    });

    it('should handle different time ranges', () => {
      const start = new Date('2025-02-15T00:00:00.000Z');
      const end = new Date('2025-02-16T23:59:59.999Z');

      const filter = buildTimeFilter({ start, end });

      assert.include(filter, "timestamp >= timestamp('2025-02-15T00:00:00.000Z')");
      assert.include(filter, "timestamp <= timestamp('2025-02-16T23:59:59.999Z')");
    });
  });

  describe('buildHostFilter', () => {
    it('should return empty string when no host filter provided', () => {
      const filter = buildHostFilter({ hostFilter: null });
      assert.strictEqual(filter, '');
    });

    it('should build filter for request.host or x_forwarded_host by default', () => {
      const filter = buildHostFilter({ hostFilter: 'example.com' });

      assert.strictEqual(
        filter,
        "($l['request.host'].includes('example.com') || $l['request.headers.x_forwarded_host'].includes('example.com'))",
      );
    });

    it('should build filter for specific column when hostFilterColumn provided', () => {
      const filter = buildHostFilter({
        hostFilter: 'example.com',
        hostFilterColumn: 'request.host',
      });

      assert.strictEqual(filter, "$l.request.host.includes('example.com')");
    });

    it('should escape single quotes in host filter', () => {
      const filter = buildHostFilter({ hostFilter: "test's-site.com" });

      assert.include(filter, "test\\'s-site.com");
    });
  });

  describe('buildFacetFilters', () => {
    it('should return empty string when no filters provided', () => {
      assert.strictEqual(buildFacetFilters([]), '');
      assert.strictEqual(buildFacetFilters(null), '');
    });

    it('should build equality filter', () => {
      const filters = [{ col: 'response.status', op: '=', value: '404' }];
      const result = buildFacetFilters(filters);

      assert.strictEqual(result, "$l['response.status'] == '404'");
    });

    it('should build not-equal filter', () => {
      const filters = [{ col: 'cdn.cache_status', op: '!=', value: 'HIT' }];
      const result = buildFacetFilters(filters);

      assert.strictEqual(result, "$l['cdn.cache_status'] != 'HIT'");
    });

    it('should build LIKE filter', () => {
      const filters = [{ col: 'request.url', op: 'LIKE', value: '/api/' }];
      const result = buildFacetFilters(filters);

      assert.strictEqual(result, "$l['request.url'].includes('/api/')");
    });

    it('should build NOT LIKE filter', () => {
      const filters = [{ col: 'request.url', op: 'NOT LIKE', value: '/admin' }];
      const result = buildFacetFilters(filters);

      assert.strictEqual(result, "!$l['request.url'].includes('/admin')");
    });

    it('should build comparison filters', () => {
      const filters = [
        { col: 'response.status', op: '>=', value: '400' },
        { col: 'response.status', op: '<', value: '500' },
      ];
      const result = buildFacetFilters(filters);

      assert.strictEqual(
        result,
        "$l['response.status'] >= 400 && $l['response.status'] < 500",
      );
    });

    it('should build IN filter', () => {
      const filters = [
        { col: 'request.method', op: 'IN', value: ['GET', 'POST'] },
      ];
      const result = buildFacetFilters(filters);

      assert.strictEqual(result, "$l['request.method'] in ['GET', 'POST']");
    });

    it('should combine multiple filters with AND', () => {
      const filters = [
        { col: 'response.status', op: '>=', value: '400' },
        { col: 'cdn.cache_status', op: '=', value: 'MISS' },
        { col: 'request.method', op: '=', value: 'GET' },
      ];
      const result = buildFacetFilters(filters);

      assert.strictEqual(
        result,
        "$l['response.status'] >= 400 && $l['cdn.cache_status'] == 'MISS' && $l['request.method'] == 'GET'",
      );
    });

    it('should escape single quotes in filter values', () => {
      const filters = [{ col: 'request.url', op: '=', value: "/test's-page" }];
      const result = buildFacetFilters(filters);

      assert.include(result, "/test\\'s-page");
    });
  });

  describe('buildChooseClause', () => {
    it('should return * when no fields provided', () => {
      assert.strictEqual(buildChooseClause(null), '*');
      assert.strictEqual(buildChooseClause([]), '*');
    });

    it('should handle timestamp field', () => {
      const fields = ['timestamp'];
      const result = buildChooseClause(fields);

      assert.strictEqual(result, 'timestamp');
    });

    it('should handle dotted field names', () => {
      const fields = ['request.host', 'response.status'];
      const result = buildChooseClause(fields);

      assert.strictEqual(
        result,
        "$l['request.host'] as `request.host`, $l['response.status'] as `response.status`",
      );
    });

    it('should handle mixed field types', () => {
      const fields = ['timestamp', 'request.host', 'request.url', 'response.status'];
      const result = buildChooseClause(fields);

      assert.include(result, 'timestamp');
      assert.include(result, "$l['request.host'] as `request.host`");
      assert.include(result, "$l['request.url'] as `request.url`");
      assert.include(result, "$l['response.status'] as `response.status`");
    });
  });

  describe('buildLogsQuery', () => {
    const baseOptions = {
      start: new Date('2025-02-16T18:00:00.000Z'),
      end: new Date('2025-02-16T19:00:00.000Z'),
    };

    it('should build basic query with time filter only', () => {
      const query = buildLogsQuery(baseOptions);

      assert.include(query, 'source logs');
      assert.include(query, "filter $l.subsystemname in ['cloudflare', 'fastly']");
      assert.include(query, "timestamp >= timestamp('2025-02-16T18:00:00.000Z')");
      assert.include(query, "timestamp <= timestamp('2025-02-16T19:00:00.000Z')");
      assert.include(query, 'sort timestamp desc');
      assert.include(query, 'limit 500');
      assert.notInclude(query, 'offset');
    });

    it('should include host filter when provided', () => {
      const query = buildLogsQuery({
        ...baseOptions,
        hostFilter: 'example.com',
      });

      assert.include(query, "$l['request.host'].includes('example.com')");
    });

    it('should include facet filters when provided', () => {
      const query = buildLogsQuery({
        ...baseOptions,
        facetFilters: [
          { col: 'response.status', op: '>=', value: '400' },
          { col: 'cdn.cache_status', op: '=', value: 'MISS' },
        ],
      });

      assert.include(query, "$l['response.status'] >= 400");
      assert.include(query, "$l['cdn.cache_status'] == 'MISS'");
    });

    it('should include field selection when provided', () => {
      const query = buildLogsQuery({
        ...baseOptions,
        fields: ['timestamp', 'request.host', 'response.status'],
      });

      assert.include(query, 'choose timestamp');
      assert.include(query, "$l['request.host'] as `request.host`");
      assert.include(query, "$l['response.status'] as `response.status`");
    });

    it('should handle custom page size', () => {
      const query = buildLogsQuery({
        ...baseOptions,
        pageSize: 100,
      });

      assert.include(query, 'limit 100');
    });

    it('should handle pagination with offset', () => {
      const query = buildLogsQuery({
        ...baseOptions,
        pageSize: 100,
        offset: 100,
      });

      assert.include(query, 'limit 100 offset 100');
    });

    it('should handle ascending sort order', () => {
      const query = buildLogsQuery({
        ...baseOptions,
        orderBy: 'timestamp ASC',
      });

      assert.include(query, 'sort timestamp asc');
    });

    it('should build complete query with all options', () => {
      const query = buildLogsQuery({
        start: new Date('2025-02-16T18:00:00.000Z'),
        end: new Date('2025-02-16T19:00:00.000Z'),
        hostFilter: 'example.com',
        facetFilters: [
          { col: 'response.status', op: '>=', value: '400' },
          { col: 'request.method', op: '=', value: 'GET' },
        ],
        fields: ['timestamp', 'request.host', 'request.url', 'response.status'],
        pageSize: 50,
        offset: 100,
      });

      // Check all components are present
      assert.include(query, 'source logs');
      assert.include(query, "filter $l.subsystemname in ['cloudflare', 'fastly']");
      assert.include(query, 'timestamp >= timestamp');
      assert.include(query, "$l['request.host'].includes('example.com')");
      assert.include(query, "$l['response.status'] >= 400");
      assert.include(query, "$l['request.method'] == 'GET'");
      assert.include(query, 'choose timestamp');
      assert.include(query, 'sort timestamp desc');
      assert.include(query, 'limit 50 offset 100');
    });

    it('should include additional WHERE clause when provided', () => {
      const query = buildLogsQuery({
        ...baseOptions,
        additionalWhereClause: "$l['helix.request_type'] == 'static'",
      });

      assert.include(query, "filter $l['helix.request_type'] == 'static'");
    });
  });

  describe('parseTimeFilterBounds', () => {
    const TIME_RANGES = {
      '1h': { periodMs: 60 * 60 * 1000 },
      '24h': { periodMs: 24 * 60 * 60 * 1000 },
      '7d': { periodMs: 7 * 24 * 60 * 60 * 1000 },
    };

    it('should use custom time range when provided', () => {
      const timeState = {
        customTimeRange: {
          start: new Date('2025-02-16T10:00:00.000Z'),
          end: new Date('2025-02-16T12:00:00.000Z'),
        },
      };

      const { start, end } = parseTimeFilterBounds(timeState, TIME_RANGES);

      assert.strictEqual(start.toISOString(), '2025-02-16T10:00:00.000Z');
      assert.strictEqual(end.toISOString(), '2025-02-16T12:00:00.000Z');
    });

    it('should calculate range from timeRange and queryTimestamp', () => {
      const queryTimestamp = new Date('2025-02-16T19:00:00.000Z');
      const timeState = {
        timeRange: '1h',
        queryTimestamp,
      };

      const { start, end } = parseTimeFilterBounds(timeState, TIME_RANGES);

      // Should be 1 hour before queryTimestamp
      assert.strictEqual(end.toISOString(), '2025-02-16T19:00:00.000Z');
      assert.strictEqual(start.toISOString(), '2025-02-16T18:00:00.000Z');
    });

    it('should round to minute boundaries', () => {
      const queryTimestamp = new Date('2025-02-16T19:30:45.123Z');
      const timeState = {
        timeRange: '1h',
        queryTimestamp,
      };

      const { start, end } = parseTimeFilterBounds(timeState, TIME_RANGES);

      // Should be rounded to full minutes
      assert.strictEqual(end.getSeconds(), 0);
      assert.strictEqual(end.getMilliseconds(), 0);
      assert.strictEqual(start.getSeconds(), 0);
      assert.strictEqual(start.getMilliseconds(), 0);
    });

    it('should use current time when queryTimestamp not provided', () => {
      const timeState = {
        timeRange: '1h',
      };

      const { start, end } = parseTimeFilterBounds(timeState, TIME_RANGES);

      // End should be close to now (within 1 minute)
      const now = new Date();
      const diffMs = Math.abs(end.getTime() - now.getTime());
      assert.isBelow(diffMs, 60 * 1000);

      // Duration should be 1 hour
      const duration = end.getTime() - start.getTime();
      assert.strictEqual(duration, 60 * 60 * 1000);
    });

    it('should handle different time ranges', () => {
      const queryTimestamp = new Date('2025-02-16T19:00:00.000Z');
      const timeState24h = {
        timeRange: '24h',
        queryTimestamp,
      };

      const { start, end } = parseTimeFilterBounds(timeState24h, TIME_RANGES);

      assert.strictEqual(end.toISOString(), '2025-02-16T19:00:00.000Z');
      assert.strictEqual(start.toISOString(), '2025-02-15T19:00:00.000Z');
    });
  });

  describe('Query Structure', () => {
    it('should produce valid Data Prime query structure', () => {
      const query = buildLogsQuery({
        start: new Date('2025-02-16T18:00:00.000Z'),
        end: new Date('2025-02-16T19:00:00.000Z'),
        hostFilter: 'example.com',
        facetFilters: [{ col: 'response.status', op: '>=', value: '400' }],
        pageSize: 100,
      });

      const lines = query.split('\n');

      // Check query follows Data Prime structure
      assert.strictEqual(lines[0], 'source logs');
      assert.match(lines[1], /^\| filter/);
      assert.match(lines[lines.length - 1], /^\| limit/);

      // All intermediate lines should be filter or processing operators
      for (let i = 1; i < lines.length - 1; i += 1) {
        assert.match(lines[i], /^\| (filter|choose|sort)/);
      }
    });

    it('should handle empty filter arrays gracefully', () => {
      const query = buildLogsQuery({
        start: new Date('2025-02-16T18:00:00.000Z'),
        end: new Date('2025-02-16T19:00:00.000Z'),
        facetFilters: [],
      });

      // Should not include empty filter clause
      assert.notInclude(query, '| filter  &&');
      assert.notInclude(query, '| filter &&');
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in filters', () => {
      const filters = [
        { col: 'request.url', op: 'LIKE', value: '/path?query=value&other=123' },
      ];
      const result = buildFacetFilters(filters);

      assert.include(result, '/path?query=value&other=123');
    });

    it('should handle numeric values in filters', () => {
      const filters = [{ col: 'response.status', op: '>=', value: 400 }];
      const result = buildFacetFilters(filters);

      assert.strictEqual(result, "$l['response.status'] >= 400");
    });

    it('should handle zero offset', () => {
      const query = buildLogsQuery({
        start: new Date('2025-02-16T18:00:00.000Z'),
        end: new Date('2025-02-16T19:00:00.000Z'),
        offset: 0,
      });

      assert.include(query, 'limit 500');
      assert.notInclude(query, 'offset');
    });
  });
});
