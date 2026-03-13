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
  buildTimeSeriesQuery,
  buildBreakdownQuery,
  buildLogsQuery,
  formatValue,
  buildFilterExpression,
  buildFilterClause,
  buildGroupByExpression,
  buildGroupByClause,
  buildAggregationExpression,
  buildAggregateClause,
  buildTimeRangeExpression,
  mapFieldPath,
} from './query-builder.js';

describe('Data Prime Query Builder', () => {
  describe('mapFieldPath', () => {
    it('should map known fields correctly', () => {
      assert.strictEqual(mapFieldPath('timestamp'), '$m.timestamp');
      assert.strictEqual(mapFieldPath('source'), '$l.subsystemname');
      assert.strictEqual(mapFieldPath('request.host'), '$d.request.host');
      assert.strictEqual(mapFieldPath('response.status'), '$d.response.status');
      assert.strictEqual(mapFieldPath('cdn.cache_status'), '$d.cdn.cache_status');
    });

    it('should default unknown fields to data prefix', () => {
      assert.strictEqual(mapFieldPath('custom.field'), '$d.custom.field');
      assert.strictEqual(mapFieldPath('unknown'), '$d.unknown');
    });
  });

  describe('formatValue', () => {
    it('should quote strings and escape quotes', () => {
      assert.strictEqual(formatValue('hello'), "'hello'");
      assert.strictEqual(formatValue("it's"), "'it\\'s'");
      assert.strictEqual(formatValue('test'), "'test'");
    });

    it('should not quote numbers', () => {
      assert.strictEqual(formatValue(42), '42');
      assert.strictEqual(formatValue(3.14), '3.14');
      assert.strictEqual(formatValue(0), '0');
    });

    it('should not quote booleans', () => {
      assert.strictEqual(formatValue(true), 'true');
      assert.strictEqual(formatValue(false), 'false');
    });

    it('should format arrays', () => {
      assert.strictEqual(formatValue([1, 2, 3]), '[1, 2, 3]');
      assert.strictEqual(formatValue(['a', 'b']), "['a', 'b']");
      assert.strictEqual(formatValue([]), '[]');
    });

    it('should respect fieldType hints', () => {
      assert.strictEqual(formatValue('123', 'STRING'), "'123'");
      assert.strictEqual(formatValue('123', 'NUM'), '123');
      assert.strictEqual(formatValue(true, 'BOOL'), 'true');
    });
  });

  describe('buildFilterExpression', () => {
    it('should build equality filters', () => {
      const filter = {
        field: 'response.status',
        operator: '==',
        value: 200,
        fieldType: 'NUM',
      };
      assert.strictEqual(buildFilterExpression(filter), '$d.response.status == 200');
    });

    it('should build inequality filters', () => {
      const filter = {
        field: 'response.status',
        operator: '!=',
        value: 404,
        fieldType: 'NUM',
      };
      assert.strictEqual(buildFilterExpression(filter), '$d.response.status != 404');
    });

    it('should build comparison filters', () => {
      assert.strictEqual(
        buildFilterExpression({
          field: 'response.status', operator: '>=', value: 400, fieldType: 'NUM',
        }),
        '$d.response.status >= 400',
      );
      assert.strictEqual(
        buildFilterExpression({
          field: 'cdn.time_elapsed_msec', operator: '>', value: 1000, fieldType: 'NUM',
        }),
        '$d.cdn.time_elapsed_msec > 1000',
      );
    });

    it('should build string filters with contains', () => {
      const filter = {
        field: 'request.url',
        operator: 'contains',
        value: '/api/',
        fieldType: 'STRING',
      };
      assert.strictEqual(buildFilterExpression(filter), "$d.request.url.contains('/api/')");
    });

    it('should build string filters with startsWith', () => {
      const filter = {
        field: 'request.host',
        operator: 'startsWith',
        value: 'www.',
        fieldType: 'STRING',
      };
      assert.strictEqual(buildFilterExpression(filter), "$d.request.host.startsWith('www.')");
    });

    it('should build in filters', () => {
      const filter = {
        field: 'response.status',
        operator: 'in',
        value: [200, 201, 204],
        fieldType: 'NUM',
      };
      assert.strictEqual(buildFilterExpression(filter), '$d.response.status in [200, 201, 204]');
    });

    it('should build null check filters', () => {
      assert.strictEqual(
        buildFilterExpression({ field: 'helix.request_type', operator: 'isNull' }),
        '$d.helix.request_type == null',
      );
      assert.strictEqual(
        buildFilterExpression({ field: 'helix.backend_type', operator: 'isNotNull' }),
        '$d.helix.backend_type != null',
      );
    });
  });

  describe('buildFilterClause', () => {
    it('should return empty string for no filters', () => {
      assert.strictEqual(buildFilterClause([]), '');
    });

    it('should return single filter expression', () => {
      const filters = [
        {
          field: 'response.status', operator: '==', value: 200, fieldType: 'NUM',
        },
      ];
      assert.strictEqual(buildFilterClause(filters), '$d.response.status == 200');
    });

    it('should join multiple filters with AND', () => {
      const filters = [
        {
          field: 'response.status', operator: '>=', value: 400, fieldType: 'NUM', logicalOperator: 'AND',
        },
        {
          field: 'request.host', operator: '==', value: 'example.com', fieldType: 'STRING',
        },
      ];
      const result = buildFilterClause(filters);
      assert.match(result, /&&/);
      assert.match(result, /\$d\.response\.status >= 400/);
      assert.match(result, /\$d\.request\.host == 'example\.com'/);
    });

    it('should join multiple filters with OR', () => {
      const filters = [
        {
          field: 'response.status', operator: '==', value: 404, fieldType: 'NUM', logicalOperator: 'OR',
        },
        {
          field: 'response.status', operator: '==', value: 500, fieldType: 'NUM',
        },
      ];
      const result = buildFilterClause(filters);
      assert.match(result, /\|\|/);
      assert.match(result, /\$d\.response\.status == 404/);
      assert.match(result, /\$d\.response\.status == 500/);
    });
  });

  describe('buildTimeRangeExpression', () => {
    it('should build relative time ranges', () => {
      const timeRange = {
        type: 'relative',
        from: '-10m',
        to: '0',
      };
      assert.strictEqual(buildTimeRangeExpression(timeRange), 'between now(-10m) and now()');
    });

    it('should build relative time ranges with non-zero end', () => {
      const timeRange = {
        type: 'relative',
        from: '-1h',
        to: '-5m',
      };
      assert.strictEqual(buildTimeRangeExpression(timeRange), 'between now(-1h) and now(-5m)');
    });

    it('should build absolute time ranges', () => {
      const timeRange = {
        type: 'absolute',
        from: '2025-11-21T00:00:00',
        to: '2025-11-22T00:00:00',
      };
      assert.strictEqual(
        buildTimeRangeExpression(timeRange),
        "between @'2025-11-21T00:00:00' and @'2025-11-22T00:00:00'",
      );
    });

    it('should handle empty relative time values as now()', () => {
      const timeRange = {
        type: 'relative',
        from: '',
        to: '0m',
      };
      assert.strictEqual(buildTimeRangeExpression(timeRange), 'between now() and now()');
    });
  });

  describe('buildGroupByExpression', () => {
    it('should build simple group by field', () => {
      const field = { field: 'response.status' };
      assert.strictEqual(buildGroupByExpression(field), '$d.response.status');
    });

    it('should build group by with alias', () => {
      const field = { field: 'response.status', alias: 'status' };
      assert.strictEqual(buildGroupByExpression(field), '$d.response.status as status');
    });

    it('should build group by with bucket transform', () => {
      const field = {
        field: 'timestamp',
        transform: 'bucket',
        transformParams: { interval: '1m' },
        alias: 'bucket',
      };
      assert.strictEqual(buildGroupByExpression(field), '$m.timestamp.bucket(1m) as bucket');
    });

    it('should build group by with toLowerCase transform', () => {
      const field = {
        field: 'request.host',
        transform: 'toLowerCase',
      };
      assert.strictEqual(buildGroupByExpression(field), '$d.request.host.toLowerCase()');
    });

    it('should build group by with toUpperCase transform', () => {
      const field = {
        field: 'cdn.cache_status',
        transform: 'toUpperCase',
        alias: 'status',
      };
      assert.strictEqual(buildGroupByExpression(field), '$d.cdn.cache_status.toUpperCase() as status');
    });
  });

  describe('buildGroupByClause', () => {
    it('should return empty string for no fields', () => {
      assert.strictEqual(buildGroupByClause([]), '');
    });

    it('should build single field group by', () => {
      const fields = [{ field: 'response.status', alias: 'status' }];
      assert.strictEqual(buildGroupByClause(fields), '$d.response.status as status');
    });

    it('should build multiple field group by', () => {
      const fields = [
        { field: 'response.status', alias: 'status' },
        { field: 'request.host', alias: 'host' },
      ];
      assert.strictEqual(
        buildGroupByClause(fields),
        '$d.response.status as status, $d.request.host as host',
      );
    });
  });

  describe('buildAggregationExpression', () => {
    it('should build count() aggregation', () => {
      const agg = { type: 'count', alias: 'total' };
      assert.strictEqual(buildAggregationExpression(agg), 'count() as total');
    });

    it('should build count(field) aggregation', () => {
      const agg = { type: 'count', field: 'response.status', alias: 'status_count' };
      assert.strictEqual(buildAggregationExpression(agg), 'count($d.response.status) as status_count');
    });

    it('should build distinct_count aggregation', () => {
      const agg = { type: 'distinct_count', field: 'client.ip', alias: 'unique_ips' };
      assert.strictEqual(buildAggregationExpression(agg), 'distinct_count($d.client.ip) as unique_ips');
    });

    it('should build avg aggregation', () => {
      const agg = { type: 'avg', field: 'cdn.time_elapsed_msec', alias: 'avg_time' };
      assert.strictEqual(buildAggregationExpression(agg), 'avg($d.cdn.time_elapsed_msec) as avg_time');
    });

    it('should build max aggregation', () => {
      const agg = { type: 'max', field: 'response.body_size', alias: 'max_size' };
      assert.strictEqual(buildAggregationExpression(agg), 'max($d.response.body_size) as max_size');
    });

    it('should build min aggregation', () => {
      const agg = { type: 'min', field: 'response.body_size', alias: 'min_size' };
      assert.strictEqual(buildAggregationExpression(agg), 'min($d.response.body_size) as min_size');
    });

    it('should build sum aggregation', () => {
      const agg = { type: 'sum', field: 'response.body_size', alias: 'total_bytes' };
      assert.strictEqual(buildAggregationExpression(agg), 'sum($d.response.body_size) as total_bytes');
    });

    it('should build percentile aggregation', () => {
      const agg = {
        type: 'percentile',
        field: 'cdn.time_elapsed_msec',
        params: { percentile: 0.99 },
        alias: 'p99',
      };
      assert.strictEqual(
        buildAggregationExpression(agg),
        'percentile(0.99, $d.cdn.time_elapsed_msec) as p99',
      );
    });

    it('should build percentile aggregation with precision', () => {
      const agg = {
        type: 'percentile',
        field: 'cdn.time_elapsed_msec',
        params: { percentile: 0.95, precision: 100 },
        alias: 'p95',
      };
      assert.strictEqual(
        buildAggregationExpression(agg),
        'percentile(0.95, $d.cdn.time_elapsed_msec, 100) as p95',
      );
    });

    it('should throw for aggregations requiring field without field', () => {
      assert.throws(
        () => buildAggregationExpression({ type: 'avg', alias: 'avg' }),
        /avg requires a field/,
      );
      assert.throws(
        () => buildAggregationExpression({ type: 'distinct_count', alias: 'cnt' }),
        /distinct_count requires a field/,
      );
      assert.throws(
        () => buildAggregationExpression({ type: 'percentile', alias: 'p99' }),
        /percentile requires a field/,
      );
    });

    it('should throw for unknown aggregation type', () => {
      assert.throws(
        () => buildAggregationExpression({ type: 'unknown', alias: 'x' }),
        /Unknown aggregation type/,
      );
    });
  });

  describe('buildAggregateClause', () => {
    it('should return empty string for no aggregations', () => {
      assert.strictEqual(buildAggregateClause([]), '');
    });

    it('should build single aggregation', () => {
      const aggs = [{ type: 'count', alias: 'cnt' }];
      assert.strictEqual(buildAggregateClause(aggs), 'count() as cnt');
    });

    it('should build multiple aggregations', () => {
      const aggs = [
        { type: 'count', alias: 'cnt' },
        { type: 'avg', field: 'cdn.time_elapsed_msec', alias: 'avg_time' },
      ];
      assert.strictEqual(
        buildAggregateClause(aggs),
        'count() as cnt, avg($d.cdn.time_elapsed_msec) as avg_time',
      );
    });
  });

  describe('buildTimeSeriesQuery', () => {
    it('should build basic time series query', () => {
      const params = {
        timeRange: { type: 'relative', from: '-10m', to: '0' },
        interval: '1m',
      };
      const query = buildTimeSeriesQuery(params);

      assert.match(query, /^source logs between now\(-10m\) and now\(\)/);
      assert.match(query, /groupby \$m\.timestamp\.bucket\(1m\) as bucket/);
      assert.match(query, /aggregate count\(\) as requests/);
    });

    it('should include host filter', () => {
      const params = {
        timeRange: { type: 'relative', from: '-1h', to: '0' },
        interval: '5m',
        hostFilter: 'example.com',
      };
      const query = buildTimeSeriesQuery(params);

      assert.match(query, /filter \$d\.request\.host == 'example\.com'/);
    });

    it('should include additional filters', () => {
      const params = {
        timeRange: { type: 'relative', from: '-1h', to: '0' },
        interval: '5m',
        filters: [
          {
            field: 'response.status', operator: '>=', value: 400, fieldType: 'NUM',
          },
        ],
      };
      const query = buildTimeSeriesQuery(params);

      assert.match(query, /filter \$d\.response\.status >= 400/);
    });

    it('should combine host filter with other filters', () => {
      const params = {
        timeRange: { type: 'relative', from: '-1h', to: '0' },
        interval: '1m',
        hostFilter: 'example.com',
        filters: [
          {
            field: 'response.status', operator: '==', value: 500, fieldType: 'NUM',
          },
        ],
      };
      const query = buildTimeSeriesQuery(params);

      // Should have both filters
      assert.match(query, /\$d\.response\.status == 500/);
      assert.match(query, /\$d\.request\.host == 'example\.com'/);
    });
  });

  describe('buildBreakdownQuery', () => {
    it('should build basic breakdown query', () => {
      const params = {
        dimension: 'response.status',
        topN: 10,
      };
      const query = buildBreakdownQuery(params);

      assert.match(query, /^source logs \|/);
      assert.match(query, /groupby \$d\.response\.status as dim/);
      assert.match(query, /aggregate count\(\) as cnt/);
      assert.match(query, /limit 10$/);
    });

    it('should include time range', () => {
      const params = {
        dimension: 'cdn.cache_status',
        topN: 5,
        timeRange: { type: 'relative', from: '-1h', to: '0' },
      };
      const query = buildBreakdownQuery(params);

      assert.match(query, /^source logs between now\(-1h\) and now\(\)/);
    });

    it('should include filters', () => {
      const params = {
        dimension: 'request.host',
        topN: 20,
        filters: [
          {
            field: 'response.status', operator: '>=', value: 500, fieldType: 'NUM',
          },
          {
            field: 'cdn.cache_status', operator: '==', value: 'MISS', fieldType: 'STRING',
          },
        ],
      };
      const query = buildBreakdownQuery(params);

      assert.match(query, /filter.*\$d\.response\.status >= 500/);
      assert.match(query, /\$d\.cdn\.cache_status == 'MISS'/);
    });

    it('should support custom aggregations', () => {
      const params = {
        dimension: 'cdn.datacenter',
        topN: 10,
        aggregations: [
          { type: 'count', alias: 'requests' },
          { type: 'avg', field: 'cdn.time_elapsed_msec', alias: 'avg_latency' },
          { type: 'max', field: 'response.body_size', alias: 'max_size' },
        ],
      };
      const query = buildBreakdownQuery(params);

      assert.match(query, /count\(\) as requests/);
      assert.match(query, /avg\(\$d\.cdn\.time_elapsed_msec\) as avg_latency/);
      assert.match(query, /max\(\$d\.response\.body_size\) as max_size/);
    });

    it('should support topN of 0 (no limit)', () => {
      const params = {
        dimension: 'response.status',
        topN: 0,
      };
      const query = buildBreakdownQuery(params);

      assert.notInclude(query, 'limit');
    });
  });

  describe('buildLogsQuery', () => {
    it('should build basic logs query with default limit', () => {
      const params = {};
      const query = buildLogsQuery(params);

      assert.strictEqual(query, 'source logs | limit 100');
    });

    it('should include time range', () => {
      const params = {
        timeRange: { type: 'relative', from: '-1h', to: '0' },
      };
      const query = buildLogsQuery(params);

      assert.match(query, /^source logs between now\(-1h\) and now\(\)/);
    });

    it('should include filters', () => {
      const params = {
        filters: [
          {
            field: 'response.status', operator: '>=', value: 500, fieldType: 'NUM',
          },
        ],
        limit: 50,
      };
      const query = buildLogsQuery(params);

      assert.match(query, /filter \$d\.response\.status >= 500/);
      assert.match(query, /limit 50$/);
    });

    it('should support custom limit', () => {
      const params = {
        limit: 1000,
      };
      const query = buildLogsQuery(params);

      assert.match(query, /limit 1000$/);
    });

    it('should omit limit when 0', () => {
      const params = {
        limit: 0,
      };
      const query = buildLogsQuery(params);

      assert.notInclude(query, 'limit');
    });

    it('should build complex logs query', () => {
      const params = {
        timeRange: { type: 'absolute', from: '2025-11-21T00:00:00', to: '2025-11-22T00:00:00' },
        filters: [
          {
            field: 'response.status', operator: '==', value: 500, fieldType: 'NUM',
          },
          {
            field: 'request.url', operator: 'contains', value: '/api/', fieldType: 'STRING',
          },
        ],
        limit: 500,
      };
      const query = buildLogsQuery(params);

      assert.match(query, /between @'2025-11-21T00:00:00' and @'2025-11-22T00:00:00'/);
      assert.match(query, /\$d\.response\.status == 500/);
      assert.match(query, /\$d\.request\.url\.contains\('\/api\/'\)/);
      assert.match(query, /limit 500$/);
    });
  });

  describe('Integration Tests', () => {
    it('should build a complete CDN analytics query', () => {
      const query = buildBreakdownQuery({
        dimension: 'cdn.cache_status',
        topN: 10,
        timeRange: { type: 'relative', from: '-1h', to: '0' },
        filters: [
          {
            field: 'source', operator: '==', value: 'cloudflare', fieldType: 'STRING',
          },
        ],
        aggregations: [
          { type: 'count', alias: 'requests' },
          { type: 'avg', field: 'cdn.time_elapsed_msec', alias: 'avg_latency' },
        ],
      });

      const expected = "source logs between now(-1h) and now() | filter $l.subsystemname == 'cloudflare' | groupby $d.cdn.cache_status as dim | aggregate count() as requests, avg($d.cdn.time_elapsed_msec) as avg_latency | limit 10";
      assert.strictEqual(query, expected);
    });

    it('should build an error tracking query', () => {
      const query = buildTimeSeriesQuery({
        timeRange: { type: 'relative', from: '-24h', to: '0' },
        interval: '1h',
        filters: [
          {
            field: 'response.status', operator: '>=', value: 500, fieldType: 'NUM',
          },
        ],
      });

      assert.match(query, /source logs between now\(-24h\) and now\(\)/);
      assert.match(query, /filter \$d\.response\.status >= 500/);
      assert.match(query, /groupby \$m\.timestamp\.bucket\(1h\) as bucket/);
      assert.match(query, /aggregate count\(\) as requests/);
    });

    it('should build a host-specific performance query', () => {
      const query = buildBreakdownQuery({
        dimension: 'request.url',
        topN: 20,
        timeRange: { type: 'relative', from: '-6h', to: '0' },
        filters: [
          {
            field: 'request.host', operator: '==', value: 'www.example.com', fieldType: 'STRING',
          },
        ],
        aggregations: [
          { type: 'count', alias: 'hits' },
          { type: 'avg', field: 'cdn.time_elapsed_msec', alias: 'avg_time' },
          {
            type: 'percentile',
            field: 'cdn.time_elapsed_msec',
            params: { percentile: 0.99 },
            alias: 'p99_time',
          },
        ],
      });

      assert.match(query, /source logs between now\(-6h\) and now\(\)/);
      assert.match(query, /\$d\.request\.host == 'www\.example\.com'/);
      assert.match(query, /groupby \$d\.request\.url as dim/);
      assert.match(query, /count\(\) as hits/);
      assert.match(query, /avg\(\$d\.cdn\.time_elapsed_msec\) as avg_time/);
      assert.match(query, /percentile\(0\.99, \$d\.cdn\.time_elapsed_msec\) as p99_time/);
      assert.match(query, /limit 20$/);
    });
  });
});
