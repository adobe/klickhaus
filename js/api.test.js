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
  QueryError,
  classifyCategory,
  extractErrorType,
  getQueryErrorDetails,
  isAbortError,
  isForceRefresh,
  parseQueryError,
  query,
  setForceRefresh,
  summarizeErrorText,
} from './api.js';
import { state } from './state.js';

describe('api error helpers', () => {
  it('summarizes long error messages', () => {
    const longText = `Line one\n${'x'.repeat(300)}`;
    const summary = summarizeErrorText(longText);
    assert.isAtMost(summary.length, 200);
    assert.ok(summary.startsWith('Line one'));
  });

  it('extracts error types from ClickHouse messages', () => {
    const text = 'Code: 241. DB::Exception: Memory limit exceeded (MEMORY_LIMIT_EXCEEDED)';
    assert.strictEqual(extractErrorType(text), 'MEMORY_LIMIT_EXCEEDED');
  });

  it('parses ClickHouse errors into structured data', () => {
    const text = 'Code: 241. DB::Exception: Memory limit exceeded (MEMORY_LIMIT_EXCEEDED)';
    const parsed = parseQueryError(text, 500);
    assert.strictEqual(parsed.code, 241);
    assert.strictEqual(parsed.type, 'MEMORY_LIMIT_EXCEEDED');
    assert.strictEqual(parsed.category, 'memory');
    assert.include(parsed.message, 'Memory limit');
  });

  it('classifies common error categories', () => {
    const cases = [
      {
        text: 'DB::Exception: not enough privileges (NOT_ENOUGH_PRIVILEGES)',
        status: 403,
        type: 'NOT_ENOUGH_PRIVILEGES',
        expected: 'permissions',
      },
      {
        text: 'DB::Exception: memory limit exceeded (MEMORY_LIMIT_EXCEEDED)',
        status: 500,
        type: 'MEMORY_LIMIT_EXCEEDED',
        expected: 'memory',
      },
      {
        text: 'DB::Exception: Syntax error (SYNTAX_ERROR)',
        status: 400,
        type: 'SYNTAX_ERROR',
        expected: 'syntax',
      },
      {
        text: 'DB::Exception: Timeout exceeded (TIMEOUT_EXCEEDED)',
        status: 504,
        type: 'TIMEOUT_EXCEEDED',
        expected: 'timeout',
      },
      {
        text: 'DB::Exception: Unknown table (UNKNOWN_TABLE)',
        status: 404,
        type: 'UNKNOWN_TABLE',
        expected: 'schema',
      },
      {
        text: 'DB::Exception: Too many simultaneous queries (TOO_MANY_SIMULTANEOUS_QUERIES)',
        status: 429,
        type: 'TOO_MANY_SIMULTANEOUS_QUERIES',
        expected: 'resource',
      },
      {
        text: 'Failed to fetch',
        status: null,
        type: null,
        expected: 'network',
      },
    ];

    cases.forEach((entry) => {
      const category = classifyCategory(entry.text, entry.status, entry.type);
      assert.strictEqual(category, entry.expected);
    });
  });

  it('formats QueryError details for the UI', () => {
    const err = new QueryError('Denied', {
      category: 'permissions',
      code: 497,
      type: 'ACCESS_DENIED',
      status: 403,
    });
    const details = getQueryErrorDetails(err);
    assert.strictEqual(details.label, 'Permissions');
    assert.strictEqual(details.category, 'permissions');
    assert.strictEqual(details.code, 497);
    assert.strictEqual(details.type, 'ACCESS_DENIED');
    assert.strictEqual(details.status, 403);
  });

  it('summarizes null/empty input as Unknown error', () => {
    assert.strictEqual(summarizeErrorText(null), 'Unknown error');
    assert.strictEqual(summarizeErrorText(''), 'Unknown error');
  });

  it('truncates messages longer than 200 characters', () => {
    const longLine = 'A'.repeat(250);
    const summary = summarizeErrorText(longLine);
    assert.strictEqual(summary.length, 200);
    assert.ok(summary.endsWith('...'));
  });

  it('classifies unknown category for unrecognized errors', () => {
    assert.strictEqual(classifyCategory('something weird happened', 500, 'WEIRD_TYPE'), 'unknown');
  });

  it('returns unknown details for null error', () => {
    const details = getQueryErrorDetails(null);
    assert.strictEqual(details.category, 'unknown');
    assert.strictEqual(details.message, 'Unknown error');
    assert.strictEqual(details.label, 'Query failed');
  });

  it('handles generic (non-QueryError) errors', () => {
    const err = new Error('Failed to fetch');
    const details = getQueryErrorDetails(err);
    assert.strictEqual(details.category, 'network');
    assert.strictEqual(details.label, 'Network error');
  });

  it('handles QueryError with unknown category and missing message', () => {
    const err = new QueryError('', {
      category: 'nonexistent_category',
      detail: null,
    });
    const details = getQueryErrorDetails(err);
    assert.strictEqual(details.label, 'Query failed');
    assert.strictEqual(details.message, 'Query failed');
    assert.strictEqual(details.detail, 'Query failed');
  });

  it('detects AbortError instances', () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    assert.isTrue(isAbortError(abortError));

    const details = getQueryErrorDetails(abortError);
    assert.strictEqual(details.category, 'cancelled');
    assert.isTrue(details.isAbort);
  });
});

describe('isForceRefresh / setForceRefresh', () => {
  afterEach(() => {
    setForceRefresh(false);
  });

  it('defaults to false', () => {
    assert.isFalse(isForceRefresh());
  });

  it('can be set to true and back to false', () => {
    setForceRefresh(true);
    assert.isTrue(isForceRefresh());
    setForceRefresh(false);
    assert.isFalse(isForceRefresh());
  });
});

describe('query()', () => {
  let originalFetch;
  let savedCredentials;
  let savedTimeRange;

  function mockFetch(response) {
    window.fetch = async (url, opts) => {
      mockFetch.lastCall = { url, opts };
      return response;
    };
    mockFetch.lastCall = null;
  }

  function okResponse(data) {
    return {
      ok: true,
      status: 200,
      json: async () => data,
    };
  }

  function errorResponse(status, text) {
    return {
      ok: false,
      status,
      text: async () => text,
    };
  }

  beforeEach(() => {
    originalFetch = window.fetch;
    savedCredentials = state.credentials;
    savedTimeRange = state.timeRange;
    state.credentials = { user: 'testuser', password: 'testpass' };
    state.timeRange = '7d';
    setForceRefresh(false);
  });

  afterEach(() => {
    window.fetch = originalFetch;
    state.credentials = savedCredentials;
    state.timeRange = savedTimeRange;
    setForceRefresh(false);
  });

  it('sends POST with auth header and returns parsed JSON', async () => {
    const payload = { data: [{ count: 42 }] };
    mockFetch(okResponse(payload));

    const result = await query('SELECT 1');
    assert.deepEqual(result.data, payload.data);
    assert.isNumber(result.networkTime);
    assert.isAtLeast(result.networkTime, 0);

    // Verify fetch was called with correct method and auth
    const { opts } = mockFetch.lastCall;
    assert.strictEqual(opts.method, 'POST');
    const expectedAuth = `Basic ${btoa('testuser:testpass')}`;
    assert.strictEqual(opts.headers.Authorization, expectedAuth);
  });

  it('normalizes SQL whitespace in the body', async () => {
    mockFetch(okResponse({ data: [] }));
    await query('SELECT   1\n  FROM\ttable');

    const { opts } = mockFetch.lastCall;
    assert.strictEqual(opts.body, 'SELECT 1 FROM table FORMAT JSON');
  });

  it('uses default cache TTL from TIME_RANGES for current time range', async () => {
    state.timeRange = '7d';
    mockFetch(okResponse({ data: [] }));
    await query('SELECT 1');

    const { url } = mockFetch.lastCall;
    const params = new URL(url).searchParams;
    assert.strictEqual(params.get('use_query_cache'), '1');
    assert.strictEqual(params.get('query_cache_ttl'), '1800');
  });

  it('uses cacheTtl=1 when force refresh is active', async () => {
    setForceRefresh(true);
    mockFetch(okResponse({ data: [] }));
    await query('SELECT 1');

    const { url } = mockFetch.lastCall;
    const params = new URL(url).searchParams;
    assert.strictEqual(params.get('query_cache_ttl'), '1');
  });

  it('uses custom cacheTtl when provided', async () => {
    mockFetch(okResponse({ data: [] }));
    await query('SELECT 1', { cacheTtl: 42 });

    const { url } = mockFetch.lastCall;
    const params = new URL(url).searchParams;
    assert.strictEqual(params.get('query_cache_ttl'), '42');
  });

  it('skips cache params when skipCache is true', async () => {
    mockFetch(okResponse({ data: [] }));
    await query('SELECT 1', { skipCache: true });

    const { url } = mockFetch.lastCall;
    const params = new URL(url).searchParams;
    assert.isNull(params.get('use_query_cache'));
    assert.isNull(params.get('query_cache_ttl'));
  });

  it('falls back to cacheTtl 300 for unknown time range', async () => {
    state.timeRange = 'unknown_range';
    mockFetch(okResponse({ data: [] }));
    await query('SELECT 1');

    const { url } = mockFetch.lastCall;
    const params = new URL(url).searchParams;
    assert.strictEqual(params.get('query_cache_ttl'), '300');
  });

  it('throws QueryError on non-ok response', async () => {
    mockFetch(errorResponse(500, 'Code: 241. DB::Exception: Memory limit exceeded (MEMORY_LIMIT_EXCEEDED)'));

    try {
      await query('SELECT 1');
      assert.fail('should have thrown');
    } catch (err) {
      assert.isTrue(err.isQueryError);
      assert.strictEqual(err.category, 'memory');
      assert.strictEqual(err.status, 500);
      assert.strictEqual(err.code, 241);
    }
  });

  it('dispatches auth-error event on 401', async () => {
    mockFetch(errorResponse(401, 'Authentication failed'));

    let authEventFired = false;
    const handler = () => {
      authEventFired = true;
    };
    window.addEventListener('auth-error', handler);

    try {
      await query('SELECT 1');
      assert.fail('should have thrown');
    } catch (err) {
      assert.isTrue(authEventFired);
      assert.strictEqual(err.category, 'permissions');
    } finally {
      window.removeEventListener('auth-error', handler);
    }
  });

  it('dispatches auth-error on REQUIRED_PASSWORD text', async () => {
    mockFetch(errorResponse(403, 'Code: 516. REQUIRED_PASSWORD'));

    let authEventFired = false;
    const handler = () => {
      authEventFired = true;
    };
    window.addEventListener('auth-error', handler);

    try {
      await query('SELECT 1');
      assert.fail('should have thrown');
    } catch (err) {
      assert.isTrue(authEventFired);
    } finally {
      window.removeEventListener('auth-error', handler);
    }
  });

  it('passes abort signal to fetch', async () => {
    const controller = new AbortController();
    window.fetch = async (url, opts) => {
      assert.strictEqual(opts.signal, controller.signal);
      return okResponse({ data: [] });
    };

    await query('SELECT 1', { signal: controller.signal });
  });

  it('force refresh overrides custom cacheTtl', async () => {
    setForceRefresh(true);
    mockFetch(okResponse({ data: [] }));
    await query('SELECT 1', { cacheTtl: 9999 });

    const { url } = mockFetch.lastCall;
    const params = new URL(url).searchParams;
    assert.strictEqual(params.get('query_cache_ttl'), '1');
  });
});
