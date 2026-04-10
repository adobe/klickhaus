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

This repository contains the analytics dashboard for CDN log data for Adobe Experience Manager (AEM) Edge Delivery Services (formerly Helix). CDN logs from Cloudflare and Fastly are ingested via GCS into four ClickHouse tables (`delivery`, `delivery_errors`, `admin`, `backend`) by the [helix-gcs2clickhouse-ingestor](https://github.com/adobe/helix-gcs2clickhouse-ingestor) Cloud Run service.

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
playwright-cli open http://localhost:$(node scripts/dev-server.mjs --dry-run)/dashboard.html
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

New users get SELECT access to `delivery`, `delivery_errors`, `admin`, `backend`, `releases`, `oncall_shifts`, and `lambda_logs`, plus dictGet access to `asn_dict`, along with the following performance/safety settings:

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

All four tables use `SharedMergeTree`, partitioned by `toDate(timestamp)`, ordered by `(toDate(timestamp), request.host, timestamp)`, TTL 2 weeks.

### Tables

| Table | Contents | `weight` column | Notes |
|-------|----------|-----------------|-------|
| `delivery` | Edge CDN requests (`cdn.is_edge = true`) from Fastly + Cloudflare | Yes (sampling rate) | Primary delivery analytics table |
| `delivery_errors` | Same schema as `delivery` but `response.status >= 500` only | No (always fully inserted) | Never sampled |
| `admin` | Fastly admin service logs | No | `admin.hlx.page` and `api.aem.live` |
| `backend` | Fastly + Cloudflare backend/subrequest logs | Yes (sampling rate) | `subsystem` column holds Fastly service ID or Cloudflare zone |

### Column Groups (common across all tables)

| Group | Columns | Description |
|-------|---------|-------------|
| **Core** | `timestamp`, `source`, `request.host` | `source` is `'cloudflare'` or `'fastly'` |
| **CDN** | `cdn.cache_status`, `cdn.datacenter`, `cdn.time_elapsed_msec`, `cdn.url`, `cdn.is_edge` | Cache behavior and edge location |
| **Client** | `client.ip`, `client.country_name`, `client.city_name`, `client.asn` | Visitor geo/network info |
| **Helix** | `helix.request_type`, `helix.backend_type`, `helix.contentbus_prefix` | AEM-specific routing metadata |
| **Request** | `request.url`, `request.method`, `request.headers.*` | Full request details |
| **Response** | `response.status`, `response.body_size`, `response.headers.*` | Response details |

### Table-specific columns

**`admin`** extras: `helix.route`, `helix.owner`, `helix.repo`, `helix.ref` (from `admin.hlx.page`); `helix.org`, `helix.site`, `helix.topic` (from `api.aem.live`); `request.headers.cookie`; `response.headers.x_ratelimit_limit/rate/x_invocation_id`.

**`backend`** extras: `subsystem LowCardinality(String)` (Fastly service ID or Cloudflare zone); `helix.rso`, `helix.scope`, `helix.contentbus_id`, `helix.blob_id`, `helix.path`; `response.headers.fastly_io_*`, `response.headers.server_timing`, `response.headers.surrogate_key`.

### Key Enum Values

**`cdn.cache_status`** (varies by CDN):
- Fastly: `hit`, `miss`, `pass`, `stale`, `expired`, `revalidated`, `dynamic`, `unknown`
- Cloudflare: `HIT`, `MISS`, `PASS`, `EXPIRED`, `HIT-CLUSTER`, `MISS-CLUSTER`, etc.

**`helix.request_type`**: `static`, `pipeline`, `media`, `config`, `rum`

**`helix.backend_type`**: `cloudflare`, `aws`

### Skip Indexes (on `delivery`)

| Index | Column | Type | Use Case |
|-------|--------|------|----------|
| `idx_host_token` | `request.host` | tokenbf_v1 | Token matches (domain parts) |
| `idx_host_ngram` | `request.host` | ngrambf_v1(3) | Substring searches `LIKE '%pattern%'` |
| `idx_url_ngram` | `request.url` | ngrambf_v1(3) | Substring searches `LIKE '%pattern%'` |
| `idx_originating_ip` | `cdn.originating_ip` | bloom_filter | Sampling hash source, abuse debugging |
| `idx_client_ip` | `client.ip` | bloom_filter | IP lookup |
| `idx_status` | `response.status` | minmax | Error filtering (`>= 400`) |
| `idx_content_type` | `response.headers.content_type` | set(100) | Content type filtering |
| `idx_error` | `response.headers.x_error` | tokenbf_v1 | Error message search |
| `idx_referer` | `request.headers.referer` | ngrambf_v1(3) | Traffic source analysis |
| `idx_forwarded_host_ngram` | `request.headers.x_forwarded_host` | ngrambf_v1(3) | Origin hostname substring |
| `idx_forwarded_host_token` | `request.headers.x_forwarded_host` | tokenbf_v1 | Origin hostname tokens |
| `idx_forwarded_for` | `request.headers.x_forwarded_for` | bloom_filter | Real client IP lookup |

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

### Query Deduplication vs SAMPLE Clauses
ClickHouse Cloud's query deduplication layer caches results based on the execution plan but **ignores the `SAMPLE` clause**. This means two identical queries with different `SAMPLE` rates return the same cached result. If implementing incremental refinement (e.g., fast sampled preview followed by a full query), you must vary the `WHERE` clause between passes to defeat deduplication — for example, adding a tautological condition like `AND weight >= 0` to the refinement query.

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
