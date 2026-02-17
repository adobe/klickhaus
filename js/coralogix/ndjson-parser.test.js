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

/* eslint-disable no-underscore-dangle */
// _metadata and _labels are part of the klickhaus format spec

import { assert } from 'chai';
import {
  parseNDJSON,
  parseResultLine,
  extractUserData,
  transformToKlickhausFormat,
  getNestedValue,
  getValueByDataprimePath,
} from './ndjson-parser.js';

describe('ndjson-parser', () => {
  // Helper to create a valid NDJSON result line
  function makeResultLine(userData, labels = [], metadata = []) {
    return JSON.stringify({
      result: {
        results: [{
          userData: JSON.stringify(userData),
          metadata,
          labels,
        }],
      },
    });
  }

  describe('parseNDJSON', () => {
    it('should parse valid NDJSON with queryId and single result', () => {
      const response = `{"queryId": {"queryId": "abc123"}}
${makeResultLine({ count: 42 })}`;

      const { queryId, results } = parseNDJSON(response);

      assert.strictEqual(queryId, 'abc123');
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].count, 42);
      assert.deepStrictEqual(results[0]._metadata, {});
      assert.deepStrictEqual(results[0]._labels, {});
    });

    it('should parse multiple result lines', () => {
      const response = [
        makeResultLine({ count: 1 }),
        makeResultLine({ count: 2 }),
        makeResultLine({ count: 3 }),
      ].join('\n');

      const { results } = parseNDJSON(response);
      assert.strictEqual(results.length, 3);
      assert.strictEqual(results[0].count, 1);
      assert.strictEqual(results[1].count, 2);
      assert.strictEqual(results[2].count, 3);
    });

    it('should parse results with metadata and labels', () => {
      const response = makeResultLine(
        { duration: 123, status: 200 },
        [
          { key: 'serviceName', value: 'api' },
          { key: 'region', value: 'us-east-1' },
        ],
        [
          { key: 'timestamp', value: '2024-01-15T10:00:00Z' },
          { key: 'severity', value: 'INFO' },
        ],
      );

      const { results } = parseNDJSON(response);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].duration, 123);
      assert.strictEqual(results[0].status, 200);
      assert.deepStrictEqual(results[0]._metadata, {
        timestamp: '2024-01-15T10:00:00Z',
        severity: 'INFO',
      });
      assert.deepStrictEqual(results[0]._labels, {
        serviceName: 'api',
        region: 'us-east-1',
      });
    });

    it('should skip lines without result key', () => {
      const response = [
        JSON.stringify({ warning: 'some warning' }),
        makeResultLine({ count: 1 }),
      ].join('\n');

      const { results } = parseNDJSON(response);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].count, 1);
    });

    it('should skip malformed JSON lines', () => {
      const response = [
        'not valid json',
        makeResultLine({ count: 1 }),
      ].join('\n');

      const { results } = parseNDJSON(response);
      assert.strictEqual(results.length, 1);
    });

    it('should skip results without userData', () => {
      const response = JSON.stringify({
        result: {
          results: [{
            metadata: [],
            labels: [],
          }],
        },
      });

      const { results } = parseNDJSON(response);
      assert.strictEqual(results.length, 0);
    });

    it('should skip results with malformed userData', () => {
      const response = JSON.stringify({
        result: {
          results: [{
            userData: 'not valid json {{{',
            metadata: [],
            labels: [],
          }],
        },
      });

      const { results } = parseNDJSON(response);
      assert.strictEqual(results.length, 0);
    });

    it('should handle empty response', () => {
      const { queryId, results } = parseNDJSON('');
      assert.isNull(queryId);
      assert.strictEqual(results.length, 0);
    });

    it('should handle null/undefined input', () => {
      assert.deepStrictEqual(parseNDJSON(null), { queryId: null, results: [] });
      assert.deepStrictEqual(parseNDJSON(undefined), { queryId: null, results: [] });
    });

    it('should handle whitespace-only response', () => {
      const { results } = parseNDJSON('   \n  \n  ');
      assert.strictEqual(results.length, 0);
    });

    it('should parse multiple results within a single line', () => {
      const response = JSON.stringify({
        result: {
          results: [
            { userData: JSON.stringify({ a: 1 }), metadata: [], labels: [] },
            { userData: JSON.stringify({ b: 2 }), metadata: [], labels: [] },
          ],
        },
      });

      const { results } = parseNDJSON(response);
      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0].a, 1);
      assert.strictEqual(results[1].b, 2);
    });

    it('should handle nested userData structures', () => {
      const response = makeResultLine({
        kubernetes: {
          pod: {
            name: 'frontend-123',
            namespace: 'production',
          },
        },
        request: {
          host: 'api.example.com',
          path: '/users',
        },
      });

      const { results } = parseNDJSON(response);
      assert.strictEqual(results[0].kubernetes.pod.name, 'frontend-123');
      assert.strictEqual(results[0].kubernetes.pod.namespace, 'production');
      assert.strictEqual(results[0].request.host, 'api.example.com');
    });
  });

  describe('parseResultLine', () => {
    it('should parse result with all fields', () => {
      const result = {
        metadata: [{ key: 'timestamp', value: '2024-01-15T10:00:00Z' }],
        labels: [{ key: 'serviceName', value: 'api' }],
        userData: '{"status": 200, "duration": 123}',
      };

      const parsed = parseResultLine(result);
      assert.strictEqual(parsed.status, 200);
      assert.strictEqual(parsed.duration, 123);
      assert.deepStrictEqual(parsed._metadata, { timestamp: '2024-01-15T10:00:00Z' });
      assert.deepStrictEqual(parsed._labels, { serviceName: 'api' });
    });

    it('should return null for result without userData', () => {
      const result = {
        metadata: [],
        labels: [],
      };

      assert.isNull(parseResultLine(result));
    });

    it('should return null for null/undefined input', () => {
      assert.isNull(parseResultLine(null));
      assert.isNull(parseResultLine(undefined));
    });

    it('should handle empty metadata and labels arrays', () => {
      const result = {
        userData: '{"count": 5}',
        metadata: [],
        labels: [],
      };

      const parsed = parseResultLine(result);
      assert.strictEqual(parsed.count, 5);
      assert.deepStrictEqual(parsed._metadata, {});
      assert.deepStrictEqual(parsed._labels, {});
    });

    it('should handle missing metadata and labels', () => {
      const result = {
        userData: '{"count": 10}',
      };

      const parsed = parseResultLine(result);
      assert.strictEqual(parsed.count, 10);
      assert.deepStrictEqual(parsed._metadata, {});
      assert.deepStrictEqual(parsed._labels, {});
    });
  });

  describe('extractUserData', () => {
    it('should extract and parse valid userData', () => {
      const result = { userData: '{"count": 42, "status": "ok"}' };
      const data = extractUserData(result);
      assert.deepStrictEqual(data, { count: 42, status: 'ok' });
    });

    it('should return null for missing userData', () => {
      assert.isNull(extractUserData({}));
      assert.isNull(extractUserData(null));
      assert.isNull(extractUserData(undefined));
    });

    it('should return null for malformed userData', () => {
      const result = { userData: 'not valid json' };
      assert.isNull(extractUserData(result));
    });
  });

  describe('transformToKlickhausFormat', () => {
    it('should transform array of results', () => {
      const coralogixResults = [
        {
          status: 200,
          duration: 123,
          _metadata: { timestamp: '2024-01-15T10:00:00Z' },
          _labels: { serviceName: 'api' },
        },
        {
          status: 404,
          duration: 45,
          _metadata: { timestamp: '2024-01-15T10:01:00Z' },
          _labels: { serviceName: 'web' },
        },
      ];

      const transformed = transformToKlickhausFormat(coralogixResults);
      assert.strictEqual(transformed.length, 2);
      assert.strictEqual(transformed[0].status, 200);
      assert.strictEqual(transformed[0]._metadata.timestamp, '2024-01-15T10:00:00Z');
      assert.strictEqual(transformed[1].status, 404);
    });

    it('should handle empty array', () => {
      assert.deepStrictEqual(transformToKlickhausFormat([]), []);
    });

    it('should handle non-array input', () => {
      assert.deepStrictEqual(transformToKlickhausFormat(null), []);
      assert.deepStrictEqual(transformToKlickhausFormat(undefined), []);
      assert.deepStrictEqual(transformToKlickhausFormat('not an array'), []);
    });
  });

  describe('getNestedValue', () => {
    it('should get nested value from object', () => {
      const obj = {
        kubernetes: {
          pod: {
            name: 'frontend-123',
          },
        },
      };

      assert.strictEqual(getNestedValue(obj, 'kubernetes.pod.name'), 'frontend-123');
    });

    it('should get top-level value', () => {
      const obj = { status: 200 };
      assert.strictEqual(getNestedValue(obj, 'status'), 200);
    });

    it('should return undefined for missing path', () => {
      const obj = { a: { b: 1 } };
      assert.isUndefined(getNestedValue(obj, 'a.c'));
      assert.isUndefined(getNestedValue(obj, 'x.y.z'));
    });

    it('should handle null/undefined values in path', () => {
      const obj = { a: { b: null } };
      assert.isUndefined(getNestedValue(obj, 'a.b.c'));
    });

    it('should return undefined for empty path', () => {
      assert.isUndefined(getNestedValue({ a: 1 }, ''));
      assert.isUndefined(getNestedValue({ a: 1 }, null));
    });
  });

  describe('getValueByDataprimePath', () => {
    const record = {
      duration: 123,
      status: 200,
      kubernetes: {
        pod: {
          name: 'frontend-123',
        },
      },
      _metadata: {
        severity: 'INFO',
        timestamp: '2024-01-15T10:00:00Z',
      },
      _labels: {
        serviceName: 'api',
        region: 'us-east-1',
      },
    };

    it('should get metadata value with $m prefix', () => {
      assert.strictEqual(getValueByDataprimePath(record, '$m.severity'), 'INFO');
      assert.strictEqual(getValueByDataprimePath(record, '$m.timestamp'), '2024-01-15T10:00:00Z');
    });

    it('should get labels value with $l prefix', () => {
      assert.strictEqual(getValueByDataprimePath(record, '$l.serviceName'), 'api');
      assert.strictEqual(getValueByDataprimePath(record, '$l.region'), 'us-east-1');
    });

    it('should get userData value with $d prefix', () => {
      assert.strictEqual(getValueByDataprimePath(record, '$d.duration'), 123);
      assert.strictEqual(getValueByDataprimePath(record, '$d.status'), 200);
    });

    it('should get nested userData value with $d prefix', () => {
      assert.strictEqual(getValueByDataprimePath(record, '$d.kubernetes.pod.name'), 'frontend-123');
    });

    it('should get userData value without prefix', () => {
      assert.strictEqual(getValueByDataprimePath(record, 'duration'), 123);
      assert.strictEqual(getValueByDataprimePath(record, 'kubernetes.pod.name'), 'frontend-123');
    });

    it('should return undefined for missing metadata field', () => {
      assert.isUndefined(getValueByDataprimePath(record, '$m.missing'));
    });

    it('should return undefined for missing labels field', () => {
      assert.isUndefined(getValueByDataprimePath(record, '$l.missing'));
    });

    it('should return undefined for missing userData field', () => {
      assert.isUndefined(getValueByDataprimePath(record, '$d.missing'));
    });

    it('should handle null/undefined record', () => {
      assert.isUndefined(getValueByDataprimePath(null, '$m.severity'));
      assert.isUndefined(getValueByDataprimePath(undefined, '$l.serviceName'));
    });

    it('should handle empty path', () => {
      assert.isUndefined(getValueByDataprimePath(record, ''));
      assert.isUndefined(getValueByDataprimePath(record, null));
    });

    it('should handle record without _metadata', () => {
      const recordWithoutMetadata = { duration: 123 };
      assert.isUndefined(getValueByDataprimePath(recordWithoutMetadata, '$m.severity'));
    });

    it('should handle record without _labels', () => {
      const recordWithoutLabels = { duration: 123 };
      assert.isUndefined(getValueByDataprimePath(recordWithoutLabels, '$l.serviceName'));
    });
  });

  describe('integration: full NDJSON parsing workflow', () => {
    it('should parse complete Coralogix response', () => {
      const response = `{"queryId": {"queryId": "query-123"}}
${makeResultLine(
    { duration: 100, status: 200, request: { host: 'api.example.com' } },
    [{ key: 'serviceName', value: 'frontend' }],
    [{ key: 'timestamp', value: '2024-01-15T10:00:00Z' }],
  )}
${makeResultLine(
    { duration: 200, status: 404, request: { host: 'api.example.com' } },
    [{ key: 'serviceName', value: 'backend' }],
    [{ key: 'timestamp', value: '2024-01-15T10:01:00Z' }],
  )}`;

      const { queryId, results } = parseNDJSON(response);

      assert.strictEqual(queryId, 'query-123');
      assert.strictEqual(results.length, 2);

      // First result
      assert.strictEqual(results[0].duration, 100);
      assert.strictEqual(results[0].status, 200);
      assert.strictEqual(results[0].request.host, 'api.example.com');
      assert.strictEqual(results[0]._labels.serviceName, 'frontend');
      assert.strictEqual(results[0]._metadata.timestamp, '2024-01-15T10:00:00Z');

      // Second result
      assert.strictEqual(results[1].duration, 200);
      assert.strictEqual(results[1].status, 404);
      assert.strictEqual(results[1]._labels.serviceName, 'backend');

      // Test DataPrime path access
      assert.strictEqual(getValueByDataprimePath(results[0], '$d.duration'), 100);
      assert.strictEqual(getValueByDataprimePath(results[0], '$d.request.host'), 'api.example.com');
      assert.strictEqual(getValueByDataprimePath(results[0], '$l.serviceName'), 'frontend');
      assert.strictEqual(getValueByDataprimePath(results[0], '$m.timestamp'), '2024-01-15T10:00:00Z');
    });

    it('should handle real-world Coralogix response with spans', () => {
      const spanData = {
        traceID: 'trace-abc',
        spanID: 'span-123',
        operationName: '/api/users',
        duration: 50000,
        startTime: 1705315200000,
        tags: {
          httpStatusCode: '200',
          httpMethod: 'GET',
        },
        process: {
          serviceName: 'user-service',
        },
      };

      const response = `{"queryId": {"queryId": "span-query-456"}}
${makeResultLine(
    spanData,
    [{ key: 'serviceName', value: 'user-service' }],
    [
      { key: 'timestamp', value: '2024-01-15T10:00:00Z' },
      { key: 'traceId', value: 'trace-abc' },
    ],
  )}`;

      const { queryId, results } = parseNDJSON(response);

      assert.strictEqual(queryId, 'span-query-456');
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].traceID, 'trace-abc');
      assert.strictEqual(results[0].spanID, 'span-123');
      assert.strictEqual(results[0].duration, 50000);
      assert.strictEqual(results[0].tags.httpStatusCode, '200');
      assert.strictEqual(results[0]._metadata.traceId, 'trace-abc');
      assert.strictEqual(getValueByDataprimePath(results[0], '$d.tags.httpStatusCode'), '200');
    });
  });
});
