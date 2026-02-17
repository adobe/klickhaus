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

import {
  getToken,
  getSelectedTeamId,
  refreshToken,
  forceLogout,
} from './auth.js';

// URLs that should skip the auth interceptor
const SKIP_AUTH_URLS = [
  '/user/login',
  '/user/refresh',
  '/user/forgotpassword',
  '/user/resetpassword',
];

/**
 * Check if a URL should skip authentication
 * @param {string} url - The URL to check
 * @returns {boolean} True if auth should be skipped
 */
function shouldSkipAuth(url) {
  return SKIP_AUTH_URLS.some((skipUrl) => url.includes(skipUrl));
}

/**
 * Log errors for debugging
 * @param {string} context - The context where the error occurred
 * @param {string} message - The error message
 * @param {*} details - Additional error details
 */
function logError(context, message, details) {
  console.error(`[${context}]`, message, details);
}

/**
 * Track if a request is already being retried to prevent infinite retry loops
 */
const retryingRequests = new WeakSet();

/**
 * Authenticated fetch wrapper that automatically adds Coralogix authentication headers
 * and handles token refresh on 401 errors
 *
 * @param {string} url - The URL to fetch
 * @param {RequestInit} [options={}] - Fetch options
 * @returns {Promise<Response>} The fetch response
 *
 * @example
 * // Basic usage
 * const response = await authenticatedFetch('/api/data');
 * const data = await response.json();
 *
 * @example
 * // With options and AbortController
 * const controller = new AbortController();
 * const response = await authenticatedFetch('/api/data', {
 *   method: 'POST',
 *   body: JSON.stringify({ foo: 'bar' }),
 *   signal: controller.signal
 * });
 *
 * @example
 * // Skip auth for specific request
 * const response = await authenticatedFetch('/api/public', {
 *   headers: { 'X-Skip-Auth': 'true' }
 * });
 */
export async function authenticatedFetch(url, options = {}) {
  // Clone options to avoid mutating the original
  const fetchOptions = { ...options };

  // Initialize headers if not present
  if (!fetchOptions.headers) {
    fetchOptions.headers = {};
  }

  // Check if auth should be skipped
  const skipAuth = shouldSkipAuth(url)
    || fetchOptions.headers['X-Skip-Auth']
    || fetchOptions.headers['X-Skip-Token-Interceptor'];

  if (skipAuth) {
    // Remove skip auth headers before sending
    const headers = { ...fetchOptions.headers };
    delete headers['X-Skip-Auth'];
    delete headers['X-Skip-Token-Interceptor'];
    fetchOptions.headers = headers;
  } else {
    // Add authentication headers
    const token = getToken();
    const teamId = getSelectedTeamId();

    if (token) {
      fetchOptions.headers = {
        ...fetchOptions.headers,
        Authorization: `Bearer ${token}`,
      };

      // Add team ID header if available
      if (teamId) {
        fetchOptions.headers['CGX-Team-Id'] = teamId.toString();
      }
    }
  }

  const response = await fetch(url, fetchOptions);

  // Handle 401 Unauthorized - refresh token and retry
  if (response.status === 401 && !url.includes('/refresh') && !retryingRequests.has(options)) {
    try {
      // Mark this request as being retried
      retryingRequests.add(options);

      // Attempt to refresh the token
      await refreshToken();

      // Retry the request with the new token
      const newToken = getToken();
      const teamId = getSelectedTeamId();

      const retryOptions = { ...fetchOptions };
      retryOptions.headers = {
        ...retryOptions.headers,
        Authorization: `Bearer ${newToken}`,
      };

      if (teamId) {
        retryOptions.headers['CGX-Team-Id'] = teamId.toString();
      }

      const retryResponse = await fetch(url, retryOptions);

      // Clean up retry tracking
      retryingRequests.delete(options);

      return retryResponse;
    } catch (refreshError) {
      // Clean up retry tracking
      retryingRequests.delete(options);

      // Token refresh failed, force logout
      forceLogout('Session expired');
      throw refreshError;
    }
  }

  // Handle 403 Forbidden
  if (response.status === 403) {
    logError('AuthInterceptor', 'Access denied:', url);
  }

  return response;
}
