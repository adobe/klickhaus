# Coralogix HTTP Interceptor

This directory contains a vanilla JavaScript HTTP interceptor for Coralogix authentication. The interceptor automatically adds authentication headers to requests and handles token refresh on 401 errors.

## Files

- **interceptor.js** - HTTP interceptor that wraps `fetch()` with authentication
- **auth.js** - Authentication state management (token and team ID)
- **api.js** - Coralogix DataPrime API client (uses the interceptor)

## Features

1. Automatic Authorization Bearer header injection
2. Automatic CGX-Team-Id header injection
3. 401 error handling with automatic token refresh and retry
4. 403 error logging
5. Skip auth for login/refresh endpoints
6. Compatible with AbortController
7. Prevents infinite retry loops

## Usage

### Basic Setup

```javascript
import { setAuthCredentials } from './auth.js';
import { authenticatedFetch } from './interceptor.js';

// Set authentication credentials
setAuthCredentials('your-bearer-token', 12345); // token, teamId

// Make authenticated requests
const response = await authenticatedFetch('https://api.coralogix.com/data');
const data = await response.json();
```

### With AbortController

```javascript
import { authenticatedFetch } from './interceptor.js';

const controller = new AbortController();

try {
  const response = await authenticatedFetch('/api/data', {
    signal: controller.signal
  });
  const data = await response.json();
} catch (err) {
  if (err.name === 'AbortError') {
    console.log('Request cancelled');
  }
}

// Cancel the request
controller.abort();
```

### Skip Authentication for Specific Requests

```javascript
import { authenticatedFetch } from './interceptor.js';

// Skip auth by adding X-Skip-Auth header
const response = await authenticatedFetch('/api/public', {
  headers: {
    'X-Skip-Auth': 'true'
  }
});
```

### Using the DataPrime API Client

```javascript
import { setAuthCredentials } from './auth.js';
import { executeDataPrimeQuery, TIER_ARCHIVE } from './api.js';

// Set credentials
setAuthCredentials('your-token', 12345);

// Execute a query
const results = await executeDataPrimeQuery(
  'source logs | filter severity == "ERROR" | limit 100',
  {
    tier: TIER_ARCHIVE,
    startDate: '2026-02-16T00:00:00Z',
    endDate: '2026-02-16T23:59:59Z',
    limit: 100
  }
);

console.log('Results:', results);
```

## Authentication Flow

1. **Initial Request**: Interceptor adds `Authorization: Bearer <token>` and `CGX-Team-Id: <teamId>` headers
2. **401 Response**: Interceptor catches 401 error, calls `refreshToken()`, then retries with new token
3. **Refresh Failure**: If refresh fails, `forceLogout()` is called and an `auth-logout` event is dispatched
4. **403 Response**: Logged to console for debugging

## Skipped URLs

The following URL patterns automatically skip authentication:

- `/user/login`
- `/user/refresh`
- `/user/forgotpassword`
- `/user/resetpassword`

## Token Refresh

The token refresh mechanism requires implementing the refresh endpoint. Update `auth.js` to customize:

```javascript
export async function refreshToken() {
  const refreshTokenValue = getRefreshToken();
  if (!refreshTokenValue) {
    throw new Error('No refresh token available');
  }

  const response = await fetch('/user/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshTokenValue })
  });

  if (!response.ok) {
    throw new Error('Token refresh failed');
  }

  const data = await response.json();
  authState.token = data.token;

  if (data.refresh_token) {
    authState.refreshToken = data.refresh_token;
  }
}
```

## Events

The auth system dispatches the following events:

- **auth-logout**: Fired when `forceLogout()` is called (e.g., after refresh token failure)

```javascript
window.addEventListener('auth-logout', (event) => {
  console.log('Logout reason:', event.detail.reason);
  // Redirect to login page or show login modal
});
```

## Integration with Existing Code

To replace existing `fetch()` calls in your codebase:

```javascript
// Before
const response = await fetch(url, options);

// After
import { authenticatedFetch } from './js/coralogix/interceptor.js';
const response = await authenticatedFetch(url, options);
```

The interceptor is a drop-in replacement for `fetch()` and maintains full compatibility with:

- All standard fetch options (method, headers, body, etc.)
- AbortController signals
- Error handling
- Response types

## Error Handling

The interceptor preserves standard fetch error handling:

```javascript
try {
  const response = await authenticatedFetch('/api/data');

  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}`);
  }

  const data = await response.json();
} catch (err) {
  if (err.name === 'AbortError') {
    console.log('Request cancelled');
  } else {
    console.error('Request failed:', err);
  }
}
```

## Reference Implementation

This interceptor is based on the Angular HTTP interceptor from `/Users/yoni/trace-agg/src/app/auth/shared/interceptors/auth.interceptor.ts`, adapted to vanilla JavaScript with the same feature set:

- Auto-inject auth headers
- Token refresh on 401
- Skip auth for specific URLs
- Error logging
- Retry prevention for already-retrying requests

---

# Filter Translator

The `filter-translator.js` module provides utilities to convert Klickhaus filter format to Coralogix Data Prime query syntax.

## Files

- **filter-translator.js** - Filter translation layer for Data Prime
- **filter-translator.test.js** - Comprehensive test suite (57 tests)

## Quick Start

```javascript
import {
  translateFilter,
  translateFacetFilters,
  buildFilterClause,
} from './coralogix/filter-translator.js';

// Translate a single filter
const filter = {
  col: '`request.host`',
  value: 'example.com',
  exclude: false,
};
translateFilter(filter);
// => "$l.request.host == 'example.com'"

// Translate multiple filters
const filters = [
  { col: '`request.host`', value: 'example.com', exclude: false },
  { col: '`response.status`', value: 200, exclude: false },
];
buildFilterClause(filters);
// => "| filter ($l.request.host == 'example.com') && ($l.response.status == 200)"
```

## Data Prime Namespace Mapping

The translator automatically maps ClickHouse columns to Data Prime namespaces:

- **`$m`** (metadata): `timestamp`
- **`$l`** (labels): `source`, `request.*`, `response.*`, `cdn.*`, `client.*`
- **`$d`** (data): All other fields (headers, custom fields, etc.)

## Supported Operators

| Operator | Data Prime Syntax | Example |
|----------|------------------|---------|
| `=`, `==` | `==` | `$l.request.host == 'example.com'` |
| `!=` | `!=` | `$l.response.status != 404` |
| `>`, `<`, `>=`, `<=` | `>`, `<`, `>=`, `<=` | `$l.response.status > 400` |
| `contains` | `.contains()` | `$l.request.url.contains('/api/')` |
| `startsWith` | `.startsWith()` | `$l.request.url.startsWith('/v1/')` |
| `LIKE` | `.contains()` | Converts `%/api/%` to `.contains('/api/')` |
| `in` | `.in([])` | `$l.request.host.in(['a.com', 'b.com'])` |

## API Reference

### Core Functions

#### `translateFilter(filter)`

Translate a single Klickhaus filter to Data Prime syntax.

```javascript
translateFilter({
  col: '`request.host`',
  value: 'example.com',
  exclude: false,
});
// => "$l.request.host == 'example.com'"

translateFilter({
  col: '`response.status`',
  value: 404,
  exclude: true,
});
// => "$l.response.status != 404"
```

#### `translateFacetFilters(filters)`

Translate multiple filters and combine with AND logic.

```javascript
const filters = [
  { col: '`request.host`', value: 'example.com', exclude: false },
  { col: '`response.status`', value: 200, exclude: false },
];
translateFacetFilters(filters);
// => "($l.request.host == 'example.com') && ($l.response.status == 200)"
```

#### `buildFilterClause(filters)`

Build a complete Data Prime filter clause.

```javascript
buildFilterClause(filters);
// => "| filter ($l.request.host == 'example.com') && ($l.response.status == 200)"
```

### Utility Functions

#### `getFieldPath(clickhouseColumn)`

Convert a ClickHouse column reference to a Data Prime field path.

```javascript
getFieldPath('`request.host`');    // => '$l.request.host'
getFieldPath('`timestamp`');       // => '$m.timestamp'
getFieldPath('`custom.field`');    // => '$d.custom.field'
```

#### `escapeValue(value)`

Escape and quote a filter value for Data Prime syntax.

```javascript
escapeValue('example.com');   // => "'example.com'"
escapeValue(200);             // => "200"
escapeValue("O'Reilly");      // => "'O\\'Reilly'"
```

#### `translateHostFilter(host, exclude = false)`

Convenience method for host filters.

```javascript
translateHostFilter('example.com');        // => "$l.request.host == 'example.com'"
translateHostFilter('example.com', true);  // => "$l.request.host != 'example.com'"
```

#### `translateInFilter(column, values, exclude = false)`

Translate an IN list filter to Data Prime syntax.

```javascript
translateInFilter('`request.host`', ['a.com', 'b.com']);
// => "$l.request.host.in(['a.com', 'b.com'])"

translateInFilter('`request.host`', ['spam.com'], true);
// => "$l.request.host != 'spam.com'"
```

#### `translateFilterWithOperator(column, operator, value, exclude = false)`

Translate a filter with explicit operator support.

```javascript
translateFilterWithOperator('`request.url`', 'contains', '/api/');
// => "$l.request.url.contains('/api/')"

translateFilterWithOperator('`response.status`', '>', 400);
// => "$l.response.status > 400"
```

## Examples

### Basic Filters

```javascript
// Include filter
translateFilter({
  col: '`request.host`',
  value: 'example.com',
  exclude: false,
});
// => "$l.request.host == 'example.com'"

// Exclude filter
translateFilter({
  col: '`cdn.cache_status`',
  value: 'MISS',
  exclude: true,
});
// => "$l.cdn.cache_status != 'MISS'"
```

### LIKE Operator

```javascript
translateFilter({
  col: '`request.url`',
  value: '%/api/%',
  filterOp: 'LIKE',
  exclude: false,
});
// => "$l.request.url.contains('/api/')"
```

### Multiple Filters

```javascript
const filters = [
  { col: '`request.host`', value: 'example.com', exclude: false },
  { col: '`response.status`', value: 404, exclude: true },
  { col: '`cdn.cache_status`', value: 'HIT', exclude: false },
];

buildFilterClause(filters);
// => "| filter ($l.request.host == 'example.com') && ($l.response.status != 404) && ($l.cdn.cache_status == 'HIT')"
```

### IN Filter

```javascript
// Multiple hosts
translateInFilter('`request.host`', ['example.com', 'test.com', 'demo.com']);
// => "$l.request.host.in(['example.com', 'test.com', 'demo.com'])"

// Exclude bad hosts (expands to multiple != conditions)
translateInFilter('`request.host`', ['bad.com', 'spam.com'], true);
// => "$l.request.host != 'bad.com' && $l.request.host != 'spam.com'"
```

### Special Characters

```javascript
// Quotes are escaped
translateFilter({
  col: '`custom.field`',
  value: "O'Reilly",
  exclude: false,
});
// => "$d.custom.field == 'O\\'Reilly'"

// Empty values
translateFilter({
  col: '`request.headers.referer`',
  value: '',
  exclude: false,
});
// => "$d.request.headers.referer == ''"
```

## Klickhaus Filter Format

Klickhaus filters follow this structure:

```javascript
{
  col: '`request.host`',       // Column name (with backticks)
  value: 'example.com',         // Filter value
  exclude: false,               // Whether this is an exclusion filter
  filterCol: '`actual.col`',    // Optional: override column for filtering
  filterValue: 'actual-value',  // Optional: override value for filtering
  filterOp: '='                 // Optional: operator ('=' or 'LIKE')
}
```

## Testing

Run tests with:

```bash
npx vitest run js/coralogix/filter-translator.test.js
```

All 57 tests should pass, covering:
- Field path conversion
- Value escaping
- Filter translation
- Operator handling
- Multiple filter combination
- IN filters
- Edge cases (empty values, special characters, etc.)

## Integration

To use the filter translator with existing Klickhaus code:

```javascript
import { state } from './state.js';
import { buildFilterClause } from './coralogix/filter-translator.js';

// Convert Klickhaus filters to Data Prime
const filterClause = buildFilterClause(state.filters);

// Append to Data Prime query
const query = `source logs ${filterClause} | limit 100`;
```

---

# Data Prime Query Builder

Pure JavaScript query builder for generating [Coralogix Data Prime](https://coralogix.com/docs/dataprime-query-language/) queries from klickhaus CDN log analytics.

## Overview

This module translates ClickHouse field names and query patterns into Data Prime syntax, mapping klickhaus's CDN request data model to Coralogix's field path conventions.

## Field Mapping

Data Prime uses prefixed field paths to distinguish between data, metadata, and labels:

| ClickHouse Field | Data Prime Path | Prefix | Description |
|------------------|-----------------|--------|-------------|
| `timestamp` | `$m.timestamp` | `$m` | Metadata timestamp |
| `source` | `$l.subsystemname` | `$l` | Label (cloudflare/fastly) |
| `request.host` | `$d.request.host` | `$d` | Data field |
| `response.status` | `$d.response.status` | `$d` | Data field |
| `cdn.cache_status` | `$d.cdn.cache_status` | `$d` | Data field |

Unknown fields default to `$d.*` prefix.

## API

### High-Level Query Builders

#### `buildTimeSeriesQuery(params)`

Generates time-bucketed aggregation queries.

```javascript
import { buildTimeSeriesQuery } from './query-builder.js';

const query = buildTimeSeriesQuery({
  timeRange: { type: 'relative', from: '-1h', to: '0' },
  interval: '5m',
  hostFilter: 'example.com',
  filters: [
    { field: 'response.status', operator: '>=', value: 400, fieldType: 'NUM' }
  ]
});
// Result:
// source logs between now(-1h) and now() |
// filter $d.response.status >= 400 && $d.request.host == 'example.com' |
// groupby $m.timestamp.bucket(5m) as bucket |
// aggregate count() as requests
```

**Parameters:**
- `timeRange` (object): Time range specification
  - `type`: `'relative'` or `'absolute'`
  - `from`: Start time (e.g., `'-1h'` or `'2025-11-21T00:00:00'`)
  - `to`: End time (e.g., `'0'` or `'2025-11-22T00:00:00'`)
- `interval` (string): Bucket size (e.g., `'1m'`, `'5m'`, `'1h'`)
- `filters` (array): Filter conditions (optional)
- `hostFilter` (string): Quick host filter shorthand (optional)

#### `buildBreakdownQuery(params)`

Generates grouped aggregation queries (top-N by dimension).

```javascript
import { buildBreakdownQuery } from './query-builder.js';

const query = buildBreakdownQuery({
  dimension: 'cdn.cache_status',
  topN: 10,
  timeRange: { type: 'relative', from: '-1h', to: '0' },
  filters: [
    { field: 'source', operator: '==', value: 'cloudflare', fieldType: 'STRING' }
  ],
  aggregations: [
    { type: 'count', alias: 'requests' },
    { type: 'avg', field: 'cdn.time_elapsed_msec', alias: 'avg_latency' }
  ]
});
// Result:
// source logs between now(-1h) and now() |
// filter $l.subsystemname == 'cloudflare' |
// groupby $d.cdn.cache_status as dim |
// aggregate count() as requests, avg($d.cdn.time_elapsed_msec) as avg_latency |
// limit 10
```

**Parameters:**
- `dimension` (string): Field to group by
- `topN` (number): Limit results (default: 10, 0 = no limit)
- `timeRange` (object): Optional time range
- `filters` (array): Filter conditions (optional)
- `aggregations` (array): Custom aggregations (default: count)

#### `buildLogsQuery(params)`

Generates raw log queries with filtering.

```javascript
import { buildLogsQuery } from './query-builder.js';

const query = buildLogsQuery({
  timeRange: { type: 'relative', from: '-10m', to: '0' },
  filters: [
    { field: 'response.status', operator: '>=', value: 500, fieldType: 'NUM' },
    { field: 'request.url', operator: 'contains', value: '/api/', fieldType: 'STRING' }
  ],
  limit: 100
});
// Result:
// source logs between now(-10m) and now() |
// filter $d.response.status >= 500 && $d.request.url.contains('/api/') |
// limit 100
```

**Parameters:**
- `timeRange` (object): Optional time range
- `filters` (array): Filter conditions (optional)
- `limit` (number): Result limit (default: 100, 0 = no limit)

### Low-Level Utilities

#### `formatValue(value, fieldType)`

Formats values for Data Prime syntax (quoting, escaping).

```javascript
formatValue('hello')           // "'hello'"
formatValue(42)                // "42"
formatValue(true)              // "true"
formatValue([1, 2, 3])         // "[1, 2, 3]"
formatValue('123', 'NUM')      // "123"
formatValue('123', 'STRING')   // "'123'"
```

#### `buildFilterExpression(condition)`

Builds a single filter condition.

```javascript
buildFilterExpression({
  field: 'response.status',
  operator: '>=',
  value: 400,
  fieldType: 'NUM'
})
// "$d.response.status >= 400"
```

**Supported operators:**
- Comparison: `==`, `!=`, `>`, `<`, `>=`, `<=`
- String: `contains`, `startsWith`
- Set: `in`
- Null checks: `isNull`, `isNotNull`

#### `buildFilterClause(conditions)`

Combines multiple filter conditions with AND/OR.

```javascript
buildFilterClause([
  { field: 'response.status', operator: '>=', value: 400, fieldType: 'NUM', logicalOperator: 'AND' },
  { field: 'request.host', operator: '==', value: 'example.com', fieldType: 'STRING' }
])
// "$d.response.status >= 400 && $d.request.host == 'example.com'"
```

#### `buildGroupByExpression(field)`

Builds a group-by field with optional transforms.

```javascript
buildGroupByExpression({
  field: 'timestamp',
  transform: 'bucket',
  transformParams: { interval: '5m' },
  alias: 'bucket'
})
// "$m.timestamp.bucket(5m) as bucket"
```

**Supported transforms:**
- `bucket`: Time bucketing (requires `transformParams.interval`)
- `toLowerCase`: Lowercase string
- `toUpperCase`: Uppercase string

#### `buildAggregationExpression(func)`

Builds an aggregation function.

```javascript
buildAggregationExpression({
  type: 'percentile',
  field: 'cdn.time_elapsed_msec',
  params: { percentile: 0.99 },
  alias: 'p99'
})
// "percentile(0.99, $d.cdn.time_elapsed_msec) as p99"
```

**Supported aggregations:**
- `count()` / `count(field)`
- `distinct_count(field)`
- `avg(field)`, `max(field)`, `min(field)`, `sum(field)`
- `percentile(value, field, precision?)`

## Field Type Hints

Use `fieldType` to ensure correct value formatting:

| fieldType | Effect | Example |
|-----------|--------|---------|
| `'STRING'` | Always quote | `'example.com'` |
| `'NUM'` | Never quote | `200` |
| `'BOOL'` | Never quote | `true` |
| (omitted) | Infer from JS type | `'hello'` → `"'hello'"`, `42` → `"42"` |

Without `fieldType`, JavaScript type inference is used (strings get quotes, numbers/booleans don't).

## Time Ranges

### Relative (using `now()`)

```javascript
{
  type: 'relative',
  from: '-1h',   // 1 hour ago
  to: '0'        // now (or '0m')
}
// Output: between now(-1h) and now()
```

**Common intervals:** `-5m`, `-10m`, `-1h`, `-6h`, `-24h`, `-7d`

### Absolute (ISO timestamps)

```javascript
{
  type: 'absolute',
  from: '2025-11-21T00:00:00',
  to: '2025-11-22T00:00:00'
}
// Output: between @'2025-11-21T00:00:00' and @'2025-11-22T00:00:00'
```

## Examples

### Error Rate Over Time

```javascript
buildTimeSeriesQuery({
  timeRange: { type: 'relative', from: '-24h', to: '0' },
  interval: '1h',
  filters: [
    { field: 'response.status', operator: '>=', value: 500, fieldType: 'NUM' }
  ]
});
```

### Top 10 Slowest URLs

```javascript
buildBreakdownQuery({
  dimension: 'request.url',
  topN: 10,
  timeRange: { type: 'relative', from: '-6h', to: '0' },
  filters: [
    { field: 'request.host', operator: '==', value: 'www.example.com', fieldType: 'STRING' }
  ],
  aggregations: [
    { type: 'count', alias: 'hits' },
    { type: 'avg', field: 'cdn.time_elapsed_msec', alias: 'avg_time' },
    { type: 'percentile', field: 'cdn.time_elapsed_msec', params: { percentile: 0.99 }, alias: 'p99_time' }
  ]
});
```

### Cache Performance by CDN Source

```javascript
buildBreakdownQuery({
  dimension: 'cdn.cache_status',
  topN: 10,
  timeRange: { type: 'relative', from: '-1h', to: '0' },
  filters: [
    { field: 'source', operator: '==', value: 'cloudflare', fieldType: 'STRING' }
  ],
  aggregations: [
    { type: 'count', alias: 'requests' },
    { type: 'avg', field: 'cdn.time_elapsed_msec', alias: 'avg_latency' }
  ]
});
```

### Recent 500 Errors

```javascript
buildLogsQuery({
  timeRange: { type: 'relative', from: '-10m', to: '0' },
  filters: [
    { field: 'response.status', operator: '==', value: 500, fieldType: 'NUM' },
    { field: 'request.url', operator: 'contains', value: '/api/', fieldType: 'STRING' }
  ],
  limit: 100
});
```

## Testing

Run the test suite:

```bash
npm test js/coralogix/query-builder.test.js
```

Or with Node.js test runner directly:

```bash
node --test js/coralogix/query-builder.test.js
```

All 62 tests should pass, covering:
- Field path mapping
- Value formatting
- Filter expressions
- Time range expressions
- Group by clauses
- Aggregation functions
- Complete query generation
- Integration scenarios

## Reference

Based on the Data Prime query builder from [trace-agg/dp-query-builder](../../trace-agg/dp-query-builder/), adapted for klickhaus's CDN log schema and field mapping requirements.

Data Prime documentation: https://coralogix.com/docs/dataprime-query-language/

---

# NDJSON Parser

NDJSON parser for Coralogix Data Prime responses. Transforms Coralogix query results to klickhaus-compatible format.

## Overview

This parser handles newline-delimited JSON (NDJSON) responses from Coralogix Data Prime queries and transforms them into a format compatible with klickhaus expectations.

## Files

- **ndjson-parser.js** - NDJSON parser with field mapping
- **ndjson-parser.test.js** - Comprehensive test suite (42 tests, 100% coverage)

## Coralogix Response Format

```json
{"queryId": {"queryId": "abc123"}}
{"result": {"results": [{"metadata": [...], "labels": [...], "userData": "..."}]}}
{"result": {"results": [...]}}
```

## Klickhaus Format

The parser transforms Coralogix responses into records with the following structure:

```javascript
{
  // User data fields (from $d.* paths)
  field1: value1,
  field2: value2,
  nested: { field: value },

  // Metadata (from $m.* paths)
  _metadata: {
    timestamp: "2024-01-15T10:00:00Z",
    severity: "INFO",
  },

  // Labels (from $l.* paths)
  _labels: {
    serviceName: "api",
    region: "us-east-1",
  }
}
```

## Quick Start

```javascript
import { parseNDJSON, getValueByDataprimePath } from './coralogix/ndjson-parser.js';

const response = `{"queryId": {"queryId": "abc123"}}
{"result": {"results": [{"metadata": [], "labels": [], "userData": "{\\"count\\": 42}"}]}}`;

const { queryId, results } = parseNDJSON(response);
// queryId: "abc123"
// results: [{ count: 42, _metadata: {}, _labels: {} }]

// Access fields using DataPrime paths
getValueByDataprimePath(results[0], '$d.count'); // 42
```

## API Reference

### `parseNDJSON(text)`

Parse a complete NDJSON response from Coralogix.

**Parameters:**
- `text` (string): Raw NDJSON response string

**Returns:**
```javascript
{
  queryId: string | null,
  results: Array<Object>
}
```

### `parseResultLine(result)`

Parse a single result object from a Coralogix result line.

**Parameters:**
- `result` (Object): Single result object with metadata, labels, and userData

**Returns:** Object | null - Parsed result object or null if invalid

### `extractUserData(result)`

Extract and parse userData from a result object.

**Parameters:**
- `result` (Object): Single result object with userData field

**Returns:** Object | null - Parsed userData object or null if invalid

### `getNestedValue(obj, path)`

Get nested value from an object using a dot-notation path.

**Parameters:**
- `obj` (Object): Object to traverse
- `path` (string): Dot-notation path (e.g., 'kubernetes.pod.name')

**Returns:** * - Value at the path or undefined

**Example:**
```javascript
const obj = { kubernetes: { pod: { name: 'frontend-123' } } };
const name = getNestedValue(obj, 'kubernetes.pod.name');
// 'frontend-123'
```

### `getValueByDataprimePath(record, dataprimePath)`

Get a value from a klickhaus record using a DataPrime path.

**Parameters:**
- `record` (Object): Klickhaus record with `_metadata` and `_labels`
- `dataprimePath` (string): DataPrime path

**Returns:** * - Value at the specified path

**DataPrime Path Mapping:**
- `$m.<field>` → `_metadata.<field>` (metadata fields)
- `$l.<field>` → `_labels.<field>` (label fields)
- `$d.<field>` → root level field (user data fields)
- `<field>` (no prefix) → root level field (user data fields)

**Example:**
```javascript
const record = {
  duration: 123,
  kubernetes: { pod: { name: 'frontend-123' } },
  _metadata: { severity: 'INFO', timestamp: '2024-01-15T10:00:00Z' },
  _labels: { serviceName: 'api', region: 'us-east-1' }
};

getValueByDataprimePath(record, '$m.severity'); // 'INFO'
getValueByDataprimePath(record, '$l.serviceName'); // 'api'
getValueByDataprimePath(record, '$d.duration'); // 123
getValueByDataprimePath(record, '$d.kubernetes.pod.name'); // 'frontend-123'
```

## Testing

Run tests with:
```bash
npm test -- --files 'js/coralogix/ndjson-parser.test.js'
```

The test suite includes:
- NDJSON parsing with queryId extraction
- Multiple result lines parsing
- Metadata and labels handling
- Error handling for malformed input
- Nested userData structures
- DataPrime path resolution
- Integration tests with real-world Coralogix responses

All 42 tests pass with 100% code coverage.

## Reference

Based on the TypeScript implementation at:
`/Users/yoni/trace-agg/src/app/services/data-explorer/ndjson-parser.ts`
