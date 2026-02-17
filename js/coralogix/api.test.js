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
  executeDataPrimeQuery,
  parseNDJSONResponse,
  getQueryErrorDetails,
  isAbortError,
  CoralogixQueryError,
  TIER_ARCHIVE,
  TIER_FREQUENT_SEARCH,
} from './api.js';
import * as auth from './auth.js';

describe('parseNDJSONResponse', () => {
  it('should parse valid NDJSON response', () => {
    const ndjson = `{"result":{"results":[{"userData":"{\\"key\\":\\"value1\\"}","labels":{"label1":"a"}}]}}
{"result":{"results":[{"userData":"{\\"key\\":\\"value2\\"}","labels":{"label2":"b"}}]}}`;

    const results = parseNDJSONResponse(ndjson);

    assert.strictEqual(results.length, 2);
    assert.deepEqual(results[0].userData, { key: 'value1' });
    assert.deepEqual(results[0].labels, { label1: 'a' });
    assert.deepEqual(results[1].userData, { key: 'value2' });
    assert.deepEqual(results[1].labels, { label2: 'b' });
  });

  it('should handle multiple results in single line', () => {
    const ndjson = '{"result":{"results":[{"userData":"{\\"a\\":1}"},{"userData":"{\\"b\\":2}"}]}}';

    const results = parseNDJSONResponse(ndjson);

    assert.strictEqual(results.length, 2);
    assert.deepEqual(results[0].userData, { a: 1 });
    assert.deepEqual(results[1].userData, { b: 2 });
  });

  it('should skip malformed NDJSON lines', () => {
    const ndjson = `{"result":{"results":[{"userData":"{\\"key\\":\\"value1\\"}"}]}}
not valid json
{"result":{"results":[{"userData":"{\\"key\\":\\"value2\\"}"}]}}`;

    const results = parseNDJSONResponse(ndjson);

    assert.strictEqual(results.length, 2);
    assert.deepEqual(results[0].userData, { key: 'value1' });
    assert.deepEqual(results[1].userData, { key: 'value2' });
  });

  it('should skip malformed userData', () => {
    const ndjson = `{"result":{"results":[{"userData":"not json"}]}}
{"result":{"results":[{"userData":"{\\"key\\":\\"value\\"}"}]}}`;

    const results = parseNDJSONResponse(ndjson);

    assert.strictEqual(results.length, 1);
    assert.deepEqual(results[0].userData, { key: 'value' });
  });

  it('should skip results without userData', () => {
    const ndjson = '{"result":{"results":[{"labels":{"a":"b"}},{"userData":"{\\"key\\":\\"value\\"}"}]}}';

    const results = parseNDJSONResponse(ndjson);

    assert.strictEqual(results.length, 1);
    assert.deepEqual(results[0].userData, { key: 'value' });
  });

  it('should handle empty response', () => {
    const results = parseNDJSONResponse('');
    assert.strictEqual(results.length, 0);
  });

  it('should handle response with only whitespace', () => {
    const results = parseNDJSONResponse('   \n  \n  ');
    assert.strictEqual(results.length, 0);
  });

  it('should preserve labels when present', () => {
    const ndjson = '{"result":{"results":[{"userData":"{\\"key\\":\\"value\\"}","labels":{"foo":"bar"}}]}}';

    const results = parseNDJSONResponse(ndjson);

    assert.deepEqual(results[0].labels, { foo: 'bar' });
  });

  it('should default to empty labels object when missing', () => {
    const ndjson = '{"result":{"results":[{"userData":"{\\"key\\":\\"value\\"}"}]}}';

    const results = parseNDJSONResponse(ndjson);

    assert.deepEqual(results[0].labels, {});
  });
});

describe('isAbortError', () => {
  it('should return true for AbortError', () => {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    assert.strictEqual(isAbortError(err), true);
  });

  it('should return false for other errors', () => {
    const err = new Error('Network error');
    assert.strictEqual(isAbortError(err), false);
  });

  it('should return false for null', () => {
    assert.strictEqual(isAbortError(null), false);
  });
});

describe('getQueryErrorDetails', () => {
  it('should format CoralogixQueryError', () => {
    const err = new CoralogixQueryError('Query failed', {
      status: 500,
      category: 'network',
      detail: 'Full error details',
    });

    const details = getQueryErrorDetails(err);

    assert.strictEqual(details.label, 'Network error');
    assert.strictEqual(details.category, 'network');
    assert.strictEqual(details.message, 'Query failed');
    assert.strictEqual(details.detail, 'Full error details');
    assert.strictEqual(details.status, 500);
  });

  it('should format AbortError', () => {
    const err = new Error('Aborted');
    err.name = 'AbortError';

    const details = getQueryErrorDetails(err);

    assert.strictEqual(details.label, 'Cancelled');
    assert.strictEqual(details.category, 'cancelled');
    assert.strictEqual(details.isAbort, true);
  });

  it('should format unknown error', () => {
    const err = new Error('Something went wrong');

    const details = getQueryErrorDetails(err);

    assert.strictEqual(details.label, 'Query failed');
    assert.strictEqual(details.category, 'unknown');
    assert.strictEqual(details.message, 'Something went wrong');
  });

  it('should handle null error', () => {
    const details = getQueryErrorDetails(null);

    assert.strictEqual(details.label, 'Query failed');
    assert.strictEqual(details.category, 'unknown');
    assert.strictEqual(details.message, 'Unknown error');
  });

  it('should truncate long messages', () => {
    const longMessage = 'a'.repeat(300);
    const err = new Error(longMessage);

    const details = getQueryErrorDetails(err);

    assert.isAtMost(details.message.length, 200);
  });
});

describe('executeDataPrimeQuery', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = window.fetch;
    // Set up auth credentials for tests
    auth.setAuthCredentials('test-token', 12345);
  });

  afterEach(() => {
    window.fetch = originalFetch;
    auth.clearAuthCredentials();
  });

  it('should execute successful query with default options', async () => {
    const mockResponse = '{"result":{"results":[{"userData":"{\\"count\\":100}"}]}}';
    let capturedUrl;
    let capturedOptions;

    window.fetch = async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        text: async () => mockResponse,
      };
    };

    const results = await executeDataPrimeQuery('source logs | limit 10');

    assert.strictEqual(capturedUrl, 'https://ng-api-http.coralogix.com/api/v1/dataprime/query');
    assert.strictEqual(capturedOptions.method, 'POST');
    assert.strictEqual(capturedOptions.headers.Authorization, 'Bearer test-token');
    assert.strictEqual(capturedOptions.headers['CGX-Team-Id'], '12345');
    assert.strictEqual(capturedOptions.headers['Content-Type'], 'application/json');

    const body = JSON.parse(capturedOptions.body);
    assert.strictEqual(body.query, 'source logs | limit 10');
    assert.strictEqual(body.metadata.syntax, 'QUERY_SYNTAX_DATAPRIME');
    assert.strictEqual(body.metadata.tier, TIER_ARCHIVE);

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].userData.count, 100);
  });

  it('should include query options in request', async () => {
    const mockResponse = '{"result":{"results":[]}}';
    let capturedBody;

    window.fetch = async (url, options) => {
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        text: async () => mockResponse,
      };
    };

    await executeDataPrimeQuery('source logs', {
      tier: TIER_FREQUENT_SEARCH,
      startDate: '2024-01-01T00:00:00Z',
      endDate: '2024-01-02T00:00:00Z',
      limit: 1000,
    });

    assert.strictEqual(capturedBody.metadata.tier, TIER_FREQUENT_SEARCH);
    assert.strictEqual(capturedBody.metadata.start_date, '2024-01-01T00:00:00Z');
    assert.strictEqual(capturedBody.metadata.end_date, '2024-01-02T00:00:00Z');
    assert.strictEqual(capturedBody.metadata.limit, 1000);
  });

  it('should omit team ID header when not set', async () => {
    auth.setAuthCredentials('test-token', null);
    const mockResponse = '{"result":{"results":[]}}';
    let capturedHeaders;

    window.fetch = async (url, options) => {
      capturedHeaders = options.headers;
      return {
        ok: true,
        text: async () => mockResponse,
      };
    };

    await executeDataPrimeQuery('source logs');

    assert.isUndefined(capturedHeaders['CGX-Team-Id']);
  });

  it('should throw error when no token available', async () => {
    auth.clearAuthCredentials();

    try {
      await executeDataPrimeQuery('source logs');
      assert.fail('Should have thrown error');
    } catch (err) {
      assert.include(err.message, 'No authentication token');
    }
  });

  it('should handle HTTP error responses', async () => {
    window.fetch = async () => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => 'Syntax error in query',
    });

    try {
      await executeDataPrimeQuery('invalid query', { maxRetries: 0 });
      assert.fail('Should have thrown error');
    } catch (err) {
      assert.instanceOf(err, CoralogixQueryError);
    }
  });

  it('should retry on retryable status codes', async () => {
    let callCount = 0;

    window.fetch = async () => {
      callCount += 1;
      if (callCount < 3) {
        return {
          ok: false,
          status: 503,
          text: async () => 'Service unavailable',
        };
      }
      return {
        ok: true,
        text: async () => '{"result":{"results":[]}}',
      };
    };

    const results = await executeDataPrimeQuery('source logs', {
      maxRetries: 3,
      retryDelay: 10,
    });

    assert.strictEqual(callCount, 3);
    assert.isArray(results);
  });

  it('should not retry on auth errors', async () => {
    let callCount = 0;

    window.fetch = async () => {
      callCount += 1;
      return {
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      };
    };

    try {
      await executeDataPrimeQuery('source logs', { maxRetries: 3 });
      assert.fail('Should have thrown error');
    } catch (err) {
      assert.strictEqual(callCount, 1);
    }
  });

  it('should support abort signal', async () => {
    const controller = new AbortController();
    let capturedSignal;

    window.fetch = async (url, options) => {
      capturedSignal = options.signal;
      return {
        ok: true,
        text: async () => '{"result":{"results":[]}}',
      };
    };

    await executeDataPrimeQuery('source logs', {
      signal: controller.signal,
    });

    assert.strictEqual(capturedSignal, controller.signal);
  });

  it('should use custom API URL when provided', async () => {
    let capturedUrl;

    window.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        text: async () => '{"result":{"results":[]}}',
      };
    };

    await executeDataPrimeQuery('source logs', {
      apiUrl: 'https://custom-api.example.com/query',
    });

    assert.strictEqual(capturedUrl, 'https://custom-api.example.com/query');
  });
});
