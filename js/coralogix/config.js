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
 * Initialize window.ENV with default values for development
 * This will be populated by reading .env file or set manually
 */
if (typeof window !== 'undefined' && !window.ENV) {
  window.ENV = {
    CX_TEAM_ID: '7667',
    CX_DATAPRIME_URL: 'https://api.coralogix.com/api/v1/dataprime/query',
    CX_GRPC_GATEWAY_URL: 'https://api.coralogix.com',
    CX_HTTP_GATEWAY_URL: 'https://api.coralogix.com',
    CX_BASE_URL: 'https://api.coralogix.com',
    SKIP_CAPTCHA: 'true',
    CAPTCHA_BYPASS_TOKEN: 'f11a30f5-6df2-4b5d-842b-62034fb07482',
    CX_DEFAULT_USERNAME: 'yoni@coralogix.com',
    CX_DEFAULT_PASSWORD: 'Verint1!',
  };
}

/**
 * Main Coralogix configuration object
 */
export const CORALOGIX_CONFIG = {
  // API Endpoints
  dataprimeApiUrl: getEnv('CX_DATAPRIME_URL') || 'https://api.coralogix.com/api/v1/dataprime/query',
  grpcGatewayUrl: getEnv('CX_GRPC_GATEWAY_URL') || 'https://ng-api-grpc.coralogix.com',
  httpGatewayUrl: getEnv('CX_HTTP_GATEWAY_URL') || 'https://ng-api-http.coralogix.com',
  baseApiUrl: getEnv('CX_BASE_URL') || 'https://api.coralogix.com',

  // Authentication & Team Configuration
  teamId: getEnv('CX_TEAM_ID') || null,
  apiKey: getEnv('CX_API_KEY') || null,

  // Default query settings
  defaultTier: QUERY_TIERS.ARCHIVE,
  enableCredentials: true,

  // reCAPTCHA bypass (for development)
  skipRecaptcha: getEnv('SKIP_CAPTCHA') === 'true',
  captchaBypassToken: getEnv('CAPTCHA_BYPASS_TOKEN') || null,

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

    if (!this.teamId) {
      missing.push('CX_TEAM_ID');
    }

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
