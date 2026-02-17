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

/* eslint-disable */

/**
 * Performance Optimizer Examples
 *
 * Demonstrates how to use the Coralogix query optimizer for caching,
 * deduplication, tier selection, and batch operations.
 */

import { executeDataPrimeQuery } from './api.js';
import {
  selectOptimalTier,
  shouldSample,
  calculateSampleRate,
  getCacheTTL,
  executeOptimizedQuery,
  createBatchExecutor,
  optimizeQueryOptions,
  getCacheStats,
  clearQueryCache,
} from './optimizer.js';

// Example 1: Basic optimized query execution with auto-caching
async function example1BasicOptimization() {
  console.log('\n=== Example 1: Basic Optimized Query ===\n');

  const query = 'source logs | filter $d.response.status >= 500 | limit 100';
  const options = {
    startDate: '2025-01-01T00:00:00Z',
    endDate: '2025-01-01T01:00:00Z',
  };

  // Execute with automatic caching and tier selection
  const results = await executeOptimizedQuery(query, options, executeDataPrimeQuery);

  console.log(`Received ${results.length} results`);
  console.log('Cache stats:', getCacheStats());

  // Second execution hits cache
  const cachedResults = await executeOptimizedQuery(query, options, executeDataPrimeQuery);
  console.log('Second execution (cached):', cachedResults.length);
  console.log('Cache stats:', getCacheStats());
}

// Example 2: Manual tier selection based on time range
async function example2TierSelection() {
  console.log('\n=== Example 2: Tier Selection ===\n');

  const recentTimeRange = 12; // hours
  const historicalTimeRange = 168; // 7 days

  // Recent data → fast tier
  const recentTier = selectOptimalTier(recentTimeRange);
  console.log(`Recent data (${recentTimeRange}h) → ${recentTier}`);

  // Historical data → archive tier (cheaper)
  const historicalTier = selectOptimalTier(historicalTimeRange);
  console.log(`Historical data (${historicalTimeRange}h) → ${historicalTier}`);

  // Use in query
  const query = 'source logs | groupby $d.response.status as status | aggregate count() as cnt';
  const options = {
    tier: historicalTier,
    startDate: '2025-01-01T00:00:00Z',
    endDate: '2025-01-08T00:00:00Z',
  };

  const results = await executeDataPrimeQuery(query, options);
  console.log(`Query results: ${results.length} status codes`);
}

// Example 3: Sampling strategy for large datasets
async function example3Sampling() {
  console.log('\n=== Example 3: Sampling Strategy ===\n');

  // Check if sampling should be applied
  const timeRange1 = 12; // hours
  const timeRange2 = 168; // 7 days
  const highCardinality = 5000;
  const lowCardinality = 100;

  console.log('Sampling decisions:');
  console.log(`  12h, low cardinality: ${shouldSample(timeRange1, lowCardinality)}`);
  console.log(`  12h, high cardinality: ${shouldSample(timeRange1, highCardinality)}`);
  console.log(`  7d, low cardinality: ${shouldSample(timeRange2, lowCardinality)}`);
  console.log(`  7d, high cardinality: ${shouldSample(timeRange2, highCardinality)}`);

  // Calculate sample rates
  console.log('\nSample rates by time range:');
  console.log(`  1 day: ${calculateSampleRate(24)}`);
  console.log(`  7 days: ${calculateSampleRate(168)}`);
  console.log(`  30 days: ${calculateSampleRate(720)}`);
}

// Example 4: Batch query execution with concurrency limiting
async function example4BatchExecution() {
  console.log('\n=== Example 4: Batch Query Execution ===\n');

  // Create batch executor with max 4 concurrent queries
  const executeBatch = createBatchExecutor(4);

  // Define multiple breakdown queries
  const queries = [
    {
      query: 'source logs | groupby $d.response.status | aggregate count() as cnt',
      options: {
        startDate: '2025-01-01T00:00:00Z',
        endDate: '2025-01-01T01:00:00Z',
      },
    },
    {
      query: 'source logs | groupby $d.cdn.cache_status | aggregate count() as cnt',
      options: {
        startDate: '2025-01-01T00:00:00Z',
        endDate: '2025-01-01T01:00:00Z',
      },
    },
    {
      query: 'source logs | groupby $d.request.method | aggregate count() as cnt',
      options: {
        startDate: '2025-01-01T00:00:00Z',
        endDate: '2025-01-01T01:00:00Z',
      },
    },
  ];

  console.log(`Executing ${queries.length} queries in batch...`);
  const startTime = Date.now();

  const results = await executeBatch(queries, executeDataPrimeQuery);

  const duration = Date.now() - startTime;
  console.log(`Batch completed in ${duration}ms`);
  console.log('Results:');
  results.forEach((result, i) => {
    console.log(`  Query ${i + 1}: ${result.length} results`);
  });
}

// Example 5: Automatic query optimization
async function example5AutoOptimization() {
  console.log('\n=== Example 5: Automatic Optimization ===\n');

  // Recent data (1 hour)
  const recentOptions = {
    startDate: '2025-01-01T00:00:00Z',
    endDate: '2025-01-01T01:00:00Z',
  };

  const optimizedRecent = optimizeQueryOptions(recentOptions);
  console.log('Recent query (1h) optimized:');
  console.log(`  Tier: ${optimizedRecent.tier}`);
  console.log(`  Sampled: ${optimizedRecent.sampled || false}`);
  console.log(`  Cache TTL: ${getCacheTTL(optimizedRecent.timeRangeHours)}ms`);

  // Historical data (7 days)
  const historicalOptions = {
    startDate: '2025-01-01T00:00:00Z',
    endDate: '2025-01-08T00:00:00Z',
  };

  const optimizedHistorical = optimizeQueryOptions(historicalOptions);
  console.log('\nHistorical query (7d) optimized:');
  console.log(`  Tier: ${optimizedHistorical.tier}`);
  console.log(`  Sampled: ${optimizedHistorical.sampled}`);
  console.log(`  Sample rate: ${optimizedHistorical.sampleRate}`);
  console.log(`  Cache TTL: ${getCacheTTL(optimizedHistorical.timeRangeHours)}ms`);

  // High-cardinality facet
  const highCardinalityOptions = {
    startDate: '2025-01-01T00:00:00Z',
    endDate: '2025-01-01T12:00:00Z',
  };

  const optimizedHighCard = optimizeQueryOptions(highCardinalityOptions, 10000);
  console.log('\nHigh-cardinality facet (12h, 10k values) optimized:');
  console.log(`  Tier: ${optimizedHighCard.tier}`);
  console.log(`  Sampled: ${optimizedHighCard.sampled}`);
  console.log(`  Sample rate: ${optimizedHighCard.sampleRate}`);
}

// Example 6: Cache management and statistics
async function example6CacheManagement() {
  console.log('\n=== Example 6: Cache Management ===\n');

  // Clear cache to start fresh
  clearQueryCache();
  console.log('Cache cleared');

  const query = 'source logs | limit 10';
  const options = {
    startDate: '2025-01-01T00:00:00Z',
    endDate: '2025-01-01T01:00:00Z',
  };

  // First execution - cache miss
  await executeOptimizedQuery(query, options, executeDataPrimeQuery);
  console.log('After first query:', getCacheStats());

  // Second execution - cache hit
  await executeOptimizedQuery(query, options, executeDataPrimeQuery);
  console.log('After second query:', getCacheStats());

  // Different query - another cache miss
  const query2 = 'source logs | limit 20';
  await executeOptimizedQuery(query2, options, executeDataPrimeQuery);
  console.log('After third query:', getCacheStats());

  // Cache hit again
  await executeOptimizedQuery(query, options, executeDataPrimeQuery);
  const finalStats = getCacheStats();
  console.log('Final stats:', finalStats);
  console.log(`Hit rate: ${(finalStats.hitRate * 100).toFixed(1)}%`);
}

// Example 7: Request deduplication
async function example7Deduplication() {
  console.log('\n=== Example 7: Request Deduplication ===\n');

  clearQueryCache();

  const query = 'source logs | limit 100';
  const options = {
    startDate: '2025-01-01T00:00:00Z',
    endDate: '2025-01-01T01:00:00Z',
  };

  console.log('Firing 5 identical concurrent queries...');

  // Track actual API calls
  let apiCallCount = 0;
  const trackedExecute = async (q, opts) => {
    apiCallCount++;
    console.log(`  API call #${apiCallCount}`);
    return executeDataPrimeQuery(q, opts);
  };

  // Execute 5 identical queries concurrently
  const promises = Array(5).fill(null).map(() => executeOptimizedQuery(query, options, trackedExecute));

  await Promise.all(promises);

  console.log('\nResult:');
  console.log('  Total requests fired: 5');
  console.log(`  Actual API calls: ${apiCallCount}`);
  console.log(`  Deduplicated: ${5 - apiCallCount}`);
}

// Example 8: Dashboard breakdown query pattern
async function example8DashboardPattern() {
  console.log('\n=== Example 8: Dashboard Breakdown Pattern ===\n');

  const executeBatch = createBatchExecutor(4);

  // Simulate dashboard loading multiple breakdowns
  const facets = [
    { name: 'status', field: '$d.response.status' },
    { name: 'cache_status', field: '$d.cdn.cache_status' },
    { name: 'method', field: '$d.request.method' },
    { name: 'datacenter', field: '$d.cdn.datacenter' },
    { name: 'request_type', field: '$d.helix.request_type' },
  ];

  const timeRange = {
    startDate: '2025-01-01T00:00:00Z',
    endDate: '2025-01-01T01:00:00Z',
  };

  // Build queries for all facets
  const queries = facets.map((facet) => ({
    query: `source logs | groupby ${facet.field} as dim | aggregate count() as cnt | limit 20`,
    options: timeRange,
  }));

  console.log(`Loading ${facets.length} breakdown facets...`);
  const startTime = Date.now();

  const results = await executeBatch(queries, executeDataPrimeQuery);

  const duration = Date.now() - startTime;
  console.log(`\nDashboard loaded in ${duration}ms`);
  console.log('Breakdown results:');
  results.forEach((result, i) => {
    console.log(`  ${facets[i].name}: ${result.length} values`);
  });
  console.log('\nCache stats:', getCacheStats());
}

// Run all examples
async function runAllExamples() {
  try {
    await example1BasicOptimization();
    await example2TierSelection();
    await example3Sampling();
    await example4BatchExecution();
    await example5AutoOptimization();
    await example6CacheManagement();
    await example7Deduplication();
    await example8DashboardPattern();

    console.log('\n=== All Examples Complete ===\n');
  } catch (err) {
    console.error('Example failed:', err);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples();
}

export {
  example1BasicOptimization,
  example2TierSelection,
  example3Sampling,
  example4BatchExecution,
  example5AutoOptimization,
  example6CacheManagement,
  example7Deduplication,
  example8DashboardPattern,
};
