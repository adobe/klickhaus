# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This repository contains ClickHouse queries and tooling for CDN log analytics. It unifies HTTP request logs from Cloudflare and Fastly into a single analytics table for Adobe Experience Manager (AEM) Edge Delivery Services (formerly Helix).

## Development

```bash
npm install
npm start
```

This starts a dev server with auto-reload at http://localhost:8000/dashboard.html.

## Database Connection

```bash
clickhouse client --host ogadftwx3q.us-east1.gcp.clickhouse.cloud \
  --user default --password '<see README.local.md>' --secure
```

Database: `helix_logs_production`

## Data Pipeline Architecture

```
Cloudflare Logpush ──► cloudflare_http_requests (1-day TTL)
                              │
                    cloudflare_http_ingestion (MV)
                              │
                              ▼
                     cdn_requests_combined (2-week TTL)
                              ▲
                    fastly_ingestion (MV)
                              │
S3 ClickPipes ──────► fastly_logs_incoming2 (1-day TTL)
```

### Ingestion Sources
- **Cloudflare**: Direct Logpush to ClickHouse (zones: aem.live, aem.page, aem-cloudflare.live, aem-cloudflare.page, aem.network, da.live)
- **Fastly**: S3 ClickPipes ingestion with nested JSON structure

### Ingestion Filtering

The `cloudflare_http_ingestion` materialized view filters out Cloudflare Worker subrequests to logging backends. These are tail worker `fetch()` calls that get logged by Logpush, creating noise in analytics:

```sql
WHERE ClientRequestHost NOT IN (
    'ogadftwx3q.us-east1.gcp.clickhouse.cloud:8443',  -- ClickHouse Cloud
    'ingress.eu1.coralogix.com'                        -- Coralogix logging
)
```

If you add new tail workers that make outbound requests to external services, add their destinations to this filter to prevent feedback loops.

## Schema Reference

### Primary Table: `cdn_requests_combined`

**Ordering**: `(timestamp, request.host)` — queries should filter on these columns first for best performance.

**TTL**: 2 weeks

#### Secondary Indexes (Skip Indexes)

| Index | Column | Type | Use Case |
|-------|--------|------|----------|
| `idx_host_token` | `request.host` | tokenbf_v1 | Token matches (domain parts) |
| `idx_host_ngram` | `request.host` | ngrambf_v1(3) | Substring searches `LIKE '%pattern%'` |
| `idx_url_ngram` | `request.url` | ngrambf_v1(3) | Substring searches `LIKE '%pattern%'` |
| `idx_client_ip` | `client.ip` | bloom_filter | IP lookup (abuse, debugging) |
| `idx_status` | `response.status` | minmax | Error filtering (`>= 400`) |
| `idx_cache_status` | `cdn.cache_status` | set(30) | Cache analysis |
| `idx_content_type` | `response.headers.content_type` | set(100) | Content type filtering |
| `idx_error` | `response.headers.x_error` | tokenbf_v1 | Error message search |
| `idx_referer` | `request.headers.referer` | ngrambf_v1(3) | Traffic source analysis |
| `idx_forwarded_host_ngram` | `request.headers.x_forwarded_host` | ngrambf_v1(3) | Origin hostname substring |
| `idx_forwarded_host_token` | `request.headers.x_forwarded_host` | tokenbf_v1 | Origin hostname tokens |
| `idx_forwarded_for` | `request.headers.x_forwarded_for` | bloom_filter | Real client IP lookup |

These skip indexes accelerate queries by excluding granules that definitely don't match. Most requests (~93%) have `x_forwarded_host` and `x_forwarded_for` populated from upstream CDNs.

#### Projections (Pre-aggregated Facets)

The table has projections for all dashboard facets, enabling sub-second GROUP BY queries. Each projection pre-aggregates data by hour and facet value with status code breakdowns.

| Projection | Facet Column | Dashboard Use |
|------------|--------------|---------------|
| `proj_facet_url` | `request.url` | Top paths |
| `proj_facet_user_agent` | `request.headers.user_agent` | User agents |
| `proj_facet_referer` | `request.headers.referer` | Referrers |
| `proj_facet_x_forwarded_host` | `request.headers.x_forwarded_host` | Origin hostnames |
| `proj_facet_x_error` | `response.headers.x_error` | Error messages |
| `proj_facet_host` | `request.host` | Edge hostnames |
| `proj_facet_method` | `request.method` | HTTP methods |
| `proj_facet_datacenter` | `cdn.datacenter` | Edge locations |
| `proj_facet_request_type` | `helix.request_type` | AEM request types |
| `proj_facet_backend_type` | `helix.backend_type` | Backend types |
| `proj_facet_content_type` | `response.headers.content_type` | Content types |
| `proj_facet_cache_status` | `upper(cdn.cache_status)` | Cache status |
| `proj_facet_client_ip` | `if(x_forwarded_for != '', x_forwarded_for, client.ip)` | Client IPs |
| `proj_facet_status_range` | `concat(intDiv(response.status, 100), 'xx')` | Status ranges (2xx, 4xx) |
| `proj_facet_status` | `toString(response.status)` | HTTP status codes |
| `proj_facet_asn` | `concat(client.asn, ' - ', client.name)` | ASN breakdown |

Projections are automatically used by ClickHouse when the query matches the projection's GROUP BY. Dashboard facet queries that previously took 8-15s now complete in <1s.

To add a new projection:
```sql
ALTER TABLE helix_logs_production.cdn_requests_combined
ADD PROJECTION proj_facet_example (
    SELECT
        toStartOfHour(timestamp) as hour,
        `column.name`,
        count() as cnt,
        countIf(`response.status` < 400) as cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
        countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `column.name`
);
-- Materialize for existing data (runs in background)
ALTER TABLE helix_logs_production.cdn_requests_combined
MATERIALIZE PROJECTION proj_facet_example;
```

#### Column Groups

| Group | Columns | Description |
|-------|---------|-------------|
| **Core** | `timestamp`, `source`, `request.host` | Primary dimensions. `source` is `'cloudflare'` or `'fastly'` |
| **CDN** | `cdn.cache_status`, `cdn.datacenter`, `cdn.time_elapsed_msec`, `cdn.url` | Cache behavior and edge location |
| **Client** | `client.ip`, `client.country_name`, `client.city_name`, `client.asn` | Visitor geo/network info |
| **Helix** | `helix.request_type`, `helix.backend_type`, `helix.contentbus_prefix` | AEM-specific routing metadata |
| **Request** | `request.url`, `request.method`, `request.headers.*` | Full request details |
| **Response** | `response.status`, `response.body_size`, `response.headers.*` | Response details |

#### Key Enum Values

**`cdn.cache_status`** (varies by CDN):
- Fastly: `hit`, `miss`, `pass`, `stale`, `expired`, `revalidated`, `dynamic`, `unknown`
- Cloudflare: `HIT`, `MISS`, `PASS`, `EXPIRED`, `HIT-CLUSTER`, `MISS-CLUSTER`, etc.

**`helix.request_type`**: `static`, `pipeline`, `media`, `config`, `rum`

**`helix.backend_type`**: `cloudflare`, `aws`

### All Tables with TTLs

| Table | TTL | Purpose |
|-------|-----|---------|
| `cdn_requests_combined` | 2 weeks | Unified CDN logs (primary analytics table) |
| `cloudflare_http_requests` | 1 day | Raw Cloudflare Logpush data |
| `cloudflare_tail_incoming` | 1 day | Raw Cloudflare Tail Worker logs (legacy) |
| `fastly_logs_incoming2` | 1 day | Raw Fastly logs (Coralogix format via S3 ClickPipes) |
| `fastly_logs_incoming2_clickpipes_error` | 7 days | ClickPipes ingestion errors |

### Raw Table Schemas

| Table | Schema |
|-------|--------|
| `cloudflare_http_requests` | Flat columns (`EdgeStartTimestamp`, `ClientIP`, `ClientRequestURI`, etc.) with `RequestHeaders`/`ResponseHeaders` as JSON strings |
| `fastly_logs_incoming2` | Coralogix format with nested `json` Tuple containing all CDN log data |

## Query Patterns

```sql
-- Always quote dotted column names with backticks
SELECT `request.host`, count()
FROM helix_logs_production.cdn_requests_combined
WHERE timestamp > now() - INTERVAL 1 HOUR
GROUP BY `request.host`
ORDER BY count() DESC
LIMIT 10;

-- Cache hit rate by source
SELECT
    source,
    countIf(`cdn.cache_status` IN ('hit', 'HIT', 'HIT-CLUSTER')) / count() AS hit_rate
FROM helix_logs_production.cdn_requests_combined
WHERE timestamp > now() - INTERVAL 1 DAY
GROUP BY source;

-- Error analysis
SELECT `response.status`, count()
FROM helix_logs_production.cdn_requests_combined
WHERE timestamp > now() - INTERVAL 1 HOUR
  AND `response.status` >= 400
GROUP BY `response.status`
ORDER BY count() DESC;
```

## CLI Notes

When running queries from shell, use heredocs for complex queries with backticks:
```bash
clickhouse client --host ... --secure <<'QUERY'
SELECT `request.host`, count()
FROM helix_logs_production.cdn_requests_combined
WHERE `helix.request_type` != ''
LIMIT 10
QUERY
```
