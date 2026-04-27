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

This repository contains the analytics dashboard for CDN log data for Adobe Experience Manager (AEM) Edge Delivery Services (formerly Helix). CDN logs from Cloudflare and Fastly are ingested via GCS into four ClickHouse tables (`delivery`, `delivery_errors`, `admin`, `backend`) by the [helix-gcs2clickhouse-ingestor](https://github.com/adobe/helix-gcs2clickhouse-ingestor) Cloud Run service. A separate `da` table holds Document Authoring traffic (`*.da.live`, `docs.da.live`, etc.) and powers the DA dashboard.

## Development

```bash
npm install
npm start
```

This starts a dev server with auto-reload. The port is deterministic per worktree and printed on startup. Use `node scripts/dev-server.mjs --dry-run` to get the port without starting the server.

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
playwright-cli open http://localhost:$(node scripts/dev-server.mjs --dry-run)/delivery.html
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

New users get SELECT access to `delivery`, `delivery_errors`, `admin`, `backend`, `da`, `releases`, `oncall_shifts`, and `lambda_logs`, plus dictGet access to `asn_dict`, along with the following performance/safety settings:

- `enable_parallel_replicas = 1` — queries are distributed across all replicas
- `max_parallel_replicas = 6` — use up to 6 replicas for parallel reads
- `max_memory_usage = 4000000000` — 4 GB per-query memory limit to protect small replicas

Writer users (`logpush_writer`, `releases_writer`, `lambda_logs_writer`) get only the memory limit (no parallel replicas for inserts).

## Data Pipeline Architecture

CDN logs from Cloudflare and Fastly are shipped to a GCS bucket (`gs://helix-logs`, GCP project `helix-225321`, region `us-west1`). A Cloud Run service ([helix-gcs2clickhouse-ingestor](https://github.com/adobe/helix-gcs2clickhouse-ingestor)) is triggered by Pub/Sub on each new GCS object and inserts rows into ClickHouse.

```
Cloudflare ──► gs://helix-logs/cloudflare/delivery/  ─┐
                                                       ├─► Pub/Sub (helix-logs-ingestor)
Fastly ──────► gs://helix-logs/fastly/delivery/  ──────┤       │
               gs://helix-logs/fastly/admin/  ─────────┤       ▼
               gs://helix-logs/fastly/backend/ ─────────┘  Cloud Run
               gs://helix-logs/cloudflare/backend/ ────┘   (helix-gcs2clickhouse-ingestor)
                                                                    │
                                        ┌───────────────────────────┼────────────────────────┐
                                        ▼                           ▼                        ▼
                                    delivery                      admin                  backend
                                  + delivery_errors
```

**GCS object lifecycle:** `fastly/` and `cloudflare/` prefixes expire after 30 days; `ingestion-errors/` after 90 days.

**Trigger chain:**
1. GCS object finalize event → Pub/Sub topic `helix-logs-ingestor`
2. Pub/Sub push subscription → Cloud Run HTTP POST (ack deadline 300s)
3. Cloud Run downloads + decompresses `.log.gz`, parses JSON lines, applies sampling, inserts into ClickHouse
4. Returns 200 (ack) on success, 500 (retry) on error

**GCS paths and target tables:**

| GCS prefix | Source | Target table(s) |
|------------|--------|-----------------|
| `fastly/delivery/` | Fastly delivery (*.aem.page, *.aem.live) | `delivery`, `delivery_errors` |
| `cloudflare/delivery/` | Cloudflare delivery | `delivery`, `delivery_errors` |
| `fastly/admin/` | Fastly admin (`admin.hlx.page`, `api.aem.live`) | `admin` |
| `fastly/backend/` | Fastly backend services (config, pipeline, static, media) | `backend` |
| `cloudflare/backend/` | Cloudflare Worker subrequests (`config.aem[-cloudflare].page`) | `backend` |

**Sampling:** Controlled by `gs://helix-logs/sampling.json` (cached 5 min in the Cloud Run process). Algorithm: `sha256(timestamp_ms + ":" + cdn.originating_ip) % rate === 0` → keep row with `weight = rate`. Applies to `delivery` and `backend`; `delivery_errors` is always fully inserted. If `sampling.json` is absent, `default_rate: 1` (no sampling).

**Processing errors:** Written to `gs://helix-logs/ingestion-errors/YYYYMMDD/<timestamp>.json`. ClickHouse block-level insert deduplication makes Pub/Sub retries safe.

## Schema Reference

### Main tables

| Table | Contents | `weight` column | Notes |
|-------|----------|-----------------|-------|
| `delivery` | Edge CDN requests (`cdn.is_edge = true`) from Fastly + Cloudflare | Yes (sampling rate) | Primary delivery analytics table |
| `delivery_errors` | Same schema as `delivery` but `response.status >= 500` only | No (always fully inserted) | Never sampled |
| `admin` | Fastly admin service logs | No | `admin.hlx.page` and `api.aem.live` |
| `backend` | Fastly + Cloudflare backend/subrequest logs | Yes (sampling rate) | `subsystem` column holds Fastly service ID or Cloudflare zone |
| `da` | Cloudflare requests for Document Authoring (`*.da.live`, `docs.da.live`) | Yes (sampling rate) | DA-specific columns: `cdn.script_name` (Worker), `cdn.request_source`. No `source`/`byo_cdn`/`helix.*` |

**Ordering**: `(timestamp, request.host)` — queries should filter on these columns first for best performance.

**Partitioning**: Daily (`toDate(timestamp)`) for efficient data management and faster queries.

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

#### Column Groups (common across all tables)

| Group | Columns | Description |
|-------|---------|-------------|
| **Core** | `timestamp`, `source`, `request.host` | `source` is `'cloudflare'` or `'fastly'` |
| **CDN** | `cdn.cache_status`, `cdn.datacenter`, `cdn.time_elapsed_msec`, `cdn.url`, `cdn.is_edge` | Cache behavior and edge location |
| **Client** | `client.ip`, `client.country_name`, `client.city_name`, `client.asn` | Visitor geo/network info |
| **Helix** | `helix.request_type`, `helix.backend_type`, `helix.contentbus_prefix` | AEM-specific routing metadata |
| **Request** | `request.url`, `request.method`, `request.headers.*` | Full request details |
| **Response** | `response.status`, `response.body_size`, `response.headers.*` | Response details |

#### Table-specific columns

**`admin`** extras: `helix.route`, `helix.owner`, `helix.repo`, `helix.ref` (from `admin.hlx.page`); `helix.org`, `helix.site`, `helix.topic` (from `api.aem.live`); `request.headers.cookie`; `response.headers.x_ratelimit_limit/rate/x_invocation_id`.

**`backend`** extras: `subsystem LowCardinality(String)` (Fastly service ID or Cloudflare zone); `helix.rso`, `helix.scope`, `helix.contentbus_id`, `helix.blob_id`, `helix.path`; `response.headers.fastly_io_*`, `response.headers.server_timing`, `response.headers.surrogate_key`.

#### Key Enum Values

**`cdn.cache_status`** (varies by CDN):
- Fastly: `hit`, `miss`, `pass`, `stale`, `expired`, `revalidated`, `dynamic`, `unknown`
- Cloudflare: `HIT`, `MISS`, `PASS`, `EXPIRED`, `HIT-CLUSTER`, `MISS-CLUSTER`, etc.

**`helix.request_type`**: `static`, `pipeline`, `media`, `config`, `rum`

**`helix.backend_type`**: `cloudflare`, `aws`

#### Facet Table Architecture

Dashboard breakdown queries use a dedicated `cdn_facet_minutes` SummingMergeTree table instead of projections on `delivery`. A materialized view (`cdn_facet_minutes_mv`) uses ARRAY JOIN to fan each incoming row into 14 facet entries, pre-aggregating low-cardinality facets at minute granularity.

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

**High-cardinality facets** (`highCardinality: true` in `js/breakdowns/definitions.js`) skip the facet table and query `delivery` directly: hosts, forwarded hosts, URLs, referers, user agents, client IPs, and redirect locations.

**Query routing**: `canUseFacetTable()` in `js/breakdowns/index.js` routes a breakdown to the facet table when all of these are true:
- The breakdown has a `facetName`
- Not a bucketed facet (`rawCol`)
- Not marked `highCardinality`
- No host filter, column filters, or additional WHERE clauses are active
- Not in bytes aggregation mode
- Not the ASN breakdown (uses `dictGet` which produces different dim values)

When any condition fails, the query falls back to `delivery`.

**Bucketed facets** (time-elapsed, content-length) always query `delivery` with a two-level query: the inner query groups by the raw column value, the outer query applies `multiIf()` bucketing. See `sql/queries/breakdown-bucketed.sql`.

#### Query Routing

**Concurrency limiter**: Breakdown queries fan out 20+ parallel queries (one per facet). A concurrency limiter (`js/concurrency-limiter.js`) caps this at **4 concurrent queries** to reduce ClickHouse query contention.

**Performance characteristics**:
- Low-cardinality facets (facet table): 3–50ms
- High-cardinality facets (raw table): 0.1–0.4s

## Query Patterns

```sql
-- Always quote dotted column names with backticks
SELECT `request.host`, count()
FROM helix_logs_production.delivery
WHERE timestamp > now() - INTERVAL 1 HOUR
GROUP BY `request.host`
ORDER BY count() DESC
LIMIT 10;

-- Cache hit rate by source
SELECT
    source,
    countIf(`cdn.cache_status` IN ('hit', 'HIT', 'HIT-CLUSTER')) / count() AS hit_rate
FROM helix_logs_production.delivery
WHERE timestamp > now() - INTERVAL 1 DAY
GROUP BY source;

-- Error analysis (use delivery_errors for 5xx — never sampled)
SELECT `response.status`, count()
FROM helix_logs_production.delivery_errors
WHERE timestamp > now() - INTERVAL 1 HOUR
GROUP BY `response.status`
ORDER BY count() DESC;

-- Admin logs
SELECT `request.url`, `response.status`, count()
FROM helix_logs_production.admin
WHERE timestamp > now() - INTERVAL 1 HOUR
GROUP BY `request.url`, `response.status`
ORDER BY count() DESC
LIMIT 10;
```

## ClickHouse Cloud Pitfalls

### DateTime64 Boundary Precision
The `timestamp` column is `DateTime64(3)` (millisecond precision). When constructing time filters, ensure both bounds use matching precision. Using `toDateTime()` (second precision) for bounds against a `DateTime64(3)` column causes rows at bucket boundaries to be double-counted or missed. The current implementation uses `toStartOfMinute()` to normalize both sides (see `getTimeFilter()` in `js/time.js`).

## CLI Notes

When running queries from shell, use heredocs for complex queries with backticks:
```bash
clickhouse client --host ... --secure <<'QUERY'
SELECT `request.host`, count()
FROM helix_logs_production.delivery
WHERE timestamp > now() - INTERVAL 1 HOUR
LIMIT 10
QUERY
```
