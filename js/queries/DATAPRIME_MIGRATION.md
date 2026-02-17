# Data Prime Breakdown Query Migration

This document shows the mapping from ClickHouse SQL breakdown queries to Coralogix Data Prime queries.

## Overview

The breakdown queries analyze CDN request logs across different facets (dimensions) with status code aggregations. Each query:

1. Groups by a dimension (host, status, cache status, etc.)
2. Aggregates counts by HTTP status ranges (total, ok, 4xx, 5xx)
3. Orders by total count descending
4. Limits to top N results

## Syntax Comparison

| Feature | ClickHouse SQL | Data Prime |
|---------|----------------|------------|
| **Data source** | `FROM cdn_requests_v2` | `source logs` |
| **Column reference** | `` `response.status` `` | `$d.response.status` |
| **Metadata fields** | N/A | `$l.subsystemname`, `$m.timestamp` |
| **Filter** | `WHERE condition` | `\| filter condition` |
| **Grouping** | `GROUP BY dim` | `\| groupby expr as dim` |
| **Aggregation** | `count()`, `countIf()` | `count()`, `count(condition)` |
| **Conditional count** | `countIf(status >= 400)` | `count(status >= 400)` |
| **Sorting** | `ORDER BY cnt DESC` | `\| sort cnt desc` |
| **Limiting** | `LIMIT 10` | `\| limit 10` |
| **String ops** | `concat()`, `toString()` | `strcat()`, `tostring()` |
| **Case conversion** | `upper()` | `toupper()` |
| **Integer division** | `intDiv()` | `todecimal()` |
| **Regex replace** | `REGEXP_REPLACE()` | `replace_regex()` |
| **Logical AND** | `AND` | `&&` |
| **Logical OR** | `OR` | `\|\|` |
| **String matching** | `LIKE '%pattern%'` | `matches '.*pattern.*'` |
| **Ternary operator** | `if(cond, a, b)` | `cond ? a : b` |

## Field Mapping

| ClickHouse Column | Data Prime Field | Notes |
|-------------------|------------------|-------|
| `` `timestamp` `` | `$m.timestamp` | Metadata field |
| `` `source` `` | `$l.subsystemname` | 'cloudflare' or 'fastly' |
| `` `response.status` `` | `$d.response.status` | HTTP status code |
| `` `response.headers.content_type` `` | `$d.response.headers.content_type` | Content-Type header |
| `` `response.headers.x_error` `` | `$d.response.headers.x_error` | Error message |
| `` `response.headers.location` `` | `$d.response.headers.location` | Redirect location |
| `` `response.headers.content_length` `` | `$d.response.headers.content_length` | Response size |
| `` `request.host` `` | `$d.request.host` | Hostname |
| `` `request.url` `` | `$d.request.url` | Request path |
| `` `request.method` `` | `$d.request.method` | HTTP method |
| `` `request.headers.x_forwarded_host` `` | `$d.request.headers.x_forwarded_host` | Origin hostname |
| `` `request.headers.referer` `` | `$d.request.headers.referer` | Referrer URL |
| `` `request.headers.user_agent` `` | `$d.request.headers.user_agent` | User-Agent string |
| `` `request.headers.accept` `` | `$d.request.headers.accept` | Accept header |
| `` `request.headers.accept_encoding` `` | `$d.request.headers.accept_encoding` | Accept-Encoding |
| `` `request.headers.cache_control` `` | `$d.request.headers.cache_control` | Cache-Control |
| `` `request.headers.x_byo_cdn_type` `` | `$d.request.headers.x_byo_cdn_type` | BYO CDN type |
| `` `request.headers.x_forwarded_for` `` | `$d.request.headers.x_forwarded_for` | Real client IP |
| `` `cdn.cache_status` `` | `$d.cdn.cache_status` | Cache hit/miss status |
| `` `cdn.datacenter` `` | `$d.cdn.datacenter` | Edge location |
| `` `cdn.time_elapsed_msec` `` | `$d.cdn.time_elapsed_msec` | Response time (ms) |
| `` `client.ip` `` | `$d.client.ip` | Client IP address |
| `` `client.asn` `` | `$d.client.asn` | Autonomous System Number |
| `` `helix.request_type` `` | `$d.helix.request_type` | Request type (static, pipeline, etc.) |
| `` `helix.backend_type` `` | `$d.helix.backend_type` | Backend (cloudflare, aws) |

## Facet Query Examples

### 1. Status Range Breakdown

**ClickHouse:**
```sql
SELECT
  concat(toString(intDiv(`response.status`, 100)), 'xx') as dim,
  count() as cnt,
  countIf(`response.status` < 400) as cnt_ok,
  countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
  countIf(`response.status` >= 500) as cnt_5xx
FROM cdn_requests_v2
WHERE timestamp >= now() - INTERVAL 1 HOUR
  AND timestamp <= now()
GROUP BY dim
ORDER BY cnt DESC
LIMIT 10
```

**Data Prime:**
```
source logs
| filter $l.subsystemname in ['cloudflare', 'fastly'] && $m.timestamp >= now() - 1h
| groupby strcat(tostring(todecimal($d.response.status / 100)), 'xx') as dim aggregate
    count() as cnt,
    count($d.response.status < 400) as cnt_ok,
    count($d.response.status >= 400 && $d.response.status < 500) as cnt_4xx,
    count($d.response.status >= 500) as cnt_5xx
| sort cnt desc
| limit 10
```

### 2. Source (CDN) Breakdown

**ClickHouse:**
```sql
SELECT
  `source` as dim,
  count() as cnt,
  countIf(`response.status` < 400) as cnt_ok,
  countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
  countIf(`response.status` >= 500) as cnt_5xx
FROM cdn_requests_v2
WHERE timestamp >= now() - INTERVAL 1 HOUR
GROUP BY dim
ORDER BY cnt DESC
LIMIT 10
```

**Data Prime:**
```
source logs
| filter $l.subsystemname in ['cloudflare', 'fastly']
| groupby $l.subsystemname as dim aggregate
    count() as cnt,
    count($d.response.status < 400) as cnt_ok,
    count($d.response.status >= 400 && $d.response.status < 500) as cnt_4xx,
    count($d.response.status >= 500) as cnt_5xx
| sort cnt desc
| limit 10
```

### 3. Host Breakdown

**ClickHouse:**
```sql
SELECT
  `request.host` as dim,
  count() as cnt,
  countIf(`response.status` < 400) as cnt_ok,
  countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
  countIf(`response.status` >= 500) as cnt_5xx
FROM cdn_requests_v2
WHERE timestamp >= now() - INTERVAL 24 HOUR
GROUP BY dim
ORDER BY cnt DESC
LIMIT 20
```

**Data Prime:**
```
source logs
| filter $l.subsystemname in ['cloudflare', 'fastly']
| groupby $d.request.host as dim aggregate
    count() as cnt,
    count($d.response.status < 400) as cnt_ok,
    count($d.response.status >= 400 && $d.response.status < 500) as cnt_4xx,
    count($d.response.status >= 500) as cnt_5xx
| sort cnt desc
| limit 20
```

### 4. Content Type Breakdown

**ClickHouse:**
```sql
SELECT
  `response.headers.content_type` as dim,
  count() as cnt,
  countIf(`response.status` < 400) as cnt_ok,
  countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
  countIf(`response.status` >= 500) as cnt_5xx
FROM cdn_requests_v2
WHERE timestamp >= now() - INTERVAL 1 HOUR
GROUP BY dim
ORDER BY cnt DESC
LIMIT 10
```

**Data Prime:**
```
source logs
| filter $l.subsystemname in ['cloudflare', 'fastly']
| groupby $d.response.headers.content_type as dim aggregate
    count() as cnt,
    count($d.response.status < 400) as cnt_ok,
    count($d.response.status >= 400 && $d.response.status < 500) as cnt_4xx,
    count($d.response.status >= 500) as cnt_5xx
| sort cnt desc
| limit 10
```

### 5. Cache Status Breakdown

**ClickHouse:**
```sql
SELECT
  upper(`cdn.cache_status`) as dim,
  count() as cnt,
  countIf(`response.status` < 400) as cnt_ok,
  countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
  countIf(`response.status` >= 500) as cnt_5xx
FROM cdn_requests_v2
WHERE timestamp >= now() - INTERVAL 1 HOUR
GROUP BY dim
ORDER BY cnt DESC
LIMIT 10
```

**Data Prime:**
```
source logs
| filter $l.subsystemname in ['cloudflare', 'fastly']
| groupby toupper($d.cdn.cache_status) as dim aggregate
    count() as cnt,
    count($d.response.status < 400) as cnt_ok,
    count($d.response.status >= 400 && $d.response.status < 500) as cnt_4xx,
    count($d.response.status >= 500) as cnt_5xx
| sort cnt desc
| limit 10
```

### 6. Status Code Breakdown

**ClickHouse:**
```sql
SELECT
  toString(`response.status`) as dim,
  count() as cnt,
  countIf(`response.status` < 400) as cnt_ok,
  countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
  countIf(`response.status` >= 500) as cnt_5xx
FROM cdn_requests_v2
WHERE timestamp >= now() - INTERVAL 1 HOUR
GROUP BY dim
ORDER BY cnt DESC
LIMIT 10
```

**Data Prime:**
```
source logs
| filter $l.subsystemname in ['cloudflare', 'fastly']
| groupby tostring($d.response.status) as dim aggregate
    count() as cnt,
    count($d.response.status < 400) as cnt_ok,
    count($d.response.status >= 400 && $d.response.status < 500) as cnt_4xx,
    count($d.response.status >= 500) as cnt_5xx
| sort cnt desc
| limit 10
```

### 7. Request Type Breakdown

**ClickHouse:**
```sql
SELECT
  `helix.request_type` as dim,
  count() as cnt,
  countIf(`response.status` < 400) as cnt_ok,
  countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
  countIf(`response.status` >= 500) as cnt_5xx
FROM cdn_requests_v2
WHERE timestamp >= now() - INTERVAL 1 HOUR
  AND `helix.request_type` != ''
GROUP BY dim
ORDER BY cnt DESC
LIMIT 10
```

**Data Prime:**
```
source logs
| filter $l.subsystemname in ['cloudflare', 'fastly'] && $d.helix.request_type != ""
| groupby $d.helix.request_type as dim aggregate
    count() as cnt,
    count($d.response.status < 400) as cnt_ok,
    count($d.response.status >= 400 && $d.response.status < 500) as cnt_4xx,
    count($d.response.status >= 500) as cnt_5xx
| sort cnt desc
| limit 10
```

### 8. Backend Type Breakdown

**ClickHouse:**
```sql
SELECT
  `helix.backend_type` as dim,
  count() as cnt,
  countIf(`response.status` < 400) as cnt_ok,
  countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
  countIf(`response.status` >= 500) as cnt_5xx
FROM cdn_requests_v2
WHERE timestamp >= now() - INTERVAL 1 HOUR
GROUP BY dim
ORDER BY cnt DESC
LIMIT 10
```

**Data Prime:**
```
source logs
| filter $l.subsystemname in ['cloudflare', 'fastly']
| groupby $d.helix.backend_type as dim aggregate
    count() as cnt,
    count($d.response.status < 400) as cnt_ok,
    count($d.response.status >= 400 && $d.response.status < 500) as cnt_4xx,
    count($d.response.status >= 500) as cnt_5xx
| sort cnt desc
| limit 10
```

### 9. HTTP Method Breakdown

**ClickHouse:**
```sql
SELECT
  `request.method` as dim,
  count() as cnt,
  countIf(`response.status` < 400) as cnt_ok,
  countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
  countIf(`response.status` >= 500) as cnt_5xx
FROM cdn_requests_v2
WHERE timestamp >= now() - INTERVAL 1 HOUR
GROUP BY dim
ORDER BY cnt DESC
LIMIT 10
```

**Data Prime:**
```
source logs
| filter $l.subsystemname in ['cloudflare', 'fastly']
| groupby $d.request.method as dim aggregate
    count() as cnt,
    count($d.response.status < 400) as cnt_ok,
    count($d.response.status >= 400 && $d.response.status < 500) as cnt_4xx,
    count($d.response.status >= 500) as cnt_5xx
| sort cnt desc
| limit 10
```

### 10. Datacenter Breakdown

**ClickHouse:**
```sql
SELECT
  `cdn.datacenter` as dim,
  count() as cnt,
  countIf(`response.status` < 400) as cnt_ok,
  countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
  countIf(`response.status` >= 500) as cnt_5xx
FROM cdn_requests_v2
WHERE timestamp >= now() - INTERVAL 1 HOUR
GROUP BY dim
ORDER BY cnt DESC
LIMIT 10
```

**Data Prime:**
```
source logs
| filter $l.subsystemname in ['cloudflare', 'fastly']
| groupby $d.cdn.datacenter as dim aggregate
    count() as cnt,
    count($d.response.status < 400) as cnt_ok,
    count($d.response.status >= 400 && $d.response.status < 500) as cnt_4xx,
    count($d.response.status >= 500) as cnt_5xx
| sort cnt desc
| limit 10
```

### 11. URL/Path Breakdown

**ClickHouse:**
```sql
SELECT
  `request.url` as dim,
  count() as cnt,
  countIf(`response.status` < 400) as cnt_ok,
  countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
  countIf(`response.status` >= 500) as cnt_5xx
FROM cdn_requests_v2
WHERE timestamp >= now() - INTERVAL 1 HOUR
GROUP BY dim
ORDER BY cnt DESC
LIMIT 10
```

**Data Prime:**
```
source logs
| filter $l.subsystemname in ['cloudflare', 'fastly']
| groupby $d.request.url as dim aggregate
    count() as cnt,
    count($d.response.status < 400) as cnt_ok,
    count($d.response.status >= 400 && $d.response.status < 500) as cnt_4xx,
    count($d.response.status >= 500) as cnt_5xx
| sort cnt desc
| limit 10
```

### 12. Referer Breakdown

**ClickHouse:**
```sql
SELECT
  `request.headers.referer` as dim,
  count() as cnt,
  countIf(`response.status` < 400) as cnt_ok,
  countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
  countIf(`response.status` >= 500) as cnt_5xx
FROM cdn_requests_v2
WHERE timestamp >= now() - INTERVAL 1 HOUR
GROUP BY dim
ORDER BY cnt DESC
LIMIT 10
```

**Data Prime:**
```
source logs
| filter $l.subsystemname in ['cloudflare', 'fastly']
| groupby $d.request.headers.referer as dim aggregate
    count() as cnt,
    count($d.response.status < 400) as cnt_ok,
    count($d.response.status >= 400 && $d.response.status < 500) as cnt_4xx,
    count($d.response.status >= 500) as cnt_5xx
| sort cnt desc
| limit 10
```

### 13. User Agent Breakdown

**ClickHouse:**
```sql
SELECT
  `request.headers.user_agent` as dim,
  count() as cnt,
  countIf(`response.status` < 400) as cnt_ok,
  countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
  countIf(`response.status` >= 500) as cnt_5xx
FROM cdn_requests_v2
WHERE timestamp >= now() - INTERVAL 1 HOUR
GROUP BY dim
ORDER BY cnt DESC
LIMIT 10
```

**Data Prime:**
```
source logs
| filter $l.subsystemname in ['cloudflare', 'fastly']
| groupby $d.request.headers.user_agent as dim aggregate
    count() as cnt,
    count($d.response.status < 400) as cnt_ok,
    count($d.response.status >= 400 && $d.response.status < 500) as cnt_4xx,
    count($d.response.status >= 500) as cnt_5xx
| sort cnt desc
| limit 10
```

### 14. Client IP Breakdown

**ClickHouse:**
```sql
SELECT
  if(`request.headers.x_forwarded_for` != '', `request.headers.x_forwarded_for`, `client.ip`) as dim,
  count() as cnt,
  countIf(`response.status` < 400) as cnt_ok,
  countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
  countIf(`response.status` >= 500) as cnt_5xx
FROM cdn_requests_v2
WHERE timestamp >= now() - INTERVAL 1 HOUR
GROUP BY dim
ORDER BY cnt DESC
LIMIT 10
```

**Data Prime:**
```
source logs
| filter $l.subsystemname in ['cloudflare', 'fastly']
| groupby $d.request.headers.x_forwarded_for != "" ? $d.request.headers.x_forwarded_for : $d.client.ip as dim aggregate
    count() as cnt,
    count($d.response.status < 400) as cnt_ok,
    count($d.response.status >= 400 && $d.response.status < 500) as cnt_4xx,
    count($d.response.status >= 500) as cnt_5xx
| sort cnt desc
| limit 10
```

### 15. Grouped Error Breakdown

**ClickHouse:**
```sql
SELECT
  REGEXP_REPLACE(`response.headers.x_error`, '/[a-zA-Z0-9/_.-]+', '/...') as dim,
  count() as cnt,
  countIf(`response.status` < 400) as cnt_ok,
  countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
  countIf(`response.status` >= 500) as cnt_5xx
FROM cdn_requests_v2
WHERE timestamp >= now() - INTERVAL 1 HOUR
  AND `response.headers.x_error` != ''
GROUP BY dim
ORDER BY cnt DESC
LIMIT 10
```

**Data Prime:**
```
source logs
| filter $l.subsystemname in ['cloudflare', 'fastly'] && $d.response.headers.x_error != ""
| groupby replace_regex($d.response.headers.x_error, '/[a-zA-Z0-9/_.-]+', '/...') as dim aggregate
    count() as cnt,
    count($d.response.status < 400) as cnt_ok,
    count($d.response.status >= 400 && $d.response.status < 500) as cnt_4xx,
    count($d.response.status >= 500) as cnt_5xx
| sort cnt desc
| limit 10
```

## Usage

```javascript
import { buildFacetQuery, FACET_DIMENSIONS } from './breakdown.dataprime.js';

// Generate a query for status range breakdown
const query = buildFacetQuery('status_range', {
  topN: 10,
  timeFilter: '$m.timestamp >= now() - 1h'
});

// Generate a host breakdown with error filter
const errorQuery = buildFacetQuery('host', {
  topN: 20,
  timeFilter: '$m.timestamp >= now() - 24h',
  additionalFilter: '$d.response.status >= 400'
});

// List all available facets
console.log(Object.keys(FACET_DIMENSIONS));
// ['status_range', 'source', 'host', 'content_type', 'cache_status',
//  'status', 'request_type', 'backend_type', 'method', 'datacenter',
//  'url', 'referer', 'user_agent', 'client_ip', 'x_error_grouped', ...]
```

## Migration Checklist

- [x] Status range facet
- [x] Source (CDN) facet
- [x] Host facet
- [x] Forwarded host facet
- [x] Content type facet
- [x] Status code facet
- [x] Cache status facet
- [x] Request type facet
- [x] Backend type facet
- [x] HTTP method facet
- [x] Datacenter facet
- [x] URL/path facet
- [x] Referer facet
- [x] User agent facet
- [x] Client IP facet
- [x] Grouped error facet
- [x] Accept header facet
- [x] Accept-Encoding header facet
- [x] Cache-Control header facet
- [x] BYO CDN type facet
- [x] Location (redirect) facet

## Notes

1. **Field Prefixes**: Data Prime uses `$d.` for user data fields, `$l.` for log metadata (subsystemname), and `$m.` for message metadata (timestamp).

2. **Time Filters**: Data Prime uses relative time syntax like `now() - 1h`, `now() - 24h` instead of ClickHouse's `INTERVAL 1 HOUR`.

3. **String Matching**: ClickHouse `LIKE '%pattern%'` becomes Data Prime `matches '.*pattern.*'` (regex).

4. **Conditional Counts**: ClickHouse `countIf(condition)` becomes Data Prime `count(condition)`.

5. **Empty String Checks**: ClickHouse uses `!= ''` while Data Prime uses `!= ""` (double quotes).

6. **Ternary Operator**: ClickHouse `if(cond, a, b)` becomes Data Prime `cond ? a : b`.

7. **Function Name Changes**:
   - `concat()` → `strcat()`
   - `toString()` → `tostring()`
   - `intDiv()` → `todecimal()`
   - `upper()` → `toupper()`
   - `REGEXP_REPLACE()` → `replace_regex()`

8. **ASN Lookups**: The ClickHouse `dictGet()` function for ASN name lookups is not yet supported in this Data Prime migration. This affects the ASN facet breakdown.

9. **Bucketed Facets**: Time-elapsed and content-length bucketed facets require additional query structure not yet implemented in this migration.
