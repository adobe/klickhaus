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
import { authenticatedFetch } from './interceptor.js';
import * as auth from './auth.js';

describe('authenticatedFetch', () => {
  let originalFetch;
  let fetchCalls;

  beforeEach(() => {
    // Clear auth state
    auth.clearAuthCredentials();

    // Save original fetch
    originalFetch = window.fetch;

    // Track fetch calls
    fetchCalls = [];

    // Mock fetch
    window.fetch = async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: 'success' }),
      };
    };
  });

  afterEach(() => {
    // Restore original fetch
    window.fetch = originalFetch;
  });

  it('should add Authorization header when token is available', async () => {
    auth.setAuthCredentials('test-token');

    await authenticatedFetch('/api/data');

    assert.strictEqual(fetchCalls.length, 1);
    assert.strictEqual(fetchCalls[0].options.headers.Authorization, 'Bearer test-token');
  });

  it('should add CGX-Team-Id header when team ID is available', async () => {
    auth.setAuthCredentials('test-token', 12345);

    await authenticatedFetch('/api/data');

    assert.strictEqual(fetchCalls.length, 1);
    assert.strictEqual(fetchCalls[0].options.headers.Authorization, 'Bearer test-token');
    assert.strictEqual(fetchCalls[0].options.headers['CGX-Team-Id'], '12345');
  });

  it('should skip auth for login endpoint', async () => {
    auth.setAuthCredentials('test-token');

    await authenticatedFetch('/user/login', {
      method: 'POST',
    });

    assert.strictEqual(fetchCalls.length, 1);
    assert.isUndefined(fetchCalls[0].options.headers.Authorization);
  });

  it('should skip auth for refresh endpoint', async () => {
    auth.setAuthCredentials('test-token');

    await authenticatedFetch('/user/refresh', {
      method: 'POST',
    });

    assert.strictEqual(fetchCalls.length, 1);
    assert.isUndefined(fetchCalls[0].options.headers.Authorization);
  });

  it('should skip auth when X-Skip-Auth header is present', async () => {
    auth.setAuthCredentials('test-token');

    await authenticatedFetch('/api/public', {
      headers: {
        'X-Skip-Auth': 'true',
      },
    });

    assert.strictEqual(fetchCalls.length, 1);
    assert.isUndefined(fetchCalls[0].options.headers.Authorization);
    assert.isUndefined(fetchCalls[0].options.headers['X-Skip-Auth']);
  });

  it('should preserve custom headers', async () => {
    auth.setAuthCredentials('test-token');

    await authenticatedFetch('/api/data', {
      headers: {
        'Content-Type': 'application/json',
        'X-Custom-Header': 'custom-value',
      },
    });

    assert.strictEqual(fetchCalls.length, 1);
    assert.strictEqual(fetchCalls[0].options.headers.Authorization, 'Bearer test-token');
    assert.strictEqual(fetchCalls[0].options.headers['Content-Type'], 'application/json');
    assert.strictEqual(fetchCalls[0].options.headers['X-Custom-Header'], 'custom-value');
  });

  it('should not add auth headers when token is not available', async () => {
    await authenticatedFetch('/api/data');

    assert.strictEqual(fetchCalls.length, 1);
    assert.isUndefined(fetchCalls[0].options.headers.Authorization);
  });

  it('should handle 403 errors with logging', async () => {
    auth.setAuthCredentials('test-token');

    // Track console.error calls
    const consoleErrors = [];
    const originalConsoleError = console.error;
    console.error = (...args) => {
      consoleErrors.push(args);
    };

    // Mock 403 response
    window.fetch = async () => ({
      ok: false,
      status: 403,
    });

    const response = await authenticatedFetch('/api/forbidden');

    assert.strictEqual(response.status, 403);
    assert.strictEqual(consoleErrors.length, 1);
    assert.strictEqual(consoleErrors[0][0], '[AuthInterceptor]');
    assert.strictEqual(consoleErrors[0][1], 'Access denied:');
    assert.strictEqual(consoleErrors[0][2], '/api/forbidden');

    // Restore console.error
    console.error = originalConsoleError;
  });
});
