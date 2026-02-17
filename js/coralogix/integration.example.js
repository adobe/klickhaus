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
 * Complete integration example showing optimizer + query-builder + API
 *
 * Demonstrates how to combine all Coralogix modules for optimal performance.
 */

import { executeDataPrimeQuery, TIER_ARCHIVE } from './api.js';
import { buildTimeSeriesQuery, buildBreakdownQuery } from './query-builder.js';
import {
  executeOptimizedQuery,
  createBatchExecutor,
  optimizeQueryOptions,
  getCacheStats,
  clearQueryCache,
} from './optimizer.js';

// Example 1: Simple time series with automatic optimization
async function timeSeriesWithOptimization() {
  console.log('\n=== Time Series with Auto-Optimization ===\n');

  const timeRange = {
    type: 'absolute',
    from: '2025-01-01T00:00:00Z',
    to: '2025-01-01T01:00:00Z',
  };

  // Build query
  const query = buildTimeSeriesQuery({
    timeRange,
    interval: '5m',
    filters: [
      {
        field: 'response.status', operator: '>=', value: 500, fieldType: 'NUM',
      },
    ],
  });

  console.log('Query:', query);

  // Execute with optimization (auto-caching, tier selection)
  const options = {
    startDate: timeRange.from,
    endDate: timeRange.to,
  };

  const results = await executeOptimizedQuery(query, options, executeDataPrimeQuery);

  console.log(`Received ${results.length} time buckets`);
  console.log('Cache stats:', getCacheStats());
}

// Example 2: Dashboard - Load multiple breakdowns in parallel
async function dashboardWithBatchExecution() {
  console.log('\n=== Dashboard Batch Execution ===\n');

  const timeRange = {
    startDate: '2025-01-01T00:00:00Z',
    endDate: '2025-01-01T12:00:00Z',
  };

  // Define all facets to load
  const facets = [
    { name: 'Status Code', dimension: 'response.status' },
    { name: 'Cache Status', dimension: 'cdn.cache_status' },
    { name: 'HTTP Method', dimension: 'request.method' },
    { name: 'Datacenter', dimension: 'cdn.datacenter' },
    { name: 'Request Type', dimension: 'helix.request_type' },
    { name: 'Backend Type', dimension: 'helix.backend_type' },
    { name: 'Country', dimension: 'client.country_name' },
  ];

  // Build queries for all facets
  const queries = facets.map((facet) => ({
    query: buildBreakdownQuery({
      dimension: facet.dimension,
      topN: 20,
      timeRange: {
        type: 'absolute',
        from: timeRange.startDate,
        to: timeRange.endDate,
      },
      aggregations: [
        { type: 'count', alias: 'cnt' },
        { type: 'avg', field: 'cdn.time_elapsed_msec', alias: 'avg_time' },
      ],
    }),
    options: timeRange,
  }));

  console.log(`Loading ${queries.length} breakdown facets...`);

  // Execute all queries with concurrency limit
  const executeBatch = createBatchExecutor(4); // Max 4 concurrent
  const startTime = Date.now();

  const results = await executeBatch(queries, executeDataPrimeQuery);

  const duration = Date.now() - startTime;
  console.log(`\nDashboard loaded in ${duration}ms`);

  // Display results
  results.forEach((result, i) => {
    console.log(`  ${facets[i].name}: ${result.length} values`);
  });

  console.log('\nCache stats:', getCacheStats());
}

// Example 3: Long-range query with explicit optimization
async function longRangeWithSampling() {
  console.log('\n=== Long-Range Query with Sampling ===\n');

  const timeRange = {
    startDate: '2025-01-01T00:00:00Z',
    endDate: '2025-01-08T00:00:00Z', // 7 days
  };

  // Optimize options based on time range
  const optimized = optimizeQueryOptions(timeRange, 10000); // High cardinality estimate

  console.log('Optimized options:', {
    tier: optimized.tier,
    sampled: optimized.sampled,
    sampleRate: optimized.sampleRate,
    timeRangeHours: optimized.timeRangeHours,
  });

  // Build breakdown query
  const query = buildBreakdownQuery({
    dimension: 'request.host',
    topN: 100,
    timeRange: {
      type: 'absolute',
      from: timeRange.startDate,
      to: timeRange.endDate,
    },
  });

  // Execute with optimized settings
  const results = await executeOptimizedQuery(query, optimized, executeDataPrimeQuery);

  console.log(`Received ${results.length} hosts`);
}

// Example 4: Error analysis with filtering
async function errorAnalysis() {
  console.log('\n=== Error Analysis ===\n');

  const timeRange = {
    type: 'absolute',
    from: '2025-01-01T00:00:00Z',
    to: '2025-01-01T01:00:00Z',
  };

  // Build breakdown of error types
  const query = buildBreakdownQuery({
    dimension: 'response.status',
    topN: 50,
    timeRange,
    filters: [
      {
        field: 'response.status', operator: '>=', value: 400, fieldType: 'NUM',
      },
    ],
    aggregations: [
      { type: 'count', alias: 'cnt' },
      {
        type: 'percentile', field: 'cdn.time_elapsed_msec', alias: 'p99', params: { percentile: 0.99 },
      },
    ],
  });

  console.log('Error analysis query:', query);

  const options = {
    startDate: timeRange.from,
    endDate: timeRange.to,
  };

  const results = await executeOptimizedQuery(query, options, executeDataPrimeQuery);

  console.log(`Found ${results.length} error status codes`);

  // Show top 5 errors
  const topErrors = results.slice(0, 5);
  topErrors.forEach((error) => {
    console.log(`  ${error.userData.dim}: ${error.userData.cnt} requests, p99: ${error.userData.p99}ms`);
  });
}

// Example 5: Cache management pattern
async function cacheManagementPattern() {
  console.log('\n=== Cache Management Pattern ===\n');

  // Clear cache on time range change
  clearQueryCache();
  console.log('Cache cleared on time range change');

  const timeRange = {
    startDate: '2025-01-01T00:00:00Z',
    endDate: '2025-01-01T01:00:00Z',
  };

  // Load dashboard
  const query = buildBreakdownQuery({
    dimension: 'response.status',
    topN: 10,
    timeRange: {
      type: 'absolute',
      from: timeRange.startDate,
      to: timeRange.endDate,
    },
  });

  // First load
  await executeOptimizedQuery(query, timeRange, executeDataPrimeQuery);
  console.log('First load:', getCacheStats());

  // User refreshes dashboard (cache hit)
  await executeOptimizedQuery(query, timeRange, executeDataPrimeQuery);
  console.log('Refresh:', getCacheStats());

  // Different breakdown (cache miss)
  const query2 = buildBreakdownQuery({
    dimension: 'cdn.cache_status',
    topN: 10,
    timeRange: {
      type: 'absolute',
      from: timeRange.startDate,
      to: timeRange.endDate,
    },
  });

  await executeOptimizedQuery(query2, timeRange, executeDataPrimeQuery);
  console.log('Different breakdown:', getCacheStats());

  // Show final stats
  const stats = getCacheStats();
  console.log(`\nFinal stats: ${stats.hits} hits, ${stats.misses} misses, ${(stats.hitRate * 100).toFixed(1)}% hit rate`);
}

// Example 6: Complete dashboard pattern
async function completeDashboardPattern() {
  console.log('\n=== Complete Dashboard Pattern ===\n');

  // Dashboard initialization
  clearQueryCache();
  const executeBatch = createBatchExecutor(4);

  const timeRange = {
    startDate: '2025-01-01T00:00:00Z',
    endDate: '2025-01-01T12:00:00Z',
  };

  // Step 1: Load summary metrics (time series)
  console.log('Step 1: Loading time series...');
  const timeSeriesQuery = buildTimeSeriesQuery({
    timeRange: {
      type: 'absolute',
      from: timeRange.startDate,
      to: timeRange.endDate,
    },
    interval: '30m',
  });

  const timeSeries = await executeOptimizedQuery(
    timeSeriesQuery,
    timeRange,
    executeDataPrimeQuery,
  );

  console.log(`  Loaded ${timeSeries.length} time buckets`);

  // Step 2: Load all breakdowns in parallel
  console.log('\nStep 2: Loading breakdowns...');

  const breakdowns = [
    'response.status',
    'cdn.cache_status',
    'request.method',
    'cdn.datacenter',
    'helix.request_type',
    'helix.backend_type',
  ];

  const breakdownQueries = breakdowns.map((dimension) => ({
    query: buildBreakdownQuery({
      dimension,
      topN: 20,
      timeRange: {
        type: 'absolute',
        from: timeRange.startDate,
        to: timeRange.endDate,
      },
    }),
    options: timeRange,
  }));

  const breakdownResults = await executeBatch(breakdownQueries, executeDataPrimeQuery);

  breakdownResults.forEach((result, i) => {
    console.log(`  ${breakdowns[i]}: ${result.length} values`);
  });

  // Step 3: Show performance summary
  console.log('\nPerformance Summary:');
  const stats = getCacheStats();
  console.log(`  Cache size: ${stats.size} entries`);
  console.log(`  Cache hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
  console.log(`  Total queries: ${stats.hits + stats.misses}`);
}

// Run all examples
async function runAllExamples() {
  try {
    await timeSeriesWithOptimization();
    await dashboardWithBatchExecution();
    await longRangeWithSampling();
    await errorAnalysis();
    await cacheManagementPattern();
    await completeDashboardPattern();

    console.log('\n=== All Integration Examples Complete ===\n');
  } catch (err) {
    console.error('Example failed:', err);
    console.error(err.stack);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples();
}

export {
  timeSeriesWithOptimization,
  dashboardWithBatchExecution,
  longRangeWithSampling,
  errorAnalysis,
  cacheManagementPattern,
  completeDashboardPattern,
};
