/*
 * Copyright 2026 Adobe. All rights reserved.
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
 * Filter Translator Usage Examples
 *
 * This file demonstrates how to use the filter translator to convert
 * Klickhaus filters to Data Prime query syntax.
 */

import {
  translateFilter,
  translateFacetFilters,
  buildFilterClause,
  translateHostFilter,
  translateInFilter,
  translateFilterWithOperator,
} from './filter-translator.js';

// Example 1: Basic filter translation
console.log('Example 1: Basic filter translation');
console.log('=====================================');

const basicFilter = {
  col: '`request.host`',
  value: 'example.com',
  exclude: false,
};

console.log('Input:', JSON.stringify(basicFilter, null, 2));
console.log('Output:', translateFilter(basicFilter));
console.log();

// Example 2: Exclude filter
console.log('Example 2: Exclude filter');
console.log('=========================');

const excludeFilter = {
  col: '`response.status`',
  value: 404,
  exclude: true,
};

console.log('Input:', JSON.stringify(excludeFilter, null, 2));
console.log('Output:', translateFilter(excludeFilter));
console.log();

// Example 3: Multiple filters combined
console.log('Example 3: Multiple filters combined');
console.log('====================================');

const multipleFilters = [
  { col: '`request.host`', value: 'example.com', exclude: false },
  { col: '`response.status`', value: 200, exclude: false },
  { col: '`cdn.cache_status`', value: 'MISS', exclude: true },
];

console.log('Input:', JSON.stringify(multipleFilters, null, 2));
console.log('Combined expression:', translateFacetFilters(multipleFilters));
console.log('Filter clause:', buildFilterClause(multipleFilters));
console.log();

// Example 4: LIKE operator
console.log('Example 4: LIKE operator');
console.log('=======================');

const likeFilter = {
  col: '`request.url`',
  value: '%/api/%',
  exclude: false,
  filterOp: 'LIKE',
};

console.log('Input:', JSON.stringify(likeFilter, null, 2));
console.log('Output:', translateFilter(likeFilter));
console.log();

// Example 5: Host filter (convenience method)
console.log('Example 5: Host filter (convenience method)');
console.log('===========================================');

console.log('Include host:', translateHostFilter('example.com'));
console.log('Exclude host:', translateHostFilter('spam.com', true));
console.log();

// Example 6: IN filter
console.log('Example 6: IN filter');
console.log('===================');

const hosts = ['example.com', 'test.com', 'demo.com'];
console.log('Hosts:', hosts);
console.log('Include:', translateInFilter('`request.host`', hosts));
console.log('Exclude:', translateInFilter('`request.host`', hosts, true));
console.log();

// Example 7: Filter with explicit operator
console.log('Example 7: Filter with explicit operator');
console.log('========================================');

console.log('Contains:', translateFilterWithOperator('`request.url`', 'contains', '/api/'));
console.log('Starts with:', translateFilterWithOperator('`request.url`', 'startsWith', '/v1/'));
console.log('Greater than:', translateFilterWithOperator('`response.status`', '>', 400));
console.log('Less than or equal:', translateFilterWithOperator('`response.status`', '<=', 299));
console.log();

// Example 8: Complete Data Prime query
console.log('Example 8: Complete Data Prime query');
console.log('====================================');

const filters = [
  { col: '`request.host`', value: 'example.com', exclude: false },
  { col: '`response.status`', value: 200, exclude: false },
];

const baseQuery = 'source logs between "2026-02-16T00:00:00Z" and "2026-02-16T23:59:59Z"';
const filterClause = buildFilterClause(filters);
const completeQuery = `${baseQuery} ${filterClause} | limit 100`;

console.log('Base query:', baseQuery);
console.log('Filters:', JSON.stringify(filters, null, 2));
console.log('Complete query:', completeQuery);
console.log();

// Example 9: Special characters
console.log('Example 9: Special characters');
console.log('=============================');

const specialCharFilter = {
  col: '`custom.field`',
  value: "O'Reilly & Sons",
  exclude: false,
};

console.log('Input:', JSON.stringify(specialCharFilter, null, 2));
console.log('Output:', translateFilter(specialCharFilter));
console.log();

// Example 10: Override filterCol and filterValue
console.log('Example 10: Override filterCol and filterValue');
console.log('==============================================');

const overrideFilter = {
  col: '`display.column`',
  value: 'display-value',
  exclude: false,
  filterCol: '`actual.column`',
  filterValue: 'actual-value',
};

console.log('Input:', JSON.stringify(overrideFilter, null, 2));
console.log('Output:', translateFilter(overrideFilter));
console.log('(Uses filterCol and filterValue instead of col and value)');
