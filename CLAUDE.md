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

This starts a dev server with auto-reload. The port is deterministic per worktree and printed on startup. Use `node scripts/dev-server.js --dry-run` to get the port without starting the server.

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
playwright-cli open http://localhost:$(node scripts/dev-server.js --dry-run)/dashboard.html
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

New users get SELECT access to `cdn_requests_combined`, `cdn_requests_v2`, `cdn_facet_minutes`, `releases`, `oncall_shifts`, and `lambda_logs`, plus dictGet access to `asn_dict`, along with the following performance/safety settings:

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

#### Facet Table Architecture

Dashboard breakdown queries use a dedicated `cdn_facet_minutes` SummingMergeTree table instead of projections on `cdn_requests_v2`. A materialized view (`cdn_facet_minutes_mv`) uses ARRAY JOIN to fan each incoming row into 14 facet entries, pre-aggregating low-cardinality facets at minute granularity.

**Schema:**
```sql
CREATE TABLE cdn_facet_minutes (
    minute DateTime,
    facet LowCardinality(String),
    dim String,
    cnt UInt64,
    cnt_ok UInt64,
    cnt_4xx UInt64,
    cnt_5xx UInt64
) ENGINE = SummingMergeTree
PARTITION BY toDate(minute)
ORDER BY (facet, minute, dim)
TTL minute + toIntervalDay(14)
```

**Facets in `cdn_facet_minutes`** (14 low-cardinality):

| Facet Name | Source Column | Dashboard Use |
|------------|---------------|---------------|
| `status_range` | `concat(intDiv(response.status, 100), 'xx')` | Status ranges (2xx, 4xx) |
| `source` | `source` | CDN source (cloudflare/fastly) |
| `content_type` | `response.headers.content_type` | Content types |
| `status` | `toString(response.status)` | HTTP status codes |
| `x_error_grouped` | `REGEXP_REPLACE(x_error, '/[a-zA-Z0-9/_.-]+', '/...')` | Grouped errors |
| `cache_status` | `upper(cdn.cache_status)` | Cache status |
| `request_type` | `helix.request_type` | AEM request types |
| `backend_type` | `helix.backend_type` | Backend types |
| `method` | `request.method` | HTTP methods |
| `datacenter` | `cdn.datacenter` | Edge locations |
| `accept` | `request.headers.accept` | Accept header |
| `accept_encoding` | `request.headers.accept_encoding` | Accept-Encoding header |
| `cache_control` | `request.headers.cache_control` | Cache-Control header |
| `byo_cdn` | `request.headers.x_byo_cdn_type` | BYO CDN type |

**High-cardinality facets** (`highCardinality: true` in `js/breakdowns/definitions.js`) skip the facet table and query `cdn_requests_v2` directly with sampling: hosts, forwarded hosts, URLs, referers, user agents, client IPs, and redirect locations.

**Query routing**: `canUseFacetTable()` in `js/breakdowns/index.js` routes a breakdown to the facet table when all of these are true:
- The breakdown has a `facetName`
- Not a bucketed facet (`rawCol`)
- Not marked `highCardinality`
- No host filter, column filters, or additional WHERE clauses are active
- Not in bytes aggregation mode
- Not the ASN breakdown (uses `dictGet` which produces different dim values)

When any condition fails, the query falls back to `cdn_requests_v2` with sampling.

**Bucketed facets** (time-elapsed, content-length) always query `cdn_requests_v2` with a two-level query: the inner query groups by the raw column value, the outer query applies `multiIf()` bucketing. See `sql/queries/breakdown-bucketed.sql`.

**Historical note**: All projections on `cdn_requests_v2` have been dropped (zero remain). The original definitions are backed up in `sql/backup-projections.sql`. ClickHouse Cloud has a **25 projection limit** per table — the facet table approach avoids this constraint entirely.

#### Query Routing and Sampling

**Proportional sampling**: `getSamplingConfig()` in `js/time.js` uses `SAMPLE (1h / period)` for time ranges longer than 1 hour. This keeps scanned row count roughly constant regardless of time range (e.g., a 24h query samples ~4% of data). Ranges ≤ 1 hour use no sampling.

**Concurrency limiter**: Breakdown queries fan out 20+ parallel queries (one per facet). A concurrency limiter (`js/concurrency-limiter.js`) caps this at **4 concurrent queries** to reduce ClickHouse query contention.

**Performance characteristics**:
- Low-cardinality facets (facet table): 3–50ms
- High-cardinality facets (sampled raw table): 0.1–0.4s

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
| `cdn_facet_minutes` | 2 weeks | Pre-aggregated facet counts (SummingMergeTree, 14 facets at minute level) |
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

-- Facet table query (low-cardinality breakdowns)
SELECT dim, sum(cnt) as cnt, sum(cnt_ok) as cnt_ok,
       sum(cnt_4xx) as cnt_4xx, sum(cnt_5xx) as cnt_5xx
FROM helix_logs_production.cdn_facet_minutes
WHERE facet = 'cache_status'
  AND minute >= now() - INTERVAL 1 HOUR
  AND minute <= now()
GROUP BY dim WITH TOTALS
ORDER BY cnt DESC
LIMIT 10;
```

## ClickHouse Cloud Pitfalls

### DateTime64 Boundary Precision
The `timestamp` column is `DateTime64(3)` (millisecond precision). When constructing time filters, ensure both bounds use matching precision. Using `toDateTime()` (second precision) for bounds against a `DateTime64(3)` column causes rows at bucket boundaries to be double-counted or missed. The current implementation uses `toStartOfMinute()` to normalize both sides (see `getTimeFilter()` in `js/time.js`).

### Query Deduplication vs SAMPLE Clauses
ClickHouse Cloud's query deduplication layer caches results based on the execution plan but **ignores the `SAMPLE` clause**. This means two identical queries with different `SAMPLE` rates return the same cached result. If implementing incremental refinement (e.g., fast sampled preview followed by a full query), you must vary the `WHERE` clause between passes to defeat deduplication — for example, adding a tautological condition like `AND sample_hash >= 0` to the refinement query. The current architecture avoids this issue for low-cardinality facets by routing them through the `cdn_facet_minutes` table (no sampling needed), while high-cardinality facets use a single sampling pass without refinement.

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
