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
  selectOptimalTier,
  shouldSample,
  calculateSampleRate,
  getCacheTTL,
  getCachedQuery,
  setCachedQuery,
  generateCacheKey,
  clearQueryCache,
  getCacheStats,
  executeOptimizedQuery,
  createBatchExecutor,
  optimizeQueryOptions,
  cleanupCache,
  CACHE_CONSTANTS,
  SAMPLING_CONSTANTS,
} from './optimizer.js';
import { TIER_ARCHIVE, TIER_FREQUENT_SEARCH } from './api.js';

describe('Tier Selection', () => {
  it('should select TIER_FREQUENT_SEARCH for recent data (< 24h)', () => {
    assert.equal(selectOptimalTier(1), TIER_FREQUENT_SEARCH);
    assert.equal(selectOptimalTier(12), TIER_FREQUENT_SEARCH);
    assert.equal(selectOptimalTier(23), TIER_FREQUENT_SEARCH);
    assert.equal(selectOptimalTier(24), TIER_FREQUENT_SEARCH);
  });

  it('should select TIER_ARCHIVE for historical data (> 24h)', () => {
    assert.equal(selectOptimalTier(25), TIER_ARCHIVE);
    assert.equal(selectOptimalTier(48), TIER_ARCHIVE);
    assert.equal(selectOptimalTier(168), TIER_ARCHIVE); // 7 days
    assert.equal(selectOptimalTier(720), TIER_ARCHIVE); // 30 days
  });

  it('should handle edge cases', () => {
    assert.equal(selectOptimalTier(0), TIER_FREQUENT_SEARCH);
    assert.equal(selectOptimalTier(0.5), TIER_FREQUENT_SEARCH);
  });
});

describe('Sampling Strategy', () => {
  it('should sample for time ranges > 24 hours', () => {
    assert.equal(shouldSample(25), true);
    assert.equal(shouldSample(48), true);
    assert.equal(shouldSample(168), true);
  });

  it('should not sample for time ranges <= 24 hours', () => {
    assert.equal(shouldSample(1), false);
    assert.equal(shouldSample(12), false);
    assert.equal(shouldSample(24), false);
  });

  it('should sample for high-cardinality facets', () => {
    assert.equal(shouldSample(1, 1001), true);
    assert.equal(shouldSample(12, 5000), true);
    assert.equal(shouldSample(1, 10000), true);
  });

  it('should not sample for low-cardinality facets', () => {
    assert.equal(shouldSample(1, 100), false);
    assert.equal(shouldSample(12, 500), false);
    assert.equal(shouldSample(24, 999), false);
  });

  it('should sample if either condition is met', () => {
    // Long range, low cardinality
    assert.equal(shouldSample(48, 100), true);
    // Short range, high cardinality
    assert.equal(shouldSample(1, 2000), true);
    // Both conditions met
    assert.equal(shouldSample(48, 2000), true);
  });
});

describe('Sample Rate Calculation', () => {
  it('should not sample for ranges <= 24 hours', () => {
    assert.equal(calculateSampleRate(1), 1.0);
    assert.equal(calculateSampleRate(12), 1.0);
    assert.equal(calculateSampleRate(24), 1.0);
  });

  it('should use 10% sample for 1 week', () => {
    assert.equal(calculateSampleRate(25), 0.1);
    assert.equal(calculateSampleRate(48), 0.1);
    assert.equal(calculateSampleRate(168), 0.1); // 7 days
  });

  it('should use 5% sample for 1 month', () => {
    assert.equal(calculateSampleRate(169), 0.05);
    assert.equal(calculateSampleRate(720), 0.05); // 30 days
  });

  it('should use 1% sample for longer ranges', () => {
    assert.equal(calculateSampleRate(721), 0.01);
    assert.equal(calculateSampleRate(8760), 0.01); // 1 year
  });
});

describe('Cache TTL Selection', () => {
  it('should use 1 minute TTL for last hour', () => {
    assert.equal(getCacheTTL(0.5), CACHE_CONSTANTS.TTL_HOUR_1);
    assert.equal(getCacheTTL(1), CACHE_CONSTANTS.TTL_HOUR_1);
  });

  it('should use 5 minute TTL for last 12 hours', () => {
    assert.equal(getCacheTTL(2), CACHE_CONSTANTS.TTL_HOUR_12);
    assert.equal(getCacheTTL(12), CACHE_CONSTANTS.TTL_HOUR_12);
  });

  it('should use 15 minute TTL for last 24 hours', () => {
    assert.equal(getCacheTTL(13), CACHE_CONSTANTS.TTL_HOUR_24);
    assert.equal(getCacheTTL(24), CACHE_CONSTANTS.TTL_HOUR_24);
  });

  it('should use 1 hour TTL for 7 days', () => {
    assert.equal(getCacheTTL(25), CACHE_CONSTANTS.TTL_WEEK_1);
    assert.equal(getCacheTTL(168), CACHE_CONSTANTS.TTL_WEEK_1);
    assert.equal(getCacheTTL(720), CACHE_CONSTANTS.TTL_WEEK_1);
  });
});

describe('Query Cache', () => {
  beforeEach(() => {
    clearQueryCache();
  });

  it('should cache and retrieve query results', () => {
    const query = 'source logs | limit 10';
    const options = { tier: TIER_ARCHIVE };
    const data = [{ cnt: 100 }];

    const key = generateCacheKey(query, options);
    setCachedQuery(key, data);

    const cached = getCachedQuery(key, 60000);
    assert.deepEqual(cached, data);
  });

  it('should return null for missing cache entries', () => {
    const key = generateCacheKey('missing query', {});
    const cached = getCachedQuery(key, 60000);
    assert.equal(cached, null);
  });

  it('should return null for expired cache entries', async () => {
    const query = 'source logs | limit 10';
    const options = { tier: TIER_ARCHIVE };
    const data = [{ cnt: 100 }];

    const key = generateCacheKey(query, options);
    setCachedQuery(key, data);

    // Wait for cache to expire (using very short TTL)
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    const cached = getCachedQuery(key, 5); // 5ms TTL
    assert.equal(cached, null);
  });

  it('should generate consistent cache keys', () => {
    const query = 'source logs | limit 10';
    const options = {
      tier: TIER_ARCHIVE,
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2025-01-02T00:00:00Z',
    };

    const key1 = generateCacheKey(query, options);
    const key2 = generateCacheKey(query, options);
    assert.equal(key1, key2);
  });

  it('should generate different keys for different queries', () => {
    const query1 = 'source logs | limit 10';
    const query2 = 'source logs | limit 20';
    const options = { tier: TIER_ARCHIVE };

    const key1 = generateCacheKey(query1, options);
    const key2 = generateCacheKey(query2, options);
    assert.notEqual(key1, key2);
  });

  it('should track cache statistics', () => {
    clearQueryCache();

    const query = 'source logs | limit 10';
    const options = { tier: TIER_ARCHIVE };
    const data = [{ cnt: 100 }];

    const key = generateCacheKey(query, options);

    // Miss
    getCachedQuery(key, 60000);
    let stats = getCacheStats();
    assert.equal(stats.hits, 0);
    assert.equal(stats.misses, 1);
    assert.equal(stats.hitRate, 0);

    // Set cache
    setCachedQuery(key, data);

    // Hit
    getCachedQuery(key, 60000);
    stats = getCacheStats();
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 1);
    assert.equal(stats.hitRate, 0.5);

    // Another hit
    getCachedQuery(key, 60000);
    stats = getCacheStats();
    assert.equal(stats.hits, 2);
    assert.equal(stats.misses, 1);
    assert.equal(stats.hitRate, 2 / 3);
  });

  it('should clear cache', () => {
    const query = 'source logs | limit 10';
    const options = { tier: TIER_ARCHIVE };
    const data = [{ cnt: 100 }];

    const key = generateCacheKey(query, options);
    setCachedQuery(key, data);

    clearQueryCache();

    const cached = getCachedQuery(key, 60000);
    assert.equal(cached, null);

    const stats = getCacheStats();
    assert.equal(stats.size, 0);
  });

  it('should cleanup expired entries', async () => {
    const query1 = 'source logs | limit 10';
    const query2 = 'source logs | limit 20';
    const options = { tier: TIER_ARCHIVE };
    const data = [{ cnt: 100 }];

    const key1 = generateCacheKey(query1, options);
    const key2 = generateCacheKey(query2, options);

    setCachedQuery(key1, data);

    // Wait to ensure key1 is older
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    setCachedQuery(key2, data);

    // Cleanup entries older than 25ms (key1 is ~50ms old, key2 is ~0ms old)
    cleanupCache(25);

    const stats = getCacheStats();
    // key1 should be removed, key2 should remain
    assert.equal(stats.size, 1);
  });
});

describe('Optimized Query Execution', () => {
  beforeEach(() => {
    clearQueryCache();
  });

  it('should execute and cache query results', async () => {
    const query = 'source logs | limit 10';
    const options = {
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2025-01-01T01:00:00Z',
    };
    const expectedData = [{ cnt: 42 }];

    let executionCount = 0;
    const executeFn = async () => {
      executionCount += 1;
      return expectedData;
    };

    // First execution
    const result1 = await executeOptimizedQuery(query, options, executeFn);
    assert.deepEqual(result1, expectedData);
    assert.equal(executionCount, 1);

    // Second execution should use cache
    const result2 = await executeOptimizedQuery(query, options, executeFn);
    assert.deepEqual(result2, expectedData);
    assert.equal(executionCount, 1); // Not incremented

    const stats = getCacheStats();
    assert.equal(stats.hits, 1);
  });

  it('should auto-select tier based on time range', async () => {
    const query = 'source logs | limit 10';
    const options = {
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2025-01-01T12:00:00Z', // 12 hours
    };

    let capturedOptions;
    const executeFn = async (_, opts) => {
      capturedOptions = opts;
      return [];
    };

    await executeOptimizedQuery(query, options, executeFn);

    assert.equal(capturedOptions.tier, TIER_FREQUENT_SEARCH);
  });

  it('should deduplicate concurrent identical requests', async () => {
    const query = 'source logs | limit 10';
    const options = {
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2025-01-01T01:00:00Z',
    };
    const expectedData = [{ cnt: 42 }];

    let executionCount = 0;
    const executeFn = async () => {
      executionCount += 1;
      // Simulate slow query
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      return expectedData;
    };

    // Execute three identical queries concurrently
    const promises = [
      executeOptimizedQuery(query, options, executeFn),
      executeOptimizedQuery(query, options, executeFn),
      executeOptimizedQuery(query, options, executeFn),
    ];

    const results = await Promise.all(promises);

    // All should return same data
    assert.deepEqual(results[0], expectedData);
    assert.deepEqual(results[1], expectedData);
    assert.deepEqual(results[2], expectedData);

    // But execution should happen only once (deduplication)
    assert.equal(executionCount, 1);
  });
});

describe('Batch Query Execution', () => {
  beforeEach(() => {
    clearQueryCache();
  });

  it('should execute multiple queries in batch', async () => {
    const executeBatch = createBatchExecutor(2);

    const queries = [
      { query: 'source logs | filter $d.status == 200', options: {} },
      { query: 'source logs | filter $d.status == 404', options: {} },
      { query: 'source logs | filter $d.status == 500', options: {} },
    ];

    const results = [
      [{ cnt: 100 }],
      [{ cnt: 20 }],
      [{ cnt: 5 }],
    ];

    let executionIndex = 0;
    const executeFn = async () => {
      const result = results[executionIndex];
      executionIndex += 1;
      return result;
    };

    const batchResults = await executeBatch(queries, executeFn);

    assert.equal(batchResults.length, 3);
    assert.deepEqual(batchResults[0], results[0]);
    assert.deepEqual(batchResults[1], results[1]);
    assert.deepEqual(batchResults[2], results[2]);
  });

  it('should respect concurrency limit', async () => {
    const maxConcurrent = 2;
    const executeBatch = createBatchExecutor(maxConcurrent);

    const queries = Array(5).fill(null).map((_, i) => ({
      query: `source logs | limit ${i}`,
      options: {},
    }));

    let currentConcurrent = 0;
    let maxObservedConcurrent = 0;

    const executeFn = async () => {
      currentConcurrent += 1;
      maxObservedConcurrent = Math.max(maxObservedConcurrent, currentConcurrent);

      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });

      currentConcurrent -= 1;
      return [{ cnt: 1 }];
    };

    await executeBatch(queries, executeFn);

    assert.equal(maxObservedConcurrent, maxConcurrent);
  });
});

describe('Query Options Optimization', () => {
  it('should auto-select tier for recent data', () => {
    const options = {
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2025-01-01T12:00:00Z',
    };

    const optimized = optimizeQueryOptions(options);

    assert.equal(optimized.tier, TIER_FREQUENT_SEARCH);
    assert.equal(optimized.sampled, undefined); // No sampling
  });

  it('should auto-select tier and enable sampling for historical data', () => {
    const options = {
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2025-01-08T00:00:00Z', // 7 days
    };

    const optimized = optimizeQueryOptions(options);

    assert.equal(optimized.tier, TIER_ARCHIVE);
    assert.equal(optimized.sampled, true);
    assert.equal(optimized.sampleRate, 0.1);
  });

  it('should enable sampling for high-cardinality facets', () => {
    const options = {
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2025-01-01T01:00:00Z',
    };

    const optimized = optimizeQueryOptions(options, 5000);

    assert.equal(optimized.tier, TIER_FREQUENT_SEARCH);
    assert.equal(optimized.sampled, true);
    assert.equal(optimized.sampleRate, 1.0); // No time-based sampling
  });

  it('should preserve existing tier if specified', () => {
    const options = {
      tier: TIER_ARCHIVE,
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2025-01-01T01:00:00Z',
    };

    const optimized = optimizeQueryOptions(options);

    assert.equal(optimized.tier, TIER_ARCHIVE); // Preserved
  });

  it('should add time range metadata', () => {
    const options = {
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2025-01-01T12:00:00Z',
    };

    const optimized = optimizeQueryOptions(options);

    assert.equal(optimized.timeRangeHours, 12);
  });
});

describe('Cache Key Generation', () => {
  it('should handle undefined facet cardinality in shouldSample', () => {
    // Should only consider time range when cardinality is undefined
    assert.equal(shouldSample(1, undefined), false);
    assert.equal(shouldSample(25, undefined), true);
  });

  it('should handle relative time ranges', () => {
    const options1 = {
      startDate: '-1h',
      endDate: '0',
    };
    const optimized1 = optimizeQueryOptions(options1);
    assert.equal(optimized1.tier, TIER_FREQUENT_SEARCH);

    const options2 = {
      startDate: '-7d',
      endDate: '0',
    };
    const optimized2 = optimizeQueryOptions(options2);
    assert.equal(optimized2.tier, TIER_ARCHIVE);
    assert.equal(optimized2.sampled, true);
  });

  it('should handle missing time range in options', () => {
    const options = {};
    const optimized = optimizeQueryOptions(options);
    assert.equal(optimized.tier, TIER_FREQUENT_SEARCH); // Default to 1 hour
    assert.equal(optimized.timeRangeHours, 1);
  });

  it('should generate cache keys with all option fields', () => {
    const query = 'source logs | limit 10';
    const options = {
      tier: TIER_ARCHIVE,
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2025-01-02T00:00:00Z',
      limit: 100,
    };

    const key = generateCacheKey(query, options);
    assert.ok(key.includes('TIER_ARCHIVE'));
    assert.ok(key.includes('2025-01-01'));
    assert.ok(key.includes('2025-01-02'));
    assert.ok(key.includes('100'));
  });
});

describe('Edge Cases', () => {
  it('should handle very long time ranges', () => {
    const twoYears = 24 * 365 * 2; // 2 years in hours
    assert.equal(selectOptimalTier(twoYears), TIER_ARCHIVE);
    assert.equal(shouldSample(twoYears), true);
    assert.equal(calculateSampleRate(twoYears), 0.01); // Min sample rate
  });

  it('should handle zero time range', () => {
    assert.equal(selectOptimalTier(0), TIER_FREQUENT_SEARCH);
    assert.equal(shouldSample(0), false);
    assert.equal(calculateSampleRate(0), 1.0);
    assert.equal(getCacheTTL(0), CACHE_CONSTANTS.TTL_HOUR_1);
  });

  it('should handle fractional hours', () => {
    assert.equal(selectOptimalTier(0.25), TIER_FREQUENT_SEARCH); // 15 minutes
    assert.equal(selectOptimalTier(24.5), TIER_ARCHIVE);
  });

  it('should handle cache cleanup with no expiration', () => {
    clearQueryCache();
    const key = generateCacheKey('test', {});
    setCachedQuery(key, [{ cnt: 1 }]);

    // Cleanup with very large TTL - nothing should be removed
    cleanupCache(1000000);
    const stats = getCacheStats();
    assert.equal(stats.size, 1);
  });

  it('should handle executeOptimizedQuery with missing options', async () => {
    const query = 'source logs | limit 10';
    const result = await executeOptimizedQuery(query, {}, async () => [{ cnt: 42 }]);
    assert.deepEqual(result, [{ cnt: 42 }]);
  });
});

describe('Constants', () => {
  it('should export cache constants', () => {
    assert.equal(typeof CACHE_CONSTANTS.TTL_HOUR_1, 'number');
    assert.equal(typeof CACHE_CONSTANTS.TTL_HOUR_12, 'number');
    assert.equal(typeof CACHE_CONSTANTS.TTL_HOUR_24, 'number');
    assert.equal(typeof CACHE_CONSTANTS.TTL_WEEK_1, 'number');

    assert.equal(CACHE_CONSTANTS.TTL_HOUR_1, 60 * 1000);
    assert.equal(CACHE_CONSTANTS.TTL_HOUR_12, 5 * 60 * 1000);
    assert.equal(CACHE_CONSTANTS.TTL_HOUR_24, 15 * 60 * 1000);
    assert.equal(CACHE_CONSTANTS.TTL_WEEK_1, 60 * 60 * 1000);
  });

  it('should export sampling constants', () => {
    assert.equal(typeof SAMPLING_CONSTANTS.TIME_RANGE_HOURS, 'number');
    assert.equal(typeof SAMPLING_CONSTANTS.FACET_CARDINALITY_THRESHOLD, 'number');
    assert.equal(typeof SAMPLING_CONSTANTS.MIN_SAMPLE_RATE, 'number');
    assert.equal(typeof SAMPLING_CONSTANTS.MAX_SAMPLE_RATE, 'number');

    assert.equal(SAMPLING_CONSTANTS.TIME_RANGE_HOURS, 24);
    assert.equal(SAMPLING_CONSTANTS.FACET_CARDINALITY_THRESHOLD, 1000);
    assert.equal(SAMPLING_CONSTANTS.MIN_SAMPLE_RATE, 0.01);
    assert.equal(SAMPLING_CONSTANTS.MAX_SAMPLE_RATE, 1.0);
  });
});
