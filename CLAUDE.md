# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

When opening pull requests, use the GitHub PR template in `.github/pull_request_template.md` and fill out the Summary, Testing Done, and Checklist sections.

## Naming Conventions

This project enforces strict naming conventions via ESLint rules. All contributions must follow these patterns:

### Variables and Functions
- **Style**: camelCase
- **Examples**: `userData`, `fetchLogs`, `handleClick`, `isValid`
- **Enforced by**: `camelcase` ESLint rule

### Constants
- **Style**: SCREAMING_SNAKE_CASE for module-level constants
- **Examples**: `TIME_RANGES`, `DEFAULT_TOP_N`, `API_BASE_URL`
- **Enforced by**: `camelcase` ESLint rule with SCREAMING_SNAKE_CASE allowed

### Classes and Constructors
- **Style**: PascalCase
- **Examples**: `DataProcessor`, `ChartRenderer`, `FilterManager`
- **Enforced by**: `new-cap` ESLint rule

### File Names
- **Style**: kebab-case for JavaScript files
- **Examples**: `url-state.js`, `facet-search.js`, `step-detection.js`
- **Exception**: Test files append `.test.js` suffix

### Private Members
- **Style**: Underscore prefix allowed only after `this`
- **Examples**: `this._internalState`, `this._cache`
- **Enforced by**: `no-underscore-dangle` ESLint rule

### DOM Element IDs and Classes
- **Style**: camelCase for IDs, kebab-case for CSS classes
- **Examples**: `id="loginForm"`, `class="dashboard-content"`

Run `npm run lint` to verify naming conventions are followed.

## Overview

This repository contains ClickHouse queries and tooling for CDN log analytics. It unifies HTTP request logs from Cloudflare and Fastly into a single analytics table for Adobe Experience Manager (AEM) Edge Delivery Services (formerly Helix).

## Development

```bash
npm install
npm start
```

This starts a dev server with auto-reload at http://localhost:5391/dashboard.html.

## Browser Exploration with playwright-cli

This project includes the `playwright-cli` skill (`.claude/skills/playwright-cli/`) for interactive browser automation. **Use it as a first step when investigating bugs or exploring new features** before writing formalized tests.

### When to Use

- **Bug investigation**: Open the dashboard, reproduce the issue, inspect DOM state, check console errors and network requests
- **Feature exploration**: Navigate the UI to understand current behavior before implementing changes
- **Visual verification**: Take screenshots to confirm rendering after code changes
- **Ad-hoc testing**: Quickly validate a fix in a real browser before committing to a formal test

### Quick Start

```bash
# Start the dev server first
npm start

# Open the dashboard and explore
playwright-cli open http://localhost:5391/dashboard.html
playwright-cli snapshot
playwright-cli fill e3 "<username>"
playwright-cli fill e5 "<password>"
playwright-cli click e7
playwright-cli snapshot
playwright-cli screenshot
```

### Workflow: Explore, Then Formalize

1. **Explore** the bug or feature interactively with `playwright-cli` (snapshot, click, inspect console/network)
2. **Understand** the root cause or behavior using `playwright-cli eval`, `playwright-cli console`, `playwright-cli network`
3. **Fix** the code
4. **Verify** the fix with `playwright-cli` (screenshot, re-test the flow)
5. **Formalize** the findings into a unit test in `js/**/*.test.js` using `@web/test-runner`

### Key Commands

```bash
playwright-cli snapshot              # Capture page structure with element refs
playwright-cli click e3              # Click element by ref from snapshot
playwright-cli fill e5 "text"        # Fill input field
playwright-cli eval "document.title" # Run JS on page
playwright-cli console               # View console messages
playwright-cli network               # View network requests
playwright-cli screenshot            # Capture screenshot
playwright-cli screenshot e12        # Screenshot specific element
```

See `.claude/skills/playwright-cli/SKILL.md` for full command reference and `.claude/skills/playwright-cli/references/` for advanced topics (request mocking, tracing, session management).

### Credentials

Dashboard login credentials are in `README.local.md` under the Users table. Use a read-only user (e.g., `lars` or `david_query`) for testing.

## Database Connection

```bash
clickhouse client --host s2p5b8wmt5.eastus2.azure.clickhouse.cloud \
  --user default --password '<see README.local.md>' --secure
```

Database: `helix_logs_production`

## User Management

Scripts in `scripts/` manage read-only ClickHouse users:

```bash
# Add a new read-only user (generates password if not provided)
node scripts/add-user.mjs <admin-user> <admin-password> <new-username> [password]

# Rotate a user's password
node scripts/roll-user.mjs <admin-user> <admin-password> <username>

# Remove a user
node scripts/drop-user.mjs <admin-user> <admin-password> <username>
```

New users get SELECT access to `cdn_requests_v2` and dictGet access to `asn_dict`, plus the following performance/safety settings:

- `enable_parallel_replicas = 1` — queries are distributed across all replicas
- `max_parallel_replicas = 6` — use up to 6 replicas for parallel reads
- `max_memory_usage = 4000000000` — 4 GB per-query memory limit to protect small replicas

Writer users (`logpush_writer`, `releases_writer`, `lambda_logs_writer`) get only the memory limit (no parallel replicas for inserts).

## Data Pipeline Architecture

### Main CDN Logs (helix5 service)

```
Cloudflare Logpush ──► cloudflare_http_requests (1-day TTL) ──► cloudflare_http_ingestion_v2 (MV) ─┐
                                                                                                   │
Fastly HTTP Logging ─► fastly_logs_incoming2 (1-day TTL) ──► fastly_ingestion_v2 (MV) ─────────────┼─► cdn_requests_v2
                                                                                                   │   (2-week TTL)
                                                                                                   │   [partitioned, with sampling]
Fastly Backend Services ─► fastly_logs_incoming_<service_id> ──► fastly_ingestion_*_v2 (MVs) ──────┘
```

### Fastly Backend Services (per-service logging)

Each backend service has its own incoming table and materialized view:

```
fastly_logs_incoming_<service_id> (1-day TTL) ──► fastly_ingestion_<service>_v2 (MV) ──► cdn_requests_v2
```

| Service | Service ID | Table | Domains |
|---------|------------|-------|---------|
| helix5 (main) | In8SInYz3UQGjyG0GPZM42 | fastly_logs_incoming2 | *.aem.page, *.aem.live |
| config | SIDuP3HxleUgBDR3Gi8T24 | fastly_logs_incoming_SIDuP3HxleUgBDR3Gi8T24 | config.aem.page |
| admin | 6a6O21m8WoIIVg5cliw7BW | fastly_logs_incoming_6a6O21m8WoIIVg5cliw7BW | admin.aem.page |
| www | 00QRLuuAsVNvsKgNWYVCbb | fastly_logs_incoming_00QRLuuAsVNvsKgNWYVCbb | www.aem.live |
| API | s2dVksBUsvEKaaYF13wIh6 | fastly_logs_incoming_s2dVksBUsvEKaaYF13wIh6 | api.aem.live |
| form | UDBDj4zfyNdZEpZApUqhL3 | fastly_logs_incoming_UDBDj4zfyNdZEpZApUqhL3 | form.aem.page |
| pipeline | cHpjIl1WNRu9SFyL1eBSj3 | fastly_logs_incoming_cHpjIl1WNRu9SFyL1eBSj3 | pipeline.aem-fastly.page |
| static | ItVEMJu5q2pJE3ejseo0W6 | fastly_logs_incoming_ItVEMJu5q2pJE3ejseo0W6 | static.aem.page |
| media | atG7Eq66bH88LhbNq7Fqq2 | fastly_logs_incoming_atG7Eq66bH88LhbNq7Fqq2 | media.aem-fastly.page |

Each backend service uses a VCL snippet (`log 100 - Log to Clickhouse`) that sends logs via HTTPS POST to ClickHouse with `Placement: none` (VCL controls format, not the endpoint).

Both CDN sources use direct HTTP logging to ClickHouse with async inserts (`async_insert=1&wait_for_async_insert=0`) for high-throughput ingestion.

### Ingestion Sources
- **Cloudflare**: Direct Logpush to ClickHouse (zones: aem.live, aem.page, aem-cloudflare.live, aem-cloudflare.page, aem.network, da.live)
- **Fastly**: Direct HTTP logging to ClickHouse with nested JSON structure (service: helix5 - *.aem.page, *.aem.live)

### Ingestion Filtering

The `cloudflare_http_ingestion_v2` materialized view filters out Cloudflare Worker subrequests to logging backends. These are tail worker `fetch()` calls that get logged by Logpush, creating noise in analytics:

```sql
WHERE ClientRequestHost NOT IN (
    's2p5b8wmt5.eastus2.azure.clickhouse.cloud:8443', -- ClickHouse Cloud (Azure, current)
    'ogadftwx3q.us-east1.gcp.clickhouse.cloud:8443',  -- ClickHouse Cloud (GCP, legacy)
    'ingress.eu1.coralogix.com'                        -- Coralogix logging
)
```

If you add new tail workers that make outbound requests to external services, add their destinations to this filter to prevent feedback loops.

## Schema Reference

### Primary Table: `cdn_requests_v2`

**Ordering**: `(timestamp, request.host)` — queries should filter on these columns first for best performance.

**Partitioning**: Daily (`toDate(timestamp)`) for efficient data management and faster queries.

**Sampling**: `SAMPLE BY sample_hash` for approximate queries on large datasets.

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

The table has two types of projections for dashboard facets:

**Minute-level projections** (`proj_minute_*`) pre-aggregate by `toStartOfMinute(timestamp)` and facet column. These are the primary projections used by all dashboard breakdown and investigation queries.

| Projection | Facet Column | Dashboard Use |
|------------|--------------|---------------|
| `proj_minute_url` | `request.url` | Top paths |
| `proj_minute_user_agent` | `request.headers.user_agent` | User agents |
| `proj_minute_referer` | `request.headers.referer` | Referrers |
| `proj_minute_x_forwarded_host` | `request.headers.x_forwarded_host` | Origin hostnames |
| `proj_minute_x_error` | `response.headers.x_error` | Error messages |
| `proj_minute_x_error_grouped` | `REGEXP_REPLACE(x_error, '/[a-zA-Z0-9/_.-]+', '/...')` | Grouped errors |
| `proj_minute_host` | `request.host` | Edge hostnames |
| `proj_minute_method` | `request.method` | HTTP methods |
| `proj_minute_datacenter` | `cdn.datacenter` | Edge locations |
| `proj_minute_request_type` | `helix.request_type` | AEM request types |
| `proj_minute_backend_type` | `helix.backend_type` | Backend types |
| `proj_minute_content_type` | `response.headers.content_type` | Content types |
| `proj_minute_cache_status` | `upper(cdn.cache_status)` | Cache status |
| `proj_minute_client_ip` | `if(x_forwarded_for != '', x_forwarded_for, client.ip)` | Client IPs |
| `proj_minute_status_range` | `concat(intDiv(response.status, 100), 'xx')` | Status ranges (2xx, 4xx) |
| `proj_minute_status` | `toString(response.status)` | HTTP status codes |
| `proj_minute_asn` | `client.asn` | ASN breakdown (integer-based) |
| `proj_minute_source` | `source` | CDN source (cloudflare/fastly) |
| `proj_minute_accept` | `request.headers.accept` | Accept header |
| `proj_minute_accept_encoding` | `request.headers.accept_encoding` | Accept-Encoding header |
| `proj_minute_cache_control` | `request.headers.cache_control` | Cache-Control header |
| `proj_minute_byo_cdn` | `request.headers.x_byo_cdn_type` | BYO CDN type |
| `proj_minute_location` | `response.headers.location` | Redirect location |
| `proj_minute_time_elapsed` | `cdn.time_elapsed_msec` | Response time (raw value for bucketed queries) |
| `proj_minute_content_length` | `response.headers.content_length` | Content length (raw value for bucketed queries) |

**Bucketed facets** (time-elapsed, content-length) use a two-level query: the inner query groups by the raw column value (hitting `proj_minute_*`), the outer query applies `multiIf()` bucketing. This allows dynamic bucket boundaries while still benefiting from projections. See `sql/queries/breakdown-bucketed.sql`.

Projections are automatically used by ClickHouse when the query matches the projection's GROUP BY. Dashboard facet queries that previously took 8-15s now complete in <1s.

There is a **25 projection limit** on ClickHouse Cloud. Check current count before adding new ones.

To add a new projection:
```sql
ALTER TABLE helix_logs_production.cdn_requests_v2
ADD PROJECTION proj_minute_example (
    SELECT
        toStartOfMinute(timestamp) as minute,
        `column.name`,
        count() as cnt,
        countIf(`response.status` < 400) as cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
        countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY minute, `column.name`
);
-- Materialize for existing data (runs in background, one at a time)
ALTER TABLE helix_logs_production.cdn_requests_v2
MATERIALIZE PROJECTION proj_minute_example;
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
| `cdn_requests_v2` | 2 weeks | Unified CDN logs (primary analytics table, partitioned) |
| `cloudflare_http_requests` | 1 day | Raw Cloudflare Logpush data |
| `cloudflare_tail_incoming` | 1 day | Raw Cloudflare Tail Worker logs (legacy) |
| `fastly_logs_incoming2` | 1 day | Raw Fastly logs - helix5 main service |
| `fastly_logs_incoming_<service_id>` | 1 day | Raw Fastly logs - backend services (see table above) |
| `asn_mapping` | None | ASN number to organization name mapping |

### ASN Mapping Infrastructure

Cloudflare provides only ASN numbers, while Fastly provides both ASN number and organization name. To ensure consistent ASN display across both CDN sources, we use a dictionary-based lookup:

```
fastly_logs_incoming2 ──► asn_mapping_mv ──► asn_mapping (ReplacingMergeTree)
                                                    │
                                             asn_dict (Dictionary, 24h TTL)
                                                    │
Dashboard query ◄─────── dictGet() ────────────────┘
```

**Components:**

| Component | Type | Purpose |
|-----------|------|---------|
| `asn_mapping` | ReplacingMergeTree | Stores ASN→name mappings from Fastly data |
| `asn_mapping_mv` | Materialized View | Populates mapping from incoming Fastly logs |
| `asn_dict` | Dictionary (HASHED) | Fast O(1) lookups, refreshed every 24h |

**Dashboard Query Pattern:**
```sql
SELECT
  concat(toString(`client.asn`), ' - ',
         dictGet('helix_logs_production.asn_dict', 'name', `client.asn`)) as dim,
  count() as cnt
FROM cdn_requests_v2
WHERE `client.asn` != 0
GROUP BY `client.asn`  -- Filter on integer, not string
```

**Benefits:**
- Cloudflare requests now show ASN names (resolved via dictionary)
- Filtering uses integer comparison (`client.asn = 13335`) instead of string matching
- Projection `proj_facet_asn_num` pre-aggregates by integer ASN for faster queries

### Raw Table Schemas

| Table | Schema |
|-------|--------|
| `cloudflare_http_requests` | Flat columns (`EdgeStartTimestamp`, `ClientIP`, `ClientRequestURI`, etc.) with `RequestHeaders`/`ResponseHeaders` as JSON strings |
| `fastly_logs_incoming2` | Coralogix format with nested `json` Tuple containing all CDN log data |

## Query Patterns

```sql
-- Always quote dotted column names with backticks
SELECT `request.host`, count()
FROM helix_logs_production.cdn_requests_v2
WHERE timestamp > now() - INTERVAL 1 HOUR
GROUP BY `request.host`
ORDER BY count() DESC
LIMIT 10;

-- Cache hit rate by source
SELECT
    source,
    countIf(`cdn.cache_status` IN ('hit', 'HIT', 'HIT-CLUSTER')) / count() AS hit_rate
FROM helix_logs_production.cdn_requests_v2
WHERE timestamp > now() - INTERVAL 1 DAY
GROUP BY source;

-- Error analysis
SELECT `response.status`, count()
FROM helix_logs_production.cdn_requests_v2
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
FROM helix_logs_production.cdn_requests_v2
WHERE `helix.request_type` != ''
LIMIT 10
QUERY
```
