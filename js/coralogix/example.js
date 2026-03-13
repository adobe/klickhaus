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
 * Example usage of the Data Prime Query Builder
 */

import {
  buildTimeSeriesQuery,
  buildBreakdownQuery,
  buildLogsQuery,
} from './query-builder.js';

// Example 1: Time series query - Request rate over the last hour
const timeSeriesQuery = buildTimeSeriesQuery({
  timeRange: { type: 'relative', from: '-1h', to: '0' },
  interval: '5m',
  hostFilter: 'www.example.com',
});

console.log('Time Series Query:');
console.log(timeSeriesQuery);
console.log();

// Example 2: Error tracking - 5xx errors over last 24 hours
const errorTrackingQuery = buildTimeSeriesQuery({
  timeRange: { type: 'relative', from: '-24h', to: '0' },
  interval: '1h',
  filters: [
    {
      field: 'response.status', operator: '>=', value: 500, fieldType: 'NUM',
    },
  ],
});

console.log('Error Tracking Query:');
console.log(errorTrackingQuery);
console.log();

// Example 3: Breakdown query - Top 10 hosts by request count
const topHostsQuery = buildBreakdownQuery({
  dimension: 'request.host',
  topN: 10,
  timeRange: { type: 'relative', from: '-1h', to: '0' },
  aggregations: [
    { type: 'count', alias: 'requests' },
  ],
});

console.log('Top Hosts Query:');
console.log(topHostsQuery);
console.log();

// Example 4: Cache performance analysis
const cachePerformanceQuery = buildBreakdownQuery({
  dimension: 'cdn.cache_status',
  topN: 10,
  timeRange: { type: 'relative', from: '-1h', to: '0' },
  filters: [
    {
      field: 'source', operator: '==', value: 'cloudflare', fieldType: 'STRING',
    },
  ],
  aggregations: [
    { type: 'count', alias: 'requests' },
    { type: 'avg', field: 'cdn.time_elapsed_msec', alias: 'avg_latency' },
  ],
});

console.log('Cache Performance Query:');
console.log(cachePerformanceQuery);
console.log();

// Example 5: URL performance analysis with percentiles
const urlPerformanceQuery = buildBreakdownQuery({
  dimension: 'request.url',
  topN: 20,
  timeRange: { type: 'relative', from: '-6h', to: '0' },
  filters: [
    {
      field: 'request.host', operator: '==', value: 'www.example.com', fieldType: 'STRING',
    },
    {
      field: 'response.status', operator: '==', value: 200, fieldType: 'NUM',
    },
  ],
  aggregations: [
    { type: 'count', alias: 'hits' },
    { type: 'avg', field: 'cdn.time_elapsed_msec', alias: 'avg_time' },
    {
      type: 'percentile',
      field: 'cdn.time_elapsed_msec',
      params: { percentile: 0.95 },
      alias: 'p95_time',
    },
    {
      type: 'percentile',
      field: 'cdn.time_elapsed_msec',
      params: { percentile: 0.99 },
      alias: 'p99_time',
    },
  ],
});

console.log('URL Performance Query:');
console.log(urlPerformanceQuery);
console.log();

// Example 6: Recent error logs
const recentErrorsQuery = buildLogsQuery({
  timeRange: { type: 'relative', from: '-10m', to: '0' },
  filters: [
    {
      field: 'response.status', operator: '>=', value: 500, fieldType: 'NUM',
    },
  ],
  limit: 100,
});

console.log('Recent Errors Query:');
console.log(recentErrorsQuery);
console.log();

// Example 7: Complex multi-filter query
const complexQuery = buildLogsQuery({
  timeRange: { type: 'absolute', from: '2025-11-21T00:00:00', to: '2025-11-22T00:00:00' },
  filters: [
    {
      field: 'response.status', operator: '==', value: 500, fieldType: 'NUM', logicalOperator: 'AND',
    },
    {
      field: 'request.url', operator: 'contains', value: '/api/', fieldType: 'STRING',
    },
    {
      field: 'cdn.cache_status', operator: '!=', value: 'HIT', fieldType: 'STRING',
    },
  ],
  limit: 500,
});

console.log('Complex Filter Query:');
console.log(complexQuery);
console.log();

// Example 8: Status code distribution
const statusDistributionQuery = buildBreakdownQuery({
  dimension: 'response.status',
  topN: 20,
  timeRange: { type: 'relative', from: '-1h', to: '0' },
  aggregations: [
    { type: 'count', alias: 'cnt' },
  ],
});

console.log('Status Code Distribution Query:');
console.log(statusDistributionQuery);
console.log();

// Example 9: Datacenter performance comparison
const datacenterQuery = buildBreakdownQuery({
  dimension: 'cdn.datacenter',
  topN: 15,
  timeRange: { type: 'relative', from: '-6h', to: '0' },
  aggregations: [
    { type: 'count', alias: 'requests' },
    { type: 'avg', field: 'cdn.time_elapsed_msec', alias: 'avg_latency' },
    { type: 'min', field: 'cdn.time_elapsed_msec', alias: 'min_latency' },
    { type: 'max', field: 'cdn.time_elapsed_msec', alias: 'max_latency' },
  ],
});

console.log('Datacenter Performance Query:');
console.log(datacenterQuery);
console.log();

// Example 10: Content type breakdown
const contentTypeQuery = buildBreakdownQuery({
  dimension: 'response.headers.content_type',
  topN: 10,
  timeRange: { type: 'relative', from: '-1h', to: '0' },
  filters: [
    {
      field: 'response.status', operator: '==', value: 200, fieldType: 'NUM',
    },
  ],
  aggregations: [
    { type: 'count', alias: 'requests' },
    { type: 'sum', field: 'response.body_size', alias: 'total_bytes' },
  ],
});

console.log('Content Type Breakdown Query:');
console.log(contentTypeQuery);
console.log();
