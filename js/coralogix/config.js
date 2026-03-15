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
 * Coralogix Configuration
 *
 * This module provides configuration for interacting with Coralogix APIs.
 * Configuration values are loaded from environment variables where applicable.
 */

/**
 * Query tier options for Coralogix DataPrime queries
 * - TIER_FREQUENT_SEARCH: For recent data (last 24 hours) - fastest queries
 * - TIER_ARCHIVE: For historical data (>24 hours) - cost-effective for older data
 */
export const QUERY_TIERS = {
  FREQUENT_SEARCH: 'TIER_FREQUENT_SEARCH',
  ARCHIVE: 'TIER_ARCHIVE',
};

/**
 * Get environment variable (supports both Node.js and browser environments)
 * @param {string} key - Environment variable name
 * @returns {string|null} Value or null
 */
function getEnv(key) {
  // Browser environment - check window object
  if (typeof window !== 'undefined' && window.ENV) {
    return window.ENV[key] || null;
  }
  // Node.js environment
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key] || null;
  }
  return null;
}

/**
 * Initialize window.ENV as empty — values are loaded from .env file at runtime
 */
if (typeof window !== 'undefined' && !window.ENV) {
  window.ENV = {};
}

/**
 * Main Coralogix configuration object
 */
export const CORALOGIX_CONFIG = {
  // API Endpoints
  dataprimeApiUrl: getEnv('CX_DATAPRIME_URL') || 'https://ng-api-http.coralogix.com/api/v1/dataprime/query',
  grpcGatewayUrl: getEnv('CX_GRPC_GATEWAY_URL') || 'https://ng-api-grpc.coralogix.com',
  httpGatewayUrl: getEnv('CX_HTTP_GATEWAY_URL') || 'https://ng-api-http.coralogix.com',
  baseApiUrl: getEnv('CX_BASE_URL') || 'https://api.coralogix.com',

  // OAuth2 PKCE endpoints (derived from baseApiUrl)
  get authorizationEndpoint() { return `${this.baseApiUrl}/oauth/login`; },
  get tokenEndpoint() { return `${this.baseApiUrl}/oauth/token`; },
  get revocationEndpoint() { return `${this.baseApiUrl}/oauth/revoke`; },

  // OAuth2 client ID — public client, no secret needed (PKCE handles security)
  clientId: getEnv('CX_CLIENT_ID') || null,
  // Redirect URI after OAuth callback — defaults to the current page URL at runtime
  redirectUri: getEnv('CX_REDIRECT_URI') || null,

  // Authentication & Team Configuration
  teamId: getEnv('CX_TEAM_ID') || null,
  apiKey: getEnv('CX_API_KEY') || null,

  // Default query settings
  defaultTier: QUERY_TIERS.ARCHIVE,
  enableCredentials: true,

  // API Version
  apiVersion: 'v1',

  /**
   * Determines the appropriate query tier based on the time range
   * @param {number} hours - Number of hours in the time range
   * @returns {string} The recommended query tier
   */
  getTierForTimeRange(hours) {
    // Use FREQUENT_SEARCH for recent data (last 24 hours)
    // Use ARCHIVE for historical data (older than 24 hours)
    return hours <= 24 ? QUERY_TIERS.FREQUENT_SEARCH : QUERY_TIERS.ARCHIVE;
  },

  /**
   * Validates that required configuration is present
   * @returns {Object} Validation result with isValid flag and missing fields
   */
  validate() {
    const missing = [];

    if (!this.clientId) missing.push('CX_CLIENT_ID');
    if (!this.redirectUri) missing.push('CX_REDIRECT_URI');

    return {
      isValid: missing.length === 0,
      missing,
      message: missing.length > 0
        ? `Missing required environment variables: ${missing.join(', ')}`
        : 'Configuration is valid',
    };
  },

  /**
   * Gets the full URL for a specific API endpoint
   * @param {string} path - API path (e.g., '/api/v1/dataprime/query')
   * @returns {string} Full URL
   */
  getApiUrl(path) {
    return `${this.baseApiUrl}${path}`;
  },

  /**
   * Gets common headers for API requests
   * @returns {Object} Headers object
   */
  getHeaders() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'CX-Team-Id': this.teamId,
    };
  },
};

/**
 * Load environment variables from .env file and populate window.ENV.
 * Also refreshes CORALOGIX_CONFIG properties that depend on env vars.
 * @returns {Promise<void>}
 */
export async function loadEnvFile() {
  if (typeof window === 'undefined') return;
  try {
    const resp = await fetch('/env');
    if (!resp.ok) return;
    const text = await resp.text();
    text.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) return;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      window.ENV[key] = value;
    });

    // Refresh CORALOGIX_CONFIG from newly loaded env
    CORALOGIX_CONFIG.dataprimeApiUrl = getEnv('CX_DATAPRIME_URL') || CORALOGIX_CONFIG.dataprimeApiUrl;
    CORALOGIX_CONFIG.grpcGatewayUrl = getEnv('CX_GRPC_GATEWAY_URL') || CORALOGIX_CONFIG.grpcGatewayUrl;
    CORALOGIX_CONFIG.httpGatewayUrl = getEnv('CX_HTTP_GATEWAY_URL') || CORALOGIX_CONFIG.httpGatewayUrl;
    CORALOGIX_CONFIG.baseApiUrl = getEnv('CX_BASE_URL') || CORALOGIX_CONFIG.baseApiUrl;
    CORALOGIX_CONFIG.teamId = getEnv('CX_TEAM_ID') || CORALOGIX_CONFIG.teamId;
    CORALOGIX_CONFIG.apiKey = getEnv('CX_API_KEY') || CORALOGIX_CONFIG.apiKey;
    CORALOGIX_CONFIG.clientId = getEnv('CX_CLIENT_ID') || CORALOGIX_CONFIG.clientId;
    CORALOGIX_CONFIG.redirectUri = getEnv('CX_REDIRECT_URI') || CORALOGIX_CONFIG.redirectUri;
  } catch (e) {
    // .env file not available — continue with defaults
  }
}

/**
 * Environment-specific configurations
 * Can be used to override settings based on deployment environment
 */
export const ENV_CONFIGS = {
  development: {
    ...CORALOGIX_CONFIG,
    production: false,
    envName: 'development',
  },

  staging: {
    ...CORALOGIX_CONFIG,
    production: false,
    envName: 'staging',
  },

  production: {
    ...CORALOGIX_CONFIG,
    production: true,
    envName: 'production',
  },
};

/**
 * Gets the configuration for the current environment
 * @param {string} env - Environment name (defaults to NODE_ENV or 'development')
 * @returns {Object} Environment-specific configuration
 */
export function getConfig(env = getEnv('NODE_ENV') || 'development') {
  return ENV_CONFIGS[env] || ENV_CONFIGS.development;
}

export default CORALOGIX_CONFIG;
