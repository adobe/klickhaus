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
  parseQueryError,
  summarizeErrorText,
} from './api.js';

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

  it('detects AbortError instances', () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    assert.isTrue(isAbortError(abortError));

    const details = getQueryErrorDetails(abortError);
    assert.strictEqual(details.category, 'cancelled');
    assert.isTrue(details.isAbort);
  });
});
