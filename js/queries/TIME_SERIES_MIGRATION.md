# Time-Series Query Migration to Data Prime

This document explains the migration of time-series queries from ClickHouse SQL to Coralogix Data Prime.

## Overview

Time-series queries generate bucketed aggregations over time with HTTP status code grouping. They power the main chart view in the dashboard, showing:
- Total requests per time bucket
- OK requests (status < 400)
- 4xx errors (status 400-499)
- 5xx errors (status >= 500)

## File Location

**New Data Prime Query Builder:**
- `/Users/yoni/klickhaus/js/queries/time-series.dataprime.js`
- `/Users/yoni/klickhaus/js/queries/time-series.dataprime.test.js` (96.41% code coverage)

## ClickHouse SQL → Data Prime Mapping

### Original ClickHouse Query

```sql
SELECT
  toStartOfMinute(timestamp) as t,
  countIf(`response.status` < 400) as cnt_ok,
  countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
  countIf(`response.status` >= 500) as cnt_5xx
FROM cdn_requests_v2
WHERE timestamp >= X AND timestamp <= Y
  AND (`request.host` LIKE '%example%' OR `x_forwarded_host` LIKE '%example%')
GROUP BY t
ORDER BY t WITH FILL FROM rangeStart TO rangeEnd STEP step
```

### Data Prime Equivalent

```
source logs
| filter $l.subsystemname in ['cloudflare', 'fastly']
| filter timestamp >= timestamp('2025-02-16T18:00:00.000Z') && timestamp <= timestamp('2025-02-16T19:00:00.000Z')
| filter ($d.request.host.includes('example') || $d.request.headers.x_forwarded_host.includes('example'))
| create status_ok = $d.response.status < 400 ? 1 : 0
| create status_4xx = ($d.response.status >= 400 && $d.response.status < 500) ? 1 : 0
| create status_5xx = $d.response.status >= 500 ? 1 : 0
| groupby timestamp.bucket(1m) as t aggregate
    sum(status_ok) as cnt_ok,
    sum(status_4xx) as cnt_4xx,
    sum(status_5xx) as cnt_5xx
| sort t asc
```

## Key Syntax Differences

| Feature | ClickHouse SQL | Data Prime |
|---------|----------------|------------|
| **Conditional counting** | `countIf(condition)` | `create indicator = condition ? 1 : 0` + `sum(indicator)` |
| **Time bucketing** | `toStartOfMinute(timestamp)` | `timestamp.bucket(1m)` |
| **Time filtering** | `timestamp >= X AND timestamp <= Y` | `timestamp >= timestamp('ISO') && timestamp <= timestamp('ISO')` |
| **String matching** | `LIKE '%pattern%'` | `.includes('pattern')` |
| **Logical AND** | `AND` | `&&` |
| **Logical OR** | `OR` | `\|\|` |
| **Source filter** | `FROM cdn_requests_v2` | `source logs \| filter $l.subsystemname in ['cloudflare', 'fastly']` |
| **Fill gaps** | `WITH FILL FROM X TO Y STEP Z` | Not needed (Data Prime fills automatically) |

## Bucket Interval Mapping

The `convertBucketInterval()` function maps ClickHouse bucket expressions to Data Prime intervals:

| ClickHouse Expression | Data Prime Interval |
|----------------------|-------------------|
| `toStartOfInterval(timestamp, INTERVAL 5 SECOND)` | `5s` |
| `toStartOfInterval(timestamp, INTERVAL 10 SECOND)` | `10s` |
| `toStartOfMinute(timestamp)` | `1m` |
| `toStartOfFiveMinutes(timestamp)` | `5m` |
| `toStartOfTenMinutes(timestamp)` | `10m` |
| `toStartOfInterval(timestamp, INTERVAL 1 HOUR)` | `1h` |

## Time Range Support

The query builder supports all standard time ranges from `constants.js`:

| Range | Bucket Size | ClickHouse Expression | Data Prime Interval |
|-------|-------------|----------------------|-------------------|
| **15m** | 5 seconds | `toStartOfInterval(timestamp, INTERVAL 5 SECOND)` | `5s` |
| **1h** | 10 seconds | `toStartOfInterval(timestamp, INTERVAL 10 SECOND)` | `10s` |
| **12h** | 1 minute | `toStartOfMinute(timestamp)` | `1m` |
| **24h** | 5 minutes | `toStartOfFiveMinutes(timestamp)` | `5m` |
| **7d** | 10 minutes | `toStartOfTenMinutes(timestamp)` | `10m` |

## Usage Examples

### Basic Time-Series Query

```javascript
import { buildTimeSeriesQuery } from './queries/time-series.dataprime.js';
import { TIME_RANGES } from './constants.js';

const query = buildTimeSeriesQuery({
  start: new Date('2025-02-16T18:00:00Z'),
  end: new Date('2025-02-16T19:00:00Z'),
  bucket: TIME_RANGES['1h'].bucket, // "toStartOfInterval(timestamp, INTERVAL 10 SECOND)"
});

// Generates:
// source logs
// | filter $l.subsystemname in ['cloudflare', 'fastly']
// | filter timestamp >= timestamp('2025-02-16T18:00:00.000Z') && timestamp <= timestamp('2025-02-16T19:00:00.000Z')
// | create status_ok = $d.response.status < 400 ? 1 : 0
// | create status_4xx = ($d.response.status >= 400 && $d.response.status < 500) ? 1 : 0
// | create status_5xx = $d.response.status >= 500 ? 1 : 0
// | groupby timestamp.bucket(10s) as t aggregate
//     sum(status_ok) as cnt_ok,
//     sum(status_4xx) as cnt_4xx,
//     sum(status_5xx) as cnt_5xx
// | sort t asc
```

### With Host Filter

```javascript
const query = buildTimeSeriesQuery({
  start: new Date('2025-02-16T18:00:00Z'),
  end: new Date('2025-02-16T19:00:00Z'),
  bucket: 'toStartOfMinute(timestamp)',
  hostFilter: 'example.com',
});

// Adds filter:
// | filter ($d.request.host.includes('example.com') || $d.request.headers.x_forwarded_host.includes('example.com'))
```

### With Facet Filters

```javascript
const query = buildTimeSeriesQuery({
  start: new Date('2025-02-16T18:00:00Z'),
  end: new Date('2025-02-16T19:00:00Z'),
  bucket: 'toStartOfMinute(timestamp)',
  facetFilters: [
    { col: 'cdn.cache_status', op: '=', value: 'MISS' },
    { col: 'response.status', op: '>=', value: '500' },
  ],
});

// Adds filters:
// | filter $d.cdn.cache_status == 'MISS' && $d.response.status >= 500
```

### With Sampling (for long time ranges)

```javascript
const query = buildTimeSeriesQuery({
  start: new Date('2025-02-09T00:00:00Z'),
  end: new Date('2025-02-16T00:00:00Z'),
  bucket: 'toStartOfTenMinutes(timestamp)',
  samplingRate: 0.25,
  multiplier: true,
});

// Applies 4x multiplier to counts:
// | groupby timestamp.bucket(10m) as t aggregate
//     sum(status_ok) * 4 as cnt_ok,
//     sum(status_4xx) * 4 as cnt_4xx,
//     sum(status_5xx) * 4 as cnt_5xx
// | sort t asc
```

## API Reference

### `buildTimeSeriesQuery(options)`

Builds a complete Data Prime time-series query.

**Parameters:**
- `options.start` (Date): Start timestamp
- `options.end` (Date): End timestamp
- `options.bucket` (string): ClickHouse bucket expression (e.g., `"toStartOfMinute(timestamp)"`)
- `options.hostFilter` (string, optional): Host filter string
- `options.facetFilters` (Array, optional): Facet filters `[{col, op, value}]`
- `options.additionalWhereClause` (string, optional): Additional filter in Data Prime syntax
- `options.samplingRate` (number, optional): Sampling rate (0-1) for optimization
- `options.multiplier` (boolean, optional): Whether to apply sampling multiplier to counts

**Returns:** String (Data Prime query)

### `buildQuery(params)`

Convenience wrapper that matches ClickHouse query builder signature.

**Parameters:**
- `params.start` (Date): Start timestamp
- `params.end` (Date): End timestamp
- `params.bucket` (string): ClickHouse bucket expression
- `params.hostFilter` (string, optional): Host filter string
- `params.facetFilters` (Array, optional): Facet filters
- `params.additionalWhereClause` (string, optional): Additional filter
- `params.sampling` (Object, optional): `{ rate, multiplier }`

**Returns:** String (Data Prime query)

## Supported Filter Operators

| Operator | Example | Data Prime Output |
|----------|---------|-------------------|
| `=` | `{ col: 'source', op: '=', value: 'cloudflare' }` | `$l.subsystemname == 'cloudflare'` |
| `!=` | `{ col: 'cdn.cache_status', op: '!=', value: 'HIT' }` | `$d.cdn.cache_status != 'HIT'` |
| `>` | `{ col: 'response.status', op: '>', value: '399' }` | `$d.response.status > 399` |
| `<` | `{ col: 'response.status', op: '<', value: '500' }` | `$d.response.status < 500` |
| `>=` | `{ col: 'response.status', op: '>=', value: '400' }` | `$d.response.status >= 400` |
| `<=` | `{ col: 'response.status', op: '<=', value: '499' }` | `$d.response.status <= 499` |
| `LIKE` | `{ col: 'request.url', op: 'LIKE', value: '/api/' }` | `$d.request.url.includes('/api/')` |
| `NOT LIKE` | `{ col: 'request.url', op: 'NOT LIKE', value: '/static/' }` | `!$d.request.url.includes('/static/')` |
| `IN` | `{ col: 'cdn.cache_status', op: 'IN', value: ['HIT', 'MISS'] }` | `$d.cdn.cache_status in ['HIT', 'MISS']` |

## Data Structure Output

The query returns an array of time buckets with status counts:

```javascript
[
  {
    t: "2025-02-16T18:00:00.000Z",  // Timestamp of bucket
    cnt_ok: 12450,                   // Requests with status < 400
    cnt_4xx: 234,                    // Requests with status 400-499
    cnt_5xx: 12                      // Requests with status >= 500
  },
  {
    t: "2025-02-16T18:01:00.000Z",
    cnt_ok: 11987,
    cnt_4xx: 189,
    cnt_5xx: 8
  },
  // ...
]
```

## Pattern: CountIf → Create + Sum

Data Prime doesn't have a `countIf()` function like ClickHouse. Instead, we use the **indicator variable pattern**:

**ClickHouse approach:**
```sql
countIf(`response.status` < 400) as cnt_ok
```

**Data Prime approach:**
```
| create status_ok = $d.response.status < 400 ? 1 : 0
| groupby ... aggregate sum(status_ok) as cnt_ok
```

This pattern:
1. Creates an indicator field (0 or 1) based on the condition
2. Sums the indicator in the aggregation

The result is mathematically equivalent to `countIf()`.

## Integration Points

### Chart Loading (`js/chart.js`)

The existing chart code loads time-series queries via `loadSql()`:

```javascript
const timeSeriesTemplate = state.timeSeriesTemplate || 'time-series';
const sql = await loadSql(timeSeriesTemplate, {
  bucket,
  database: DATABASE,
  table: getTable(),
  // ...
});
```

To use Data Prime queries, you can either:

1. **Replace the SQL template** with Data Prime query builder:
   ```javascript
   import { buildTimeSeriesQuery } from './queries/time-series.dataprime.js';

   const query = buildTimeSeriesQuery({
     start: getTimeRangeStart(),
     end: getTimeRangeEnd(),
     bucket: getTimeBucket(),
     hostFilter: getHostFilter(),
     facetFilters: getFacetFilters(),
   });
   ```

2. **Use the Coralogix adapter** (higher-level integration):
   ```javascript
   import { fetchTimeSeriesData } from './coralogix/adapter.js';

   const data = await fetchTimeSeriesData({
     timeRange: state.timeRange,
     interval: getTimeBucket(),
     filters: getFacetFilters(),
     hostFilter: getHostFilter(),
     signal: abortController.signal,
   });
   ```

## Testing

Run tests with:

```bash
npm test -- --files 'js/queries/time-series.dataprime.test.js'
```

**Coverage:** 96.41%

All 20 tests passing, covering:
- Basic query structure
- Bucket interval conversion (5s, 10s, 1m, 5m, 10m, 1h)
- Host filtering
- Facet filtering
- Additional WHERE clauses
- Sampling and multipliers
- Filter operators
- Time range boundaries
- Output data structure
- String escaping

## Migration Checklist

- [x] Create Data Prime query builder (`time-series.dataprime.js`)
- [x] Add comprehensive test coverage (`time-series.dataprime.test.js`)
- [x] Document ClickHouse → Data Prime mapping
- [x] Support all time ranges (15m, 1h, 12h, 24h, 7d)
- [x] Support status code grouping (ok, 4xx, 5xx)
- [x] Support host filtering
- [x] Support facet filtering
- [x] Support additional WHERE clauses
- [x] Support sampling for long ranges
- [ ] Integrate with Coralogix adapter
- [ ] Update chart.js to use Data Prime queries (when enabled)
- [ ] Add feature flag for Data Prime backend
- [ ] Performance testing vs ClickHouse
- [ ] Production deployment

## Related Files

- `/Users/yoni/klickhaus/js/queries/time-series.dataprime.js` - New Data Prime query builder
- `/Users/yoni/klickhaus/js/queries/time-series.dataprime.test.js` - Test suite
- `/Users/yoni/klickhaus/js/queries/breakdown.dataprime.js` - Breakdown queries (facet aggregations)
- `/Users/yoni/klickhaus/js/queries/logs.dataprime.js` - Logs view queries (raw log entries)
- `/Users/yoni/klickhaus/js/queries/DATAPRIME_MIGRATION.md` - Breakdown query migration guide
- `/Users/yoni/klickhaus/js/coralogix/adapter.js` - Coralogix integration adapter
- `/Users/yoni/klickhaus/js/coralogix/query-builder.js` - Generic Data Prime query builder
- `/Users/yoni/klickhaus/sql/queries/time-series.sql` - Original ClickHouse SQL template
- `/Users/yoni/klickhaus/js/chart.js` - Chart rendering and data loading
- `/Users/yoni/klickhaus/js/time.js` - Time range utilities
- `/Users/yoni/klickhaus/js/constants.js` - Time range definitions

## Next Steps

1. **Integration**: Wire up the Data Prime query builder to the chart loading code
2. **Feature flag**: Add a config option to switch between ClickHouse and Coralogix backends
3. **Adapter enhancement**: Update `coralogix/adapter.js` to use the new query builder
4. **Performance testing**: Compare query performance between ClickHouse and Data Prime
5. **Gradual rollout**: Deploy behind a feature flag for selective testing
