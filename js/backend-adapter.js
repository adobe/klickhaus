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

/**
 * Backend Adapter
 *
 * Provides a unified interface for both ClickHouse and Coralogix backends.
 * Automatically detects which backend to use based on authentication state.
 */

import { query as clickhouseQuery } from './api.js';
import { isLoggedIn as isCoralogixLoggedIn } from './coralogix/auth.js';
import {
  fetchTimeSeriesData as coralogixFetchTimeSeries,
  fetchBreakdownData as coralogixFetchBreakdown,
  fetchLogsData as coralogixFetchLogs,
  isCoralogixConfigured,
} from './coralogix/adapter.js';

/**
 * Backend types
 */
export const BACKEND_TYPE = {
  CLICKHOUSE: 'clickhouse',
  CORALOGIX: 'coralogix',
};

/**
 * Detect which backend to use
 * @returns {string} Backend type (BACKEND_TYPE.CLICKHOUSE or BACKEND_TYPE.CORALOGIX)
 */
export function detectBackend() {
  // Use Coralogix if configured and user is logged in
  if (isCoralogixConfigured() && isCoralogixLoggedIn()) {
    return BACKEND_TYPE.CORALOGIX;
  }

  // Default to ClickHouse
  return BACKEND_TYPE.CLICKHOUSE;
}

/**
 * Get current backend name
 * @returns {string} Backend type
 */
export function getBackend() {
  return detectBackend();
}

/**
 * Check if currently using Coralogix backend
 * @returns {boolean}
 */
export function isUsingCoralogix() {
  return detectBackend() === BACKEND_TYPE.CORALOGIX;
}

/**
 * Execute a query using the appropriate backend
 * @param {string} sql - SQL query (only used for ClickHouse)
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Query result
 */
export async function executeQuery(sql, options = {}) {
  const backend = detectBackend();

  if (backend === BACKEND_TYPE.CORALOGIX) {
    // For Coralogix, we shouldn't be executing raw SQL
    // This is a legacy compatibility path - ideally code should use specific fetch functions
    throw new Error(
      'Direct SQL execution not supported with Coralogix. Use fetchTimeSeriesData, fetchBreakdownData, or fetchLogsData instead.',
    );
  }

  // ClickHouse backend
  return clickhouseQuery(sql, options);
}

/**
 * Fetch time series data using the appropriate backend
 * @param {Object} params - Query parameters
 * @returns {Promise<Array>} Time series data
 */
export async function fetchTimeSeriesData(params) {
  const backend = detectBackend();

  if (backend === BACKEND_TYPE.CORALOGIX) {
    return coralogixFetchTimeSeries(params);
  }

  // ClickHouse backend - use existing query method
  // This would need to be implemented to match the interface
  throw new Error('ClickHouse time series adapter not yet implemented');
}

/**
 * Fetch breakdown/facet data using the appropriate backend
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} {data: Array, totals: Object}
 */
export async function fetchBreakdownData(params) {
  const backend = detectBackend();

  if (backend === BACKEND_TYPE.CORALOGIX) {
    return coralogixFetchBreakdown(params);
  }

  // ClickHouse backend - use existing query method
  throw new Error('ClickHouse breakdown adapter not yet implemented');
}

/**
 * Fetch logs data using the appropriate backend
 * @param {Object} params - Query parameters
 * @returns {Promise<Array>} Logs data
 */
export async function fetchLogsData(params) {
  const backend = detectBackend();

  if (backend === BACKEND_TYPE.CORALOGIX) {
    return coralogixFetchLogs(params);
  }

  // ClickHouse backend - use existing query method
  throw new Error('ClickHouse logs adapter not yet implemented');
}

/**
 * Get backend-specific configuration
 * @returns {Object} Configuration object
 */
export function getBackendConfig() {
  const backend = detectBackend();

  return {
    type: backend,
    isCoralogix: backend === BACKEND_TYPE.CORALOGIX,
    isClickHouse: backend === BACKEND_TYPE.CLICKHOUSE,
    supportsRawSQL: backend === BACKEND_TYPE.CLICKHOUSE,
    requiresTranslation: backend === BACKEND_TYPE.CORALOGIX,
  };
}
