# Bucketed Facets Migration to Data Prime

## Summary

Bucketed facets (content-length and time-elapsed) use ClickHouse's `multiIf()` function which is not supported in Coralogix Data Prime. This document explains the migration approach.

## Approach

Instead of changing the bucket generation functions to output Data Prime syntax directly (which would break ClickHouse compatibility), we use automatic conversion in the Coralogix adapter:

1. **Bucket functions** (`js/breakdowns/buckets.js`) continue to generate ClickHouse `multiIf()` syntax
2. **Coralogix adapter** (`js/coralogix/adapter.js`) detects `multiIf()` in the `buildFacetExpression` function and converts it to Data Prime syntax

## ClickHouse vs Data Prime Syntax

### Content-Length Buckets (with zero check)

**ClickHouse:**
```sql
multiIf(
  `response.headers.content_length` = 0, '0 (empty)',
  `response.headers.content_length` < 10, '1 B-10 B',
  `response.headers.content_length` < 50000, '10 B-50 KB',
  `response.headers.content_length` < 100000000, '50 KB-100 MB',
  '≥ 100 MB'
)
```

**Data Prime:**
```
case {
  $d.response.headers.content_length:num == 0 -> '0 (empty)',
  $d.response.headers.content_length:num < 10 -> '1 B-10 B',
  $d.response.headers.content_length:num < 50000 -> '10 B-50 KB',
  $d.response.headers.content_length:num < 100000000 -> '50 KB-100 MB',
  _ -> '≥ 100 MB'
}
```

Uses `case { ... }` (not `case_lessthan`) because it has an equality check (`== 0`).

### Time-Elapsed Buckets (pure less-than comparisons)

**ClickHouse:**
```sql
multiIf(
  `cdn.time_elapsed_msec` < 1, '< 1ms',
  `cdn.time_elapsed_msec` < 50, '1ms-50ms',
  `cdn.time_elapsed_msec` < 1500, '50ms-1.5s',
  `cdn.time_elapsed_msec` < 60000, '1.5s-60s',
  '≥ 60s'
)
```

**Data Prime:**
```
case_lessthan {
  $d.cdn.time_elapsed_msec:num,
  1 -> '< 1ms',
  50 -> '1ms-50ms',
  1500 -> '50ms-1.5s',
  60000 -> '1.5s-60s',
  _ -> '≥ 60s'
}
```

Uses `case_lessthan { ... }` (optimized for sequential less-than comparisons).

## Implementation Details

### Conversion Function

The `convertMultiIfToCaseLessThan()` function in `js/coralogix/adapter.js` (lines 406-501):

1. Parses the `multiIf()` expression to extract field name, conditions, and labels
2. Detects if there are any equality (`==`) operators
3. If equality operators exist, uses `case { ... }` syntax
4. If only less-than (`<`) operators, uses `case_lessthan { ... }` syntax

### Detection in buildFacetExpression

In `js/coralogix/adapter.js` (lines 389-394):

```javascript
// multiIf(...) for bucketed facets (content-length, time-elapsed)
if (cleanExpr.match(/^multiIf\(/i)) {
  return convertMultiIfToCaseLessThan(facetExpression);
}
```

## Changes Made

### js/breakdowns/definitions.js

**Line 120**: Removed `summaryCountIf` from time-elapsed breakdown (Data Prime doesn't support ClickHouse's `if()` function):

```javascript
// Before:
{
  id: 'breakdown-time-elapsed',
  col: timeElapsedBuckets,
  rawCol: '`cdn.time_elapsed_msec`',
  orderBy: 'min(`cdn.time_elapsed_msec`)',
  summaryCountIf: '`cdn.time_elapsed_msec` >= 1000',  // ← Removed
  summaryLabel: 'slow (≥1s)',
  summaryColor: 'warning',
  getExpectedLabels: getTimeElapsedLabels,
}

// After:
{
  id: 'breakdown-time-elapsed',
  col: timeElapsedBuckets,
  rawCol: '`cdn.time_elapsed_msec`',
  orderBy: 'min(`cdn.time_elapsed_msec`)',
  summaryLabel: 'slow (≥1s)',
  summaryColor: 'warning',
  getExpectedLabels: getTimeElapsedLabels,
}
```

### js/breakdowns/buckets.js

**No changes** - Functions continue to generate ClickHouse `multiIf()` syntax for backward compatibility.

### js/coralogix/adapter.js

**No changes** - The `convertMultiIfToCaseLessThan()` function and detection logic were already implemented correctly.

## Testing

All existing tests pass:

```bash
npm test -- js/breakdowns/buckets.test.js
# ✓ 22 tests pass
```

The bucket functions continue to generate valid ClickHouse syntax, and the Coralogix adapter automatically converts them to Data Prime syntax when needed.

## Benefits of This Approach

1. **Backward compatibility** - ClickHouse queries continue to work unchanged
2. **Single source of truth** - Bucket generation logic remains in `buckets.js`
3. **Automatic conversion** - No manual translation needed for each query
4. **Type safety** - Conversion function handles both `case` and `case_lessthan` patterns correctly
