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

import { authenticatedFetch } from './interceptor.js';
import { mergeAbortSignals } from '../request-context.js';

/**
 * Coralogix DataPrime API service layer.
 * Pure JavaScript fetch-based implementation for executing DataPrime queries.
 */

// Default DataPrime API URL (can be overridden via options)
const DEFAULT_API_URL = 'https://ng-api-http.coralogix.com/api/v1/dataprime/query';

// Query tier constants
export const TIER_ARCHIVE = 'TIER_ARCHIVE';
export const TIER_FREQUENT_SEARCH = 'TIER_FREQUENT_SEARCH';

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const RETRY_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Error categories for Coralogix queries.
 */
const ERROR_CATEGORIES = {
  auth: 'Authentication',
  network: 'Network error',
  timeout: 'Query timeout',
  syntax: 'Query syntax',
  resource: 'Resource limits',
  cancelled: 'Cancelled',
  unknown: 'Query failed',
};

/**
 * Custom error class for Coralogix query errors.
 */
export class CoralogixQueryError extends Error {
  constructor(message, {
    status = null,
    category = 'unknown',
    detail = null,
    response = null,
  } = {}) {
    super(message);
    this.name = 'CoralogixQueryError';
    this.status = status;
    this.category = category;
    this.detail = detail;
    this.response = response;
    this.isQueryError = true;
  }
}

/**
 * Classify error category based on status and message.
 * @param {number|null} status - HTTP status code
 * @param {string} message - Error message
 * @returns {string} Error category
 */
function classifyErrorCategory(status, message) {
  const lower = String(message).toLowerCase();

  if (status === 401 || status === 403 || lower.includes('authentication') || lower.includes('unauthorized')) {
    return 'auth';
  }

  if (lower.includes('timeout') || status === 408) {
    return 'timeout';
  }

  if (lower.includes('syntax') || lower.includes('parse error')) {
    return 'syntax';
  }

  if (status === 429 || lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'resource';
  }

  if (lower.includes('network') || lower.includes('failed to fetch')) {
    return 'network';
  }

  return 'unknown';
}

/**
 * Parse error from response.
 * @param {Response} response - Fetch response
 * @param {string} text - Response text
 * @returns {object} Parsed error details
 */
function parseResponseError(response, text) {
  const { status } = response;
  let message = text || response.statusText || 'Unknown error';

  // Try to extract error message from JSON response
  try {
    const json = JSON.parse(text);
    if (json.error) {
      message = json.error;
    } else if (json.message) {
      message = json.message;
    }
  } catch {
    // Not JSON, use raw text
  }

  const category = classifyErrorCategory(status, message);

  return {
    status,
    message: message.slice(0, 200), // Truncate long messages
    category,
    detail: message,
  };
}

/**
 * Check if an error is an abort error.
 * @param {Error} err - Error to check
 * @returns {boolean}
 */
export function isAbortError(err) {
  return err?.name === 'AbortError';
}

/**
 * Get formatted error details for display.
 * @param {Error} err - Error object
 * @returns {object} Error details with label, category, and message
 */
export function getQueryErrorDetails(err) {
  if (!err) {
    return {
      label: ERROR_CATEGORIES.unknown,
      category: 'unknown',
      message: 'Unknown error',
    };
  }

  if (isAbortError(err)) {
    return {
      label: ERROR_CATEGORIES.cancelled,
      category: 'cancelled',
      message: 'Request cancelled',
      isAbort: true,
    };
  }

  if (err.isQueryError || err.name === 'CoralogixQueryError') {
    const label = ERROR_CATEGORIES[err.category] || ERROR_CATEGORIES.unknown;
    return {
      label,
      category: err.category,
      message: err.message || 'Query failed',
      detail: err.detail || err.message,
      status: err.status,
    };
  }

  const message = String(err.message || err).slice(0, 200);
  const category = classifyErrorCategory(null, message);
  return {
    label: ERROR_CATEGORIES[category] || ERROR_CATEGORIES.unknown,
    category,
    message,
  };
}

/**
 * Sleep for a given duration.
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Parse NDJSON response text into array of results.
 * Each line is a JSON object with potential nested result structure.
 *
 * @param {string} text - NDJSON response text
 * @returns {Array<object>} Array of parsed userData objects
 */
export function parseNDJSONResponse(text) {
  const results = [];
  const lines = text.trim().split('\n');

  for (const line of lines) {
    if (line.trim()) {
      try {
        const parsed = JSON.parse(line);

        // Handle Coralogix NDJSON format: { result: { results: [...] } }
        if (parsed.result && Array.isArray(parsed.result.results)) {
          for (const queryResult of parsed.result.results) {
            if (queryResult.userData) {
              try {
                const userData = JSON.parse(queryResult.userData);
                results.push({
                  userData,
                  labels: queryResult.labels || {},
                });
              } catch {
                // Skip malformed userData
              }
            }
          }
        }
      } catch {
        // Skip malformed NDJSON line
      }
    }
  }

  return results;
}

/**
 * Build the request body for a DataPrime query.
 * @param {string} query - DataPrime query string
 * @param {object} params - Query parameters
 * @param {string} params.tier - Query tier
 * @param {string} [params.startDate] - Start date in ISO format
 * @param {string} [params.endDate] - End date in ISO format
 * @param {number} [params.limit] - Maximum number of results
 * @returns {object} Request body
 */
function buildRequestBody(query, {
  tier, startDate, endDate, limit,
}) {
  const body = {
    query,
    metadata: {
      syntax: 'QUERY_SYNTAX_DATAPRIME',
      tier,
    },
  };

  if (startDate) {
    body.metadata.start_date = startDate;
  }

  if (endDate) {
    body.metadata.end_date = endDate;
  }

  if (limit !== undefined) {
    body.metadata.limit = limit;
  }

  return body;
}

/**
 * Handle a non-OK response by either scheduling a retry or throwing.
 * @param {Response} response - Fetch response
 * @param {number} attempt - Current attempt index
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} retryDelay - Base delay between retries in milliseconds
 * @returns {Promise<boolean>} True if the caller should retry
 */
async function handleErrorResponse(response, attempt, maxRetries, retryDelay) {
  const text = await response.text();
  const errorDetails = parseResponseError(response, text);

  // Retry on specific status codes
  if (attempt < maxRetries && RETRY_STATUS_CODES.has(response.status)) {
    await sleep(retryDelay * (attempt + 1));
    return true;
  }

  throw new CoralogixQueryError(errorDetails.message, {
    status: errorDetails.status,
    category: errorDetails.category,
    detail: errorDetails.detail,
    response: text,
  });
}

/**
 * Execute a DataPrime query with retry logic.
 *
 * @param {string} query - DataPrime query string
 * @param {object} options - Query options
 * @param {string} [options.tier=TIER_ARCHIVE] - Query tier (TIER_ARCHIVE or TIER_FREQUENT_SEARCH)
 * @param {string} [options.startDate] - Start date in ISO format
 * @param {string} [options.endDate] - End date in ISO format
 * @param {number} [options.limit] - Maximum number of results
 * @param {AbortSignal|AbortSignal[]} [options.signal] - Abort signal(s) for cancellation
 * @param {string} [options.apiUrl] - Override default API URL
 * @param {number} [options.maxRetries=3] - Maximum retry attempts
 * @param {number} [options.retryDelay=1000] - Delay between retries in milliseconds
 * @returns {Promise<Array<object>>} Array of parsed result objects
 */
export async function executeDataPrimeQuery(query, options = {}) {
  const {
    tier = TIER_ARCHIVE,
    startDate,
    endDate,
    limit,
    signal,
    apiUrl = DEFAULT_API_URL,
    maxRetries = MAX_RETRIES,
    retryDelay = RETRY_DELAY_MS,
  } = options;

  // Merge abort signals if multiple provided
  const abortSignal = Array.isArray(signal)
    ? mergeAbortSignals(signal)
    : signal;

  // Build request headers (authenticatedFetch will add Authorization and CGX-Team-Id)
  const headers = {
    'Content-Type': 'application/json',
  };

  const body = buildRequestBody(query, {
    tier, startDate, endDate, limit,
  });

  // Execute with retry logic
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential retry
      const response = await authenticatedFetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: abortSignal,
      });

      if (!response.ok) {
        // eslint-disable-next-line no-await-in-loop -- retry
        const shouldRetry = await handleErrorResponse(response, attempt, maxRetries, retryDelay);
        if (!shouldRetry) {
          // handleErrorResponse throws when not retrying, so this is unreachable
          throw lastError;
        }
      } else {
        // Parse NDJSON response
        // eslint-disable-next-line no-await-in-loop -- retry
        const text = await response.text();
        return parseNDJSONResponse(text);
      }
    } catch (err) {
      // Don't retry on abort or auth errors
      if (isAbortError(err) || err.category === 'auth') {
        throw err;
      }

      lastError = err;

      if (attempt < maxRetries) {
        // eslint-disable-next-line no-await-in-loop -- sequential retry requires backoff delay
        await sleep(retryDelay * (attempt + 1));
      } else {
        // Max retries exceeded
        throw err;
      }
    }
  }

  throw lastError;
}

/**
 * Cancel all pending requests in a given scope.
 * This is a convenience wrapper around request-context.js functionality.
 *
 * @param {string} scope - Request scope to cancel
 */
export function cancelRequests(_) {
  // Implementation note: Cancellation is handled via AbortController
  // in request-context.js. This function is provided for API completeness
  // but actual cancellation happens by calling startRequestContext() which
  // automatically aborts the previous controller.
}
