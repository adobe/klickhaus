# Data Prime Query Builder for Logs View

This module provides a Data Prime query builder for migrating the Klickhaus logs view from ClickHouse to Coralogix Data Prime.

## Overview

The Data Prime query builder (`logs.dataprime.js`) converts ClickHouse-style queries to Coralogix Data Prime query language, maintaining feature parity with the existing implementation.

## Features

- ✅ Time-based filtering with start/end timestamps
- ✅ Host filtering (request.host or x_forwarded_host)
- ✅ Facet/column filters with multiple operators (=, !=, LIKE, >, <, IN, etc.)
- ✅ Field selection for column pinning
- ✅ Sorting (timestamp DESC/ASC)
- ✅ Pagination with offset/limit
- ✅ Additional WHERE clause support
- ✅ Subsystem filtering (Cloudflare/Fastly)

## Migration Mapping

### ClickHouse → Data Prime

| Feature | ClickHouse SQL | Data Prime |
|---------|---------------|------------|
| **Source** | `FROM cdn_requests_v2` | `source logs` |
| **Subsystem Filter** | N/A (implicit in table) | `filter $l.subsystemname in ['cloudflare', 'fastly']` |
| **Time Filter** | `WHERE timestamp >= X AND timestamp <= Y` | `filter timestamp >= timestamp('X') && timestamp <= timestamp('Y')` |
| **Host Filter** | `WHERE request.host LIKE '%value%'` | `filter $l['request.host'].includes('value')` |
| **Equality Filter** | `WHERE col = 'value'` | `filter $l['col'] == 'value'` |
| **LIKE Filter** | `WHERE col LIKE '%value%'` | `filter $l['col'].includes('value')` |
| **Comparison** | `WHERE col >= value` | `filter $l['col'] >= value` |
| **IN Filter** | `WHERE col IN ('a', 'b')` | `filter $l['col'] in ['a', 'b']` |
| **Field Selection** | `SELECT col1, col2` | `choose $l['col1'] as \`col1\`, $l['col2'] as \`col2\`` |
| **Sort** | `ORDER BY timestamp DESC` | `sort timestamp desc` |
| **Pagination** | `LIMIT 100 OFFSET 50` | `limit 100 offset 50` |

### Field Access Patterns

| ClickHouse Column | Data Prime Field |
|-------------------|------------------|
| `timestamp` | `timestamp` (built-in) |
| `request.host` | `$l['request.host']` |
| `response.status` | `$l['response.status']` |
| `cdn.cache_status` | `$l['cdn.cache_status']` |
| `request.headers.x_forwarded_host` | `$l['request.headers.x_forwarded_host']` |

## Usage

### Basic Query

```javascript
import { buildLogsQuery, parseTimeFilterBounds } from './queries/logs.dataprime.js';
import { TIME_RANGES } from './constants.js';

// Parse time range from state
const timeState = {
  timeRange: '1h',
  queryTimestamp: new Date(),
};

const { start, end } = parseTimeFilterBounds(timeState, TIME_RANGES);

// Build query
const query = buildLogsQuery({
  start,
  end,
  pageSize: 100,
});

console.log(query);
// source logs
// | filter $l.subsystemname in ['cloudflare', 'fastly']
// | filter timestamp >= timestamp('2025-02-16T18:00:00.000Z') && timestamp <= timestamp('2025-02-16T19:00:00.000Z')
// | sort timestamp desc
// | limit 100
```

### With Filters

```javascript
const query = buildLogsQuery({
  start: new Date('2025-02-16T18:00:00.000Z'),
  end: new Date('2025-02-16T19:00:00.000Z'),
  hostFilter: 'example.com',
  facetFilters: [
    { col: 'response.status', op: '>=', value: '400' },
    { col: 'cdn.cache_status', op: '=', value: 'MISS' },
    { col: 'request.method', op: 'IN', value: ['GET', 'POST'] },
  ],
  pageSize: 50,
  offset: 100,
});

console.log(query);
// source logs
// | filter $l.subsystemname in ['cloudflare', 'fastly']
// | filter timestamp >= timestamp('2025-02-16T18:00:00.000Z') && timestamp <= timestamp('2025-02-16T19:00:00.000Z')
// | filter ($l['request.host'].includes('example.com') || $l['request.headers.x_forwarded_host'].includes('example.com'))
// | filter $l['response.status'] >= 400 && $l['cdn.cache_status'] == 'MISS' && $l['request.method'] in ['GET', 'POST']
// | sort timestamp desc
// | limit 50 offset 100
```

### With Field Selection (Column Pinning)

```javascript
const query = buildLogsQuery({
  start: new Date('2025-02-16T18:00:00.000Z'),
  end: new Date('2025-02-16T19:00:00.000Z'),
  fields: ['timestamp', 'request.host', 'request.url', 'response.status'],
  pageSize: 100,
});

console.log(query);
// source logs
// | filter $l.subsystemname in ['cloudflare', 'fastly']
// | filter timestamp >= timestamp('2025-02-16T18:00:00.000Z') && timestamp <= timestamp('2025-02-16T19:00:00.000Z')
// | choose timestamp, $l['request.host'] as `request.host`, $l['request.url'] as `request.url`, $l['response.status'] as `response.status`
// | sort timestamp desc
// | limit 100
```

### Pagination (Load More)

```javascript
import { buildLogsMoreQuery } from './queries/logs.dataprime.js';

// First page
const firstPageQuery = buildLogsQuery({
  start,
  end,
  pageSize: 500,
  offset: 0,
});

// Load more (next page)
const nextPageQuery = buildLogsMoreQuery({
  start,
  end,
  pageSize: 500,
  offset: 500,  // Offset increases by pageSize
});
```

## API Reference

### `buildLogsQuery(options)`

Build a complete Data Prime query for the logs view.

**Parameters:**

- `options.start` (Date, required): Start timestamp
- `options.end` (Date, required): End timestamp
- `options.hostFilter` (string, optional): Host filter string
- `options.hostFilterColumn` (string, optional): Specific host column to filter
- `options.facetFilters` (Array, optional): Array of filter objects
  - `col` (string): Column name
  - `op` (string): Operator (=, !=, LIKE, NOT LIKE, >, <, >=, <=, IN)
  - `value` (string|number|Array): Filter value
- `options.additionalWhereClause` (string, optional): Additional filter clause
- `options.fields` (Array<string>, optional): Fields to select (for column pinning)
- `options.pageSize` (number, optional, default: 500): Number of records per page
- `options.offset` (number, optional, default: 0): Pagination offset
- `options.orderBy` (string, optional, default: 'timestamp DESC'): Sort order

**Returns:** String - Complete Data Prime query

### `buildLogsMoreQuery(options)`

Alias for `buildLogsQuery` - used for pagination consistency with ClickHouse implementation.

### `buildTimeFilter({ start, end })`

Build time filter expression.

**Returns:** String - Data Prime time filter

### `buildHostFilter({ hostFilter, hostFilterColumn })`

Build host filter expression.

**Returns:** String - Data Prime host filter or empty string

### `buildFacetFilters(filters)`

Build facet/column filters expression.

**Returns:** String - Data Prime filter expression or empty string

### `buildChooseClause(fields)`

Build field selection clause.

**Returns:** String - Data Prime choose clause or '*'

### `parseTimeFilterBounds(timeState, TIME_RANGES)`

Parse time filter bounds from state/config.

**Parameters:**

- `timeState` (Object): Time state object
  - `queryTimestamp` (Date, optional): Reference timestamp
  - `customTimeRange` (Object, optional): Custom range with start/end
  - `timeRange` (string, optional): Named time range (e.g., '1h', '24h')
- `TIME_RANGES` (Object): Time range definitions

**Returns:** Object - `{ start: Date, end: Date }`

## Filter Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `=` | Equality | `{ col: 'status', op: '=', value: '404' }` |
| `!=` | Not equal | `{ col: 'cache', op: '!=', value: 'HIT' }` |
| `LIKE` | Contains substring | `{ col: 'url', op: 'LIKE', value: '/api/' }` |
| `NOT LIKE` | Does not contain | `{ col: 'url', op: 'NOT LIKE', value: '/admin' }` |
| `>` | Greater than | `{ col: 'status', op: '>', value: '399' }` |
| `<` | Less than | `{ col: 'status', op: '<', value: '500' }` |
| `>=` | Greater or equal | `{ col: 'status', op: '>=', value: '400' }` |
| `<=` | Less or equal | `{ col: 'status', op: '<=', value: '499' }` |
| `IN` | In array | `{ col: 'method', op: 'IN', value: ['GET', 'POST'] }` |

## Data Prime Query Structure

All queries follow this structure:

```
source logs
| filter <subsystem filters>
| filter <time filters>
| filter <host filters>
| filter <facet filters>
| filter <additional filters>
| choose <selected fields>
| sort timestamp desc
| limit <pageSize> offset <offset>
```

Each filter clause is only included if the corresponding option is provided.

## Testing

Run the test suite:

```bash
npm test -- --files 'js/queries/logs.dataprime.test.js'
```

The test suite includes 38 tests covering:
- Time filter building
- Host filter building
- Facet filter building (all operators)
- Field selection
- Complete query building
- Time range parsing
- Query structure validation
- Edge cases (special characters, numeric values, etc.)

## Integration with Existing Code

To integrate with the existing logs view (`js/logs.js`):

1. Import the Data Prime query builder:
   ```javascript
   import { buildLogsQuery, parseTimeFilterBounds } from './queries/logs.dataprime.js';
   ```

2. Replace the SQL query building with Data Prime:
   ```javascript
   // Old (ClickHouse)
   const sql = await loadSql('logs', {
     database: DATABASE,
     table: getTable(),
     timeFilter,
     hostFilter,
     facetFilters,
     additionalWhereClause: state.additionalWhereClause,
     pageSize: String(PAGE_SIZE),
   });

   // New (Data Prime)
   const { start, end } = parseTimeFilterBounds(timeState, TIME_RANGES);
   const dataPrimeQuery = buildLogsQuery({
     start,
     end,
     hostFilter: state.hostFilter,
     hostFilterColumn: state.hostFilterColumn,
     facetFilters: state.filters,
     additionalWhereClause: state.additionalWhereClause,
     pageSize: PAGE_SIZE,
   });
   ```

3. Update the API call to use Coralogix Data Prime API instead of ClickHouse.

## Notes

### String Escaping

Single quotes in filter values are automatically escaped:
```javascript
buildHostFilter({ hostFilter: "test's-site.com" })
// Returns: $l.request.host.includes('test\'s-site.com')
```

### Field Names with Dots

Dotted field names use bracket notation in Data Prime:
```javascript
$l['request.host']       // ClickHouse: request.host
$l['response.status']    // ClickHouse: response.status
```

### Timestamp Field

The `timestamp` field is a built-in Data Prime field and doesn't need the `$l` prefix:
```javascript
timestamp  // No $l prefix needed
```

### Empty Filters

Empty filter arrays are handled gracefully:
```javascript
buildFacetFilters([])  // Returns: ''
buildFacetFilters(null)  // Returns: ''
```

## Performance Considerations

- **Subsystem filtering** is applied first to reduce the dataset
- **Time filtering** is applied early to leverage time-based indexing
- **Field selection** reduces data transfer when specific fields are requested
- **Pagination** with offset/limit prevents loading excessive data

## Migration Checklist

- [x] Time filter support
- [x] Host filter support (single or dual column)
- [x] Facet filter support (all operators)
- [x] Field selection (column pinning)
- [x] Sorting (timestamp DESC/ASC)
- [x] Pagination (offset/limit)
- [x] Additional WHERE clause support
- [x] String escaping
- [x] Subsystem filtering (Cloudflare/Fastly)
- [x] Comprehensive test coverage (38 tests)
- [x] Documentation and examples

## Future Enhancements

Potential improvements for future iterations:

1. **Query optimization**: Analyze Data Prime query plans and optimize filter ordering
2. **Aggregation support**: Add groupBy/aggregate capabilities for facet queries
3. **Error handling**: Add query validation and error messages
4. **Query caching**: Implement query result caching similar to ClickHouse implementation
5. **Performance metrics**: Track query execution time and optimize slow queries

## License

Copyright 2025 Adobe. Licensed under the Apache License, Version 2.0.
