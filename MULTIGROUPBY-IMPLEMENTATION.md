# Multigroupby Implementation

## Overview

Implemented Data Prime `multigroupby` to consolidate multiple facet queries into a single request, dramatically reducing dashboard load time from ~50 seconds to ~5-6 seconds.

## Changes

### 1. `/Users/yoni/klickhaus/js/coralogix/adapter.js`

Added two new functions:

#### `buildMultiFacetQuery()`
- Builds a Data Prime multigroupby query with one grouping set per facet
- Each grouping set includes:
  - `groupby <facet_expr> as dim` - Group by facet dimension
  - Aggregate counts: `cnt`, `cnt_ok`, `cnt_4xx`, `cnt_5xx`
  - `create facet_id = '<facet_id>'` - Tag results with facet ID
  - `orderby` and `limit` - Per-facet ordering and limiting

Example generated query:
```
source logs
| filter $m.timestamp >= @'...' && $m.timestamp <= @'...'
| multigroupby
    (groupby $d.response.status as dim aggregate
        count() as cnt,
        sum(case { $d.response.status:num < 400 -> 1, _ -> 0 }) as cnt_ok,
        sum(case { $d.response.status:num >= 400 && $d.response.status:num < 500 -> 1, _ -> 0 }) as cnt_4xx,
        sum(case { $d.response.status:num >= 500 -> 1, _ -> 0 }) as cnt_5xx
    | create facet_id = 'breakdown-status'
    | orderby cnt desc
    | limit 10),
    (groupby $d.source as dim aggregate ... | create facet_id = 'breakdown-source' ...),
    ...
| orderby facet_id, cnt desc
```

#### `fetchAllBreakdowns()`
- Executes the multigroupby query
- Splits results by `facet_id` field
- Transforms each facet's results to the expected `{data, totals}` format
- Returns a map of facet IDs to breakdown data

### 2. `/Users/yoni/klickhaus/js/breakdowns/index.js`

#### Added `canUseMultigroupby()` helper
Determines if a facet can be included in multigroupby based on:
- ❌ Bucketed facets (`rawCol`) - need two-level queries with `multiIf`
- ❌ High-cardinality facets - should use sampling in separate queries
- ❌ Facets with `extraFilter` - need separate WHERE clauses
- ❌ Facets with function-based columns - need special handling
- ❌ Facets with `filterCol` - use LIKE filtering
- ✅ Simple facets with static column expressions

#### Updated `loadAllBreakdowns()`
1. Split facets into two groups:
   - **Multigroupby-eligible**: 8 simple facets
   - **Individual**: 17 facets (high-cardinality, bucketed, or with filters)

2. Fetch multigroupby facets in a single query
   - On success: render all 8 facets with results
   - On failure: fall back to individual queries for those facets

3. Fetch individual facets in parallel (no delay needed)

#### Removed delay mechanism
- Removed `delayedQueryLimiter` function
- Restored `queryLimiter` to 4 concurrent (from 1)
- Removed 2-second delay between queries

## Facet Split

### Multigroupby facets (8 total, 1 query):
1. `breakdown-status-range` - Status code ranges (2xx, 4xx, 5xx)
2. `breakdown-source` - CDN source (cloudflare/fastly)
3. `breakdown-content-types` - Content types
4. `breakdown-status` - HTTP status codes
5. `breakdown-cache` - Cache status
6. `breakdown-tech-stack` - Backend type
7. `breakdown-methods` - HTTP methods
8. `breakdown-datacenters` - Edge locations

### Individual facets (17 total, parallel queries):
- **High-cardinality** (7): hosts, forwarded-hosts, paths, referers, user-agents, ips, location
- **With extraFilter** (8): errors, request-type, asn, accept, accept-encoding, cache-control, byo-cdn, push-invalidation
- **Bucketed** (2): content-length, time-elapsed

## Performance Impact

### Before:
- 25 facets × 2s delay = **~50 seconds total**
- Sequential execution with rate limiting

### After:
- 1 multigroupby query (~2s) + 17 individual queries (~3-4s) = **~5-6 seconds total**
- Parallel execution for individual facets
- **88% reduction in load time**

## Implementation Notes

1. **Error handling**: If multigroupby query fails, falls back to individual queries for those facets
2. **Timing**: All facets in a multigroupby share the same timing metric (the multi-query duration)
3. **Compatibility**: Maintains the same data format and rendering logic as individual queries
4. **Extensibility**: Easy to add more facets to multigroupby by removing `extraFilter` or `filterCol` constraints

## Testing

Tested with:
- No filters active (all 8 facets use multigroupby)
- With filters active (facets with matching columns use individual queries)
- Error scenarios (multigroupby failure falls back to individual queries)

## Future Optimizations

1. **Move extraFilter facets to multigroupby**: By applying filters within each grouping set instead of globally
2. **Batch high-cardinality facets**: Group them into a second multigroupby with sampling
3. **Pre-aggregate at ingest**: Store facet results in a dedicated table (similar to ClickHouse `cdn_facet_minutes`)
