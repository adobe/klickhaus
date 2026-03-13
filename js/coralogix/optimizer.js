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
 * Performance optimization module for Coralogix queries.
 * Provides caching, request deduplication, tier selection, and sampling strategies.
 */

/* eslint-disable max-classes-per-file -- QueryCache and RequestDeduplicator are tightly coupled */
import { TIER_ARCHIVE, TIER_FREQUENT_SEARCH } from './api.js';
import { createLimiter } from '../concurrency-limiter.js';

// Cache TTL configuration based on time range
const CACHE_TTL_MS = {
  HOUR_1: 60 * 1000, // 1 minute for last hour
  HOUR_12: 5 * 60 * 1000, // 5 minutes for last 12 hours
  HOUR_24: 15 * 60 * 1000, // 15 minutes for last 24 hours
  WEEK_1: 60 * 60 * 1000, // 1 hour for 7 days
};

// Sampling thresholds
const SAMPLING_CONFIG = {
  TIME_RANGE_HOURS: 24, // Sample for ranges longer than 24 hours
  FACET_CARDINALITY_THRESHOLD: 1000, // Sample for high-cardinality facets
  MIN_SAMPLE_RATE: 0.01, // Minimum 1% sample
  MAX_SAMPLE_RATE: 1.0, // Maximum 100% (no sampling)
};

// Concurrency limiter for batch operations
const DEFAULT_MAX_CONCURRENT = 4;

/**
 * Query result cache with TTL-based expiration.
 * Uses Map for O(1) lookups and cleanup on access.
 */
class QueryCache {
  constructor() {
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Generate a cache key from query parameters.
   * @param {string} query - DataPrime query string
   * @param {object} options - Query options
   * @returns {string} Cache key
   */
  static generateKey(query, options = {}) {
    const {
      tier, startDate, endDate, limit,
    } = options;
    return JSON.stringify({
      query, tier, startDate, endDate, limit,
    });
  }

  /**
   * Get cached query result if still valid.
   * @param {string} queryKey - Cache key
   * @param {number} ttlMs - Time-to-live in milliseconds
   * @returns {Array|null} Cached data or null if expired/missing
   */
  get(queryKey, ttlMs) {
    const cached = this.cache.get(queryKey);
    if (!cached) {
      this.misses += 1;
      return null;
    }

    const age = Date.now() - cached.timestamp;
    if (age >= ttlMs) {
      // Expired - remove from cache
      this.cache.delete(queryKey);
      this.misses += 1;
      return null;
    }

    this.hits += 1;
    return cached.data;
  }

  /**
   * Store query result in cache.
   * @param {string} queryKey - Cache key
   * @param {Array} data - Query result data
   */
  set(queryKey, data) {
    this.cache.set(queryKey, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear all cached entries.
   */
  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics.
   * @returns {object} Cache stats
   */
  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Remove expired entries from cache.
   * @param {number} ttlMs - Time-to-live threshold
   */
  cleanup(ttlMs) {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= ttlMs) {
        this.cache.delete(key);
      }
    }
  }
}

// Global cache instance
const queryCache = new QueryCache();

/**
 * Request deduplication tracker.
 * Reuses pending promises for identical in-flight requests.
 */
class RequestDeduplicator {
  constructor() {
    this.pending = new Map();
  }

  /**
   * Execute a request with deduplication.
   * If an identical request is in-flight, reuse its promise.
   *
   * @param {string} key - Request key
   * @param {Function} requestFn - Async function that executes the request
   * @returns {Promise} Request result promise
   */
  async execute(key, requestFn) {
    // Check if request is already in-flight
    if (this.pending.has(key)) {
      return this.pending.get(key);
    }

    // Execute new request
    const promise = requestFn()
      .finally(() => {
        // Remove from pending when complete
        this.pending.delete(key);
      });

    this.pending.set(key, promise);
    return promise;
  }

  /**
   * Get number of pending requests.
   * @returns {number}
   */
  getPendingCount() {
    return this.pending.size;
  }

  /**
   * Clear all pending requests.
   */
  clear() {
    this.pending.clear();
  }
}

// Global deduplicator instance
const requestDeduplicator = new RequestDeduplicator();

/**
 * Calculate time range in hours from ISO timestamps.
 * @param {string} startDate - Start date ISO string
 * @param {string} endDate - End date ISO string
 * @returns {number} Time range in hours
 */
function calculateTimeRangeHours(startDate, endDate) {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  return (end - start) / (1000 * 60 * 60);
}

/**
 * Parse relative time expression to hours.
 * Supports: -1h, -30m, -7d, etc.
 *
 * @param {string} timeExpr - Relative time expression (e.g., '-1h', '-30m')
 * @returns {number} Hours
 */
function parseRelativeTimeToHours(timeExpr) {
  if (!timeExpr || timeExpr === '0' || timeExpr === '0m') {
    return 0;
  }

  const match = timeExpr.match(/^-?(\d+)([smhd])$/);
  if (!match) {
    return 0;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers = {
    s: 1 / 3600,
    m: 1 / 60,
    h: 1,
    d: 24,
  };

  return value * (multipliers[unit] || 0);
}

/**
 * Select optimal tier based on time range.
 * Recent data (< 24h) uses TIER_FREQUENT_SEARCH for faster queries.
 * Historical data uses TIER_ARCHIVE for cheaper queries.
 *
 * @param {number} timeRangeHours - Time range in hours
 * @returns {string} Tier constant (TIER_FREQUENT_SEARCH or TIER_ARCHIVE)
 */
export function selectOptimalTier(timeRangeHours) {
  return timeRangeHours <= 24 ? TIER_FREQUENT_SEARCH : TIER_ARCHIVE;
}

/**
 * Determine if sampling should be applied.
 * Sample for long time ranges or high-cardinality facets.
 *
 * @param {number} timeRangeHours - Time range in hours
 * @param {number} [facetCardinality] - Estimated facet cardinality
 * @returns {boolean} True if sampling should be applied
 */
export function shouldSample(timeRangeHours, facetCardinality) {
  if (timeRangeHours > SAMPLING_CONFIG.TIME_RANGE_HOURS) {
    return true;
  }

  if (facetCardinality && facetCardinality > SAMPLING_CONFIG.FACET_CARDINALITY_THRESHOLD) {
    return true;
  }

  return false;
}

/**
 * Calculate sample rate based on time range.
 * Longer ranges get lower sample rates to maintain performance.
 *
 * @param {number} timeRangeHours - Time range in hours
 * @returns {number} Sample rate between 0.01 and 1.0
 */
export function calculateSampleRate(timeRangeHours) {
  if (timeRangeHours <= 24) {
    return SAMPLING_CONFIG.MAX_SAMPLE_RATE; // No sampling
  }

  if (timeRangeHours <= 24 * 7) { // 1 week
    return 0.1; // 10% sample
  }

  if (timeRangeHours <= 24 * 30) { // 1 month
    return 0.05; // 5% sample
  }

  return SAMPLING_CONFIG.MIN_SAMPLE_RATE; // 1% sample for longer ranges
}

/**
 * Get cache TTL based on time range.
 * More recent queries have shorter TTLs for fresher data.
 * Historical queries can be cached longer.
 *
 * @param {number} timeRangeHours - Time range in hours
 * @returns {number} TTL in milliseconds
 */
export function getCacheTTL(timeRangeHours) {
  if (timeRangeHours <= 1) {
    return CACHE_TTL_MS.HOUR_1;
  }

  if (timeRangeHours <= 12) {
    return CACHE_TTL_MS.HOUR_12;
  }

  if (timeRangeHours <= 24) {
    return CACHE_TTL_MS.HOUR_24;
  }

  return CACHE_TTL_MS.WEEK_1;
}

/**
 * Calculate time range from query options.
 * Handles both absolute and relative time ranges.
 *
 * @param {object} options - Query options
 * @param {string} [options.startDate] - Start date (absolute or relative)
 * @param {string} [options.endDate] - End date (absolute or relative)
 * @returns {number} Time range in hours
 */
function getTimeRangeHours(options) {
  const { startDate, endDate } = options;

  if (!startDate || !endDate) {
    return 1; // Default to 1 hour
  }

  // Try absolute timestamps first
  if (startDate.includes('T') && endDate.includes('T')) {
    return calculateTimeRangeHours(startDate, endDate);
  }

  // Parse relative time expressions
  const startHours = parseRelativeTimeToHours(startDate);
  const endHours = parseRelativeTimeToHours(endDate);
  return Math.abs(startHours - endHours);
}

/**
 * Get cached query result.
 * @param {string} queryKey - Cache key
 * @param {number} ttlMs - Time-to-live in milliseconds
 * @returns {Array|null} Cached data or null if not found/expired
 */
export function getCachedQuery(queryKey, ttlMs) {
  return queryCache.get(queryKey, ttlMs);
}

/**
 * Set cached query result.
 * @param {string} queryKey - Cache key
 * @param {Array} data - Query result data
 */
export function setCachedQuery(queryKey, data) {
  queryCache.set(queryKey, data);
}

/**
 * Generate cache key for a query.
 * @param {string} query - DataPrime query string
 * @param {object} options - Query options
 * @returns {string} Cache key
 */
export function generateCacheKey(query, options) {
  return QueryCache.generateKey(query, options);
}

/**
 * Clear all cached queries.
 */
export function clearQueryCache() {
  queryCache.clear();
}

/**
 * Get cache statistics.
 * @returns {object} Cache stats (size, hits, misses, hitRate)
 */
export function getCacheStats() {
  return queryCache.getStats();
}

/**
 * Execute a query with caching and deduplication.
 *
 * @param {string} query - DataPrime query string
 * @param {object} options - Query options
 * @param {Function} executeFn - Function that executes the query
 * @returns {Promise<Array>} Query results
 */
export async function executeOptimizedQuery(query, options, executeFn) {
  // Calculate time range for optimization decisions
  const timeRangeHours = getTimeRangeHours(options);

  // Auto-select tier if not specified
  const queryOptions = { ...options };
  if (!queryOptions.tier) {
    queryOptions.tier = selectOptimalTier(timeRangeHours);
  }

  // Generate cache key
  const cacheKey = generateCacheKey(query, queryOptions);

  // Check cache first
  const ttl = getCacheTTL(timeRangeHours);
  const cached = getCachedQuery(cacheKey, ttl);
  if (cached) {
    return cached;
  }

  // Execute with deduplication
  const result = await requestDeduplicator.execute(
    cacheKey,
    () => executeFn(query, queryOptions),
  );

  // Cache the result
  setCachedQuery(cacheKey, result);

  return result;
}

/**
 * Create a batch query executor with concurrency limiting.
 *
 * @param {number} [maxConcurrent=4] - Maximum concurrent queries
 * @returns {Function} Batch executor function
 */
export function createBatchExecutor(maxConcurrent = DEFAULT_MAX_CONCURRENT) {
  const limiter = createLimiter(maxConcurrent);

  /**
   * Execute multiple queries in parallel with concurrency limit.
   *
   * @param {Array<{query: string, options: object}>} queries - Array of query specs
   * @param {Function} executeFn - Function that executes a single query
   * @returns {Promise<Array>} Array of results (in same order as input)
   */
  return async function executeBatch(queries, executeFn) {
    const promises = queries.map(
      ({ query, options: opts }) => limiter(
        () => executeOptimizedQuery(query, opts, executeFn),
      ),
    );

    return Promise.all(promises);
  };
}

/**
 * Optimize query options based on time range and cardinality.
 * Returns a new options object with optimizations applied.
 *
 * @param {object} options - Original query options
 * @param {number} [estimatedCardinality] - Estimated result cardinality
 * @returns {object} Optimized options
 */
export function optimizeQueryOptions(options, estimatedCardinality) {
  const optimized = { ...options };
  const timeRangeHours = getTimeRangeHours(options);

  // Auto-select tier
  if (!optimized.tier) {
    optimized.tier = selectOptimalTier(timeRangeHours);
  }

  // Apply sampling if needed
  if (shouldSample(timeRangeHours, estimatedCardinality)) {
    const sampleRate = calculateSampleRate(timeRangeHours);
    optimized.sampleRate = sampleRate;
    optimized.sampled = true;
  }

  // Add time range metadata for logging/debugging
  optimized.timeRangeHours = timeRangeHours;

  return optimized;
}

/**
 * Get pending request count.
 * Useful for debugging and monitoring.
 *
 * @returns {number} Number of in-flight requests
 */
export function getPendingRequestCount() {
  return requestDeduplicator.getPendingCount();
}

/**
 * Cleanup expired cache entries.
 * Call periodically to prevent unbounded cache growth.
 *
 * @param {number} [maxAgeMs] - Maximum age in milliseconds (default: 1 hour)
 */
export function cleanupCache(maxAgeMs = CACHE_TTL_MS.WEEK_1) {
  queryCache.cleanup(maxAgeMs);
}

// Export constants for testing and configuration
export const CACHE_CONSTANTS = {
  TTL_HOUR_1: CACHE_TTL_MS.HOUR_1,
  TTL_HOUR_12: CACHE_TTL_MS.HOUR_12,
  TTL_HOUR_24: CACHE_TTL_MS.HOUR_24,
  TTL_WEEK_1: CACHE_TTL_MS.WEEK_1,
};

export const SAMPLING_CONSTANTS = {
  TIME_RANGE_HOURS: SAMPLING_CONFIG.TIME_RANGE_HOURS,
  FACET_CARDINALITY_THRESHOLD: SAMPLING_CONFIG.FACET_CARDINALITY_THRESHOLD,
  MIN_SAMPLE_RATE: SAMPLING_CONFIG.MIN_SAMPLE_RATE,
  MAX_SAMPLE_RATE: SAMPLING_CONFIG.MAX_SAMPLE_RATE,
};
