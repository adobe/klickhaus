# Klickhaus - CDN Analytics Dashboard

A real-time analytics dashboard for CDN log analysis, built with ClickHouse and vanilla JavaScript.

![CDN Analytics Dashboard](screenshot.png)

## Features

- **Real-time request monitoring** - Stacked area chart showing requests over time, color-coded by status (2xx/3xx green, 4xx yellow, 5xx red)
- **Multi-dimensional breakdowns** - Analyze traffic by:
  - Status codes and ranges
  - Hosts and forwarded hosts
  - Content types
  - Cache status (HIT, MISS, etc.)
  - Paths and referers
  - User agents and IP addresses
  - Request types and backend types
  - HTTP methods and datacenters
  - ASN (Autonomous System Numbers)
- **Interactive filtering** - Click to filter or exclude any dimension value
- **Copy to spreadsheet** - Copy any facet's data as TSV with one click (copy button) for analysis in Excel/Sheets
- **Flexible time ranges** - Last hour, 12 hours, 24 hours, or 7 days
- **Dark mode support** - Automatic theme based on system preference
- **Query caching** - Intelligent cache TTLs based on time range
- **Fast facet queries** - Pre-aggregated facet table

## Architecture

CDN logs from Cloudflare and Fastly are shipped to a GCS bucket and ingested into ClickHouse by a Cloud Run service:

```
Cloudflare ──► gs://helix-logs/cloudflare/ ─┐
                                             ├─► Pub/Sub ──► Cloud Run (helix-gcs2clickhouse-ingestor)
Fastly ──────► gs://helix-logs/fastly/ ──────┘                    │
                                                        ┌──────────┼───────────┐
                                                        ▼          ▼           ▼
                                                    delivery    admin       backend
                                                  + delivery_errors
```

The ingestor reads gzipped JSON-lines files from GCS, applies sampling, and inserts into four ClickHouse tables. Source: [helix-gcs2clickhouse-ingestor](https://github.com/adobe/helix-gcs2clickhouse-ingestor).

## Usage

Open [klickhaus.aemstatus.net](https://klickhaus.aemstatus.net/) (fallback: [maisonclic.aemstatus.net](https://maisonclic.aemstatus.net/)), log in with your ClickHouse credentials, then use the time range selector and host filter to narrow down results. Click any breakdown value to filter, or use "Exclude" to exclude it.

### Delivery Dashboard

`delivery.html` — queries the `delivery` table, which contains edge CDN requests from:
- **Fastly**: `*.aem.live`, `*.aem.page`, `*.aem-fastly.live`, `*.aem-fastly.page`
- **Cloudflare**: `*.aem.live`, `*.aem.page`, `*.aem-cloudflare.live`, `*.aem-cloudflare.page`

### Admin Dashboard

`admin.html` — queries the `admin` table, which contains logs from two Fastly services:
- `admin.hlx.page`
- `api.aem.live`

### Backend Dashboard

`backend.html` — queries the `backend` table, which contains logs from:
- **Fastly**: `config.aem.page`, `config.aem-fastly.page`, `pipeline.aem.page`, `pipeline.aem-fastly.page`, `static.aem.page`, `static.aem-fastly.page`, `media.aem.page`, `media.aem-fastly.page`
- **Cloudflare**: `config.aem.page`, `config.aem-cloudflare.page`

### Copy Facet Data

Click the "copy" button on any facet header to copy its data as TSV. Paste directly into Excel, Google Sheets, or Numbers.

## URL Parameters

The dashboard state can be controlled via URL parameters for bookmarking and sharing:


| Parameter | Description                                       | Example                                                                     |
| --------- | ------------------------------------------------- | --------------------------------------------------------------------------- |
| `t`       | Time range: `15m`, `1h`, `12h`, `24h`, `3d`, `7d` | `?t=24h`                                                                    |
| `n`       | Top N facet values: `5`, `10`, `20`, `50`, `100`  | `?n=20`                                                                     |
| `host`    | Filter by host (substring match)                  | `?host=example.com`                                                         |
| `view`    | View mode: `logs` for logs table                  | `?view=logs`                                                                |
| `ts`      | Query timestamp (ISO 8601)                        | `?ts=2025-01-15T12:00:00Z`                                                  |
| `filters` | Facet filters (JSON array)                        | `?filters=[{"col":"\`request.host","value":"example.com","exclude":false}]` |
| `pinned`  | Pinned log columns (comma-separated)              | `?pinned=timestamp,response.status,request.url`                             |
| `hide`    | Hide UI controls (comma-separated)                | `?hide=timeRange,topN,logout`                                               |


### Hide Parameter Options

The `hide` parameter accepts these control names:

- `timeRange` - Time range selector
- `topN` - Top N selector
- `host` - Host filter input
- `refresh` - Refresh button
- `logout` - Logout button
- `logs` - Logs/Filters toggle button

### Examples

```
# Lock to 24h view with hidden controls
?t=24h&hide=timeRange,logout

# Show logs view with specific columns pinned
?view=logs&pinned=timestamp,response.status,request.method,request.url

# Pre-filtered view for a specific host
?host=example.com&t=1h&n=10

# Embed-friendly minimal UI
?t=1h&hide=timeRange,topN,host,refresh,logout
```

## User Management

Scripts in `scripts/` manage dashboard access (require admin credentials):

```bash
# Add a new read-only user
node scripts/add-user.mjs <admin-user> <admin-password> <new-username> [password]

# Rotate a user's password
node scripts/roll-user.mjs <admin-user> <admin-password> <username>

# Remove a user
node scripts/drop-user.mjs <admin-user> <admin-password> <username>
```

New users receive read-only `SELECT` access to the analytics tables (`delivery`, `delivery_errors`, `admin`, `backend`).

## Local Development

```bash
npm install
npm start
```

This starts a development server with auto-reload. The port is deterministic per worktree and printed on startup. Use `node scripts/dev-server.mjs --dry-run` to get the port without starting the server.

For ClickHouse CLI access:

```bash
clickhouse client --host s2p5b8wmt5.eastus2.azure.clickhouse.cloud \
  --user default --password '<password>' --secure
```

## Data Schema

Four ClickHouse tables in `helix_logs_production`, all `SharedMergeTree`, partitioned by day, 2-week TTL:

| Table | Contents | Sampling |
|-------|----------|----------|
| `delivery` | All edge CDN requests (`cdn.is_edge = true`) from Fastly and Cloudflare | Yes (`weight` column) |
| `delivery_errors` | Subset of `delivery` — only `response.status >= 500`, never sampled | No |
| `admin` | Fastly admin service logs (`admin.hlx.page`, `api.aem.live`) | No |
| `backend` | Fastly and Cloudflare backend/subrequest logs | Yes (`weight` column) |

Common columns across all tables:

| Column Group | Examples                                                      |
| ------------ | ------------------------------------------------------------- |
| Core         | `timestamp`, `source`, `request.host`                         |
| CDN          | `cdn.cache_status`, `cdn.datacenter`, `cdn.time_elapsed_msec` |
| Client       | `client.ip`, `client.country_name`, `client.asn`              |
| Request      | `request.url`, `request.method`, `request.headers.*`          |
| Response     | `response.status`, `response.body_size`, `response.headers.*` |
| Helix        | `helix.request_type`, `helix.backend_type`                    |

Sampling is controlled by `gs://helix-logs/sampling.json` (cached 5 min). The algorithm hashes `timestamp_ms + ":" + cdn.originating_ip` and keeps rows where `hash % rate === 0`, setting `weight` to the rate on kept rows.


## Runbook

### No data in dashboard

**Symptoms:** Dashboard shows no data or stale data.

**Diagnosis:**

```bash
# Check recent rows in the delivery table
clickhouse client --host s2p5b8wmt5.eastus2.azure.clickhouse.cloud \
  --user default --password '<password>' --secure \
  --query "SELECT count(), max(timestamp) FROM helix_logs_production.delivery
           WHERE timestamp > now() - INTERVAL 1 HOUR"
```

If `delivery` has no recent rows, check the GCS ingestor:
- Verify Cloud Run service `helix-gcs2clickhouse-ingestor` is running (GCP project `helix-225321`)
- Check Cloud Run logs for errors: `gcloud run services logs read helix-gcs2clickhouse-ingestor --region us-west1`
- Verify new files are appearing in `gs://helix-logs/` (Fastly/Cloudflare should be uploading continuously)
- Check that the Pub/Sub subscription `helix-logs-ingestor-sub` has no undelivered message backlog

Processing errors are written to `gs://helix-logs/ingestion-errors/YYYYMMDD/`.

### ClickHouse memory limit exceeded (OOM errors)

**Symptoms:** Dashboard queries fail with `MEMORY_LIMIT_EXCEEDED`.

**Diagnosis:**

```bash
clickhouse client ... --query "
  SELECT metric, round(value / 1024 / 1024 / 1024, 2) as gb
  FROM system.asynchronous_metrics
  WHERE metric IN ('CGroupMemoryTotal', 'CGroupMemoryUsed', 'MemoryResident')"
```

**Resolution:** Increase "Minimum memory per replica" in the ClickHouse Cloud console (64 GB recommended for production).

## License

Apache-2.0