# Tech Stack Migration

This migration transforms the "Backend Types" facet into a "Tech Stack" facet by computing the value at ingestion time in materialized views.

## Overview

The `helix.backend_type` column is repurposed to hold categorized tech stack values instead of raw backend types like 'aws' or 'cloudflare'.

### New Categories

| Category | Source | Description |
|----------|--------|-------------|
| **Fastly / AWS** | fastly_ingestion_v2 | Requests with AWS backend |
| **Fastly / Cloudflare** | fastly_ingestion_v2 | Requests with Cloudflare backend |
| **Fastly / Image Optimizer** | fastly_ingestion_media_v2 | Media service requests |
| **Fastly / Admin** | fastly_ingestion_admin_v2 | Admin service requests |
| **Fastly / API** | fastly_ingestion_api_v2 | API service requests |
| **Fastly / Config** | fastly_ingestion_config_v2 | Config service requests |
| **Fastly / Pipeline** | fastly_ingestion_pipeline_v2 | Pipeline service requests |
| **Fastly / Static** | fastly_ingestion_static_v2 | Static service requests |
| **Fastly / WWW** | fastly_ingestion_www_v2 | WWW service requests |
| **Fastly / Forms** | fastly_ingestion_form_v2 | Forms service requests |
| **Cloudflare / R2** | cloudflare_http_ingestion_v2 | R2 storage requests |
| **Cloudflare / DA** | cloudflare_http_ingestion_v2 | Document Authoring (da.live) |
| **Cloudflare / Helix** | cloudflare_http_ingestion_v2 | Edge Delivery (aem.network) |
| **Cloudflare / Workers** | cloudflare_http_ingestion_v2 | Standard CF workers |

## Migration Steps

### 1. Run MV Migration Scripts

Execute scripts in order during a low-traffic window:

```bash
# Connect to ClickHouse
clickhouse client --host s2p5b8wmt5.eastus2.azure.clickhouse.cloud \
  --user default --password '<password>' --secure

# Run each script in order
cat sql/tech-stack-migration/01-cloudflare-http-ingestion.sql | clickhouse-client ...
cat sql/tech-stack-migration/02-fastly-ingestion.sql | clickhouse-client ...
# ... continue for all 10 scripts
```

Or run them all at once:

```bash
for f in sql/tech-stack-migration/[0-9]*.sql; do
  echo "Running $f..."
  clickhouse client --host s2p5b8wmt5.eastus2.azure.clickhouse.cloud \
    --user default --password '<password>' --secure \
    --multiquery < "$f"
done
```

### 2. Deploy Frontend Changes

The following files have been updated:
- `dashboard.html` - Facet heading changed to "Tech Stack"
- `js/breakdowns/definitions.js` - Facet ID updated, extraFilter removed
- `js/facet-palette.js` - Aliases updated for search
- `js/colors/definitions.js` - Color rules for new categories
- `css/variables.css` - CSS variables for tech stack colors
- `js/columns.js` - Label updated to "Tech Stack"

### 3. Verify

After migration, verify new data is being ingested with new values:

```sql
SELECT `helix.backend_type`, count()
FROM helix_logs_production.cdn_requests_v2
WHERE timestamp > now() - INTERVAL 5 MINUTE
GROUP BY `helix.backend_type`
ORDER BY count() DESC;
```

## Historical Data

Existing data will retain old values ('aws', 'cloudflare', 'cloudflare (implied)', '').
The frontend color rules include fallbacks for these legacy values.

To identify historical vs new data:
- New data: Values contain ' / ' (e.g., 'Fastly / AWS')
- Historical data: Simple values ('aws', 'cloudflare', '')

## Rollback

To rollback, restore the original MV definitions from the database backup or git history.
The frontend changes can be reverted via git.

## Projection

The existing `proj_minute_backend_type` projection will continue to work with new values.
No changes required - it aggregates on whatever values are in the column.
