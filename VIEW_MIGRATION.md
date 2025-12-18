# Coralogix to ClickHouse View Migration

This document tracks the migration of observability views from Coralogix to ClickHouse.

## Overview

We have **92 legacy views** defined in Coralogix (extracted to `hars/views_summary.json`). These views fall into three categories:

1. **CDN logs views** - Can be migrated to `cdn_requests_combined` table
2. **Lambda/Function logs** - Require separate table(s) for AWS Lambda logs
3. **RUM/Analytics views** - Require separate table(s) for Real User Monitoring data

## Migration Status Summary

| Category | Count | Status |
|----------|-------|--------|
| Portable today | 21 | Ready to implement |
| Need additional columns | 44 | Blocked on schema changes |
| Non-CDN (Lambda/RUM/Admin) | 27 | Requires new data sources |

## Views Portable Today

These views use only columns that already exist in `cdn_requests_combined`:

| View ID | Name | Filters | Lucene Query |
|---------|------|---------|--------------|
| 82074 | aem.(live\|page) (Cloudflare origins) | `helix.backend_type=cloudflare`, `cdn.is_edge=true` | |
| 84178 | aem.(live\|page) (leaked preflights) | `cdn.is_edge=true`, `request.restarts=0` | `response.headers.content_type:"application/json"` |
| 84163 | aem.(live\|page) (rate-limited) | `cdn.is_edge=true`, `response.status=429` | |
| 84162 | aem.(live\|page) (rate-limited, dry run) | `cdn.is_edge=true` | `_exists_:response.headers.x_rate_limited_rate` |
| 84172 | aem.(live\|page) (rate-limited, dry run) (max per host rps) | `cdn.is_edge=true` | `_exists_:response.headers.x_rate_limited_rate` |
| 83895 | aem.(live\|page) errors | `cdn.is_edge=true` | `NOT (response.status.numeric:500 AND response.body_size.numeric:72)` |
| 91761 | failed preview | | `admin.route:"preview" AND admin.path:"crontab" AND NOT admin.status:200` |
| 60190 | hlx.live (errors delivered to prod cdn) | `cdn.is_edge=true`, `x_byo_cdn_type IN (akamai,cloudflare,cloudfront,fastly)` | |
| 57704 | hlx.live (long running requests: >5s) | `cdn.is_edge=true` | `cdn.time_elapsed_msec.numeric:[5000 TO *]` |
| 82951 | hlx.live redirects | `cdn.is_edge=true`, `response.status IN (301,302)` | |
| 59702 | hlx.live w/o xfh | `cdn.is_edge=true` | |
| 91762 | job executions | | `admin.route:"preview" AND admin.path:"crontab" AND NOT admin.status:200` |
| 60393 | Leaking /package.json on hlx.page | `cdn.is_edge=true`, `request.url=/package.json`, `response.status=200` | |
| 60184 | publishing-error-rate | `request.backend IN (cloudflareworker,cloudflarer2,awslambda,awss3)` | `request.headers.x_byo_cdn_type.keyword:""` |
| 62524 | Valid Form POST Requests | `request.method=POST`, `response.status=201`, `request.backend IN (...)` | |

### Example ClickHouse Queries for Portable Views

**aem.(live|page) errors** (View ID: 83895)
```sql
SELECT
    timestamp,
    `response.status`,
    `request.method`,
    `request.host`,
    `request.url`,
    `response.headers.x_error`
FROM helix_logs_production.cdn_requests_combined
WHERE timestamp > now() - INTERVAL 1 HOUR
  AND `cdn.is_edge` = true
  AND `response.status` >= 400
  AND NOT (`response.status` = 500 AND `response.body_size` = 72)
ORDER BY timestamp DESC
LIMIT 100
```

**hlx.live (long running requests: >5s)** (View ID: 57704)
```sql
SELECT
    timestamp,
    `response.status`,
    `request.method`,
    `request.host`,
    `request.url`,
    `cdn.time_elapsed_msec`
FROM helix_logs_production.cdn_requests_combined
WHERE timestamp > now() - INTERVAL 1 HOUR
  AND `cdn.is_edge` = true
  AND `cdn.time_elapsed_msec` >= 5000
ORDER BY `cdn.time_elapsed_msec` DESC
LIMIT 100
```

**hlx.live redirects** (View ID: 82951)
```sql
SELECT
    timestamp,
    `response.status`,
    `request.host`,
    `request.url`,
    `response.headers.location`
FROM helix_logs_production.cdn_requests_combined
WHERE timestamp > now() - INTERVAL 1 HOUR
  AND `cdn.is_edge` = true
  AND `response.status` IN (301, 302)
ORDER BY timestamp DESC
LIMIT 100
```

## Views Needing Additional Columns

These views require schema changes to `cdn_requests_combined` before they can be migrated.

### Most-Needed Columns (by frequency)

| Column | Views Blocked | Source | Priority |
|--------|---------------|--------|----------|
| `request.headers.fastly_orig_accept_encoding` | 17 | Fastly logs | High |
| `cdn.originating_ip_geoip.asn.organization` | 13 | Use `asn_dict` lookup | High |
| `request.headers.x_backend_type` | 9 | Fastly logs | High |
| `request.headers.x_abuse_info` | 8 | Fastly logs | Medium |
| `response.headers.x_rate_limited_rate` | 4 | Fastly logs | Medium |
| `helix.route` | 4 | Fastly logs | Medium |
| `helix.owner` | 4 | Fastly logs | Medium |
| `helix.repo` | 4 | Fastly logs | Medium |
| `response.headers.x_audit` | 4 | Fastly logs | Medium |
| `cdn.originating_ip_geoip.ip` | 4 | Already have `cdn.originating_ip` | Low |
| `response.headers.fastly_io_error` | 3 | Fastly logs | Low |
| `helix.org` | 3 | Fastly logs | Low |
| `helix.path` | 3 | Fastly logs | Low |
| `helix.site` | 3 | Fastly logs | Low |
| `cdn.zone_name` | 3 | Cloudflare ZoneName | Low |
| `cdn.request_source` | 3 | Cloudflare ClientRequestSource | Low |
| `helix.rso` | 3 | Fastly logs | Low |
| `helix.scope` | 3 | Fastly logs | Low |
| `response.headers.x_auth_warning` | 3 | Fastly logs | Low |

### Views Blocked by Missing Columns

| View ID | Name | Missing Columns |
|---------|------|-----------------|
| 91892 | api.aem.live | `response.headers.x_invocation_id` |
| 84155 | hlx.live (401s delivered to prod cdn) | `response.headers.x_auth_error` |
| 57703 | hlx.page (long running requests: >5s) | `request.headers.x_backend_type` |
| 83274 | hlx.page (rate-limited) | `request.headers.x_backend_type` |
| 89922 | llms.txt requests on www.aem.live | `cdn.originating_ip_geoip.ip` |
| 65710 | rum-bundler fastly logs | `request.domain` |
| 83273 | hlx.page (rate-limited, dry run) | `response.headers.x_rate_limited_rate`, `request.headers.x_backend_type` |
| 90496 | aem.(live\|page) (long running requests: >5s) | `cdn.originating_ip_geoip.asn.organization`, `request.headers.fastly_orig_accept_encoding` |
| 83288 | hlx.page (rate-limited, dry run) (max per ip rps) | `response.headers.x_rate_limited_rate`, `request.headers.x_backend_type` |
| 57855 | Fastly C@E | `request.headers.user-agent`, `response.headers.x-error` |
| 90153 | LLM on aem.(live\|page) | `cdn.originating_ip_geoip.asn.organization`, `request.headers.fastly_orig_accept_encoding` |
| 90154 | LLM on www.aem.live | `cdn.originating_ip_geoip.asn.organization`, `request.headers.fastly_orig_accept_encoding` |
| 60721 | admin.hlx.page (errors) | `request.headers.x_admin_version`, `response.headers.x_invocation_id` |
| 84405 | aem.(live\|page) audit | `cdn.originating_ip_geoip.asn.organization`, `response.headers.x_audit` |
| 58904 | hlx.page (Cloudflare origins) | `helix.request-type`, `request.headers.x_backend_type` |
| 57548 | sidekick library | `request.headers.user-agent`, `response.headers.x-error` |
| 92296 | Publishing Service (all subsystems) | `request.headers.x_abuse_info`, `cdn.originating_ip_geoip.asn.organization`, `request.headers.fastly_orig_accept_encoding` |
| 92288 | Delivery Service (all subsystems) | `request.headers.x_abuse_info`, `cdn.originating_ip_geoip.asn.organization`, `request.headers.fastly_orig_accept_encoding` |
| 59715 | aem.(live\|page) | `request.headers.x_abuse_info`, `cdn.originating_ip_geoip.asn.organization`, `request.headers.fastly_orig_accept_encoding` |
| 90710 | aem.(live\|page) (new relic traffic) | `request.headers.x_abuse_info`, `cdn.originating_ip_geoip.asn.organization`, `request.headers.fastly_orig_accept_encoding` |
| 60597 | config.aem.page | `helix.rso`, `request.headers.fastly_orig_accept_encoding`, `helix.scope` |
| 90521 | config.aem.page (large response: >1m) | `helix.rso`, `request.headers.fastly_orig_accept_encoding`, `helix.scope` |
| 90732 | config.aem.page (response size by RSO) | `helix.rso`, `request.headers.fastly_orig_accept_encoding`, `helix.scope` |
| 58846 | hlx.page (leaked preflights) | `helix.request-type`, `response.headers.surrogate_key`, `request.headers.x_backend_type` |
| 8928 | hlx.page errors | `cdn.originating_ip_geoip.asn.organization`, `response.headers.fastly_io_error`, `request.headers.x_backend_type` |
| 90850 | www.aem.live | `request.headers.x_abuse_info`, `cdn.originating_ip_geoip.asn.organization`, `request.headers.fastly_orig_accept_encoding` |
| 90495 | pipeline.aem.page (long running requests: >5s) | `helix.org`, `helix.path`, `request.headers.fastly_orig_accept_encoding`, `helix.site` |
| 90522 | config.aem-cloudflare.page (large response: >1m) | `response.headers.cache_tag`, `cdn.zone_name`, `cdn.time.elapsed`, `cdn.request_source` |
| 90445 | Sidekick v6 | `cdn.originating_ip_geoip.ip`, `helix.repo`, `helix.route`, `helix.owner` |
| 90446 | Sidekick v7 | `cdn.originating_ip_geoip.ip`, `helix.repo`, `helix.route`, `helix.owner` |
| 89072 | config.aem-cloudflare.page | `response.headers.cache_tag`, `cdn.zone_name`, `cdn.time.elapsed`, `cdn.request_source` |
| 29302 | hlx.live | `request.headers.x_abuse_info`, `response.headers.x_auth_warning`, `response.headers.x_audit`, `request.headers.fastly_orig_accept_encoding` |
| 90711 | hlx.live (new relic traffic) | `request.headers.x_abuse_info`, `response.headers.x_auth_warning`, `response.headers.x_audit`, `request.headers.fastly_orig_accept_encoding` |
| 89987 | pipeline.aem.page | `helix.org`, `helix.path`, `request.headers.fastly_orig_accept_encoding`, `helix.site` |
| 83530 | static.aem.page | `helix.org`, `helix.path`, `request.headers.fastly_orig_accept_encoding`, `helix.site` |
| 10019 | Cloudflare zone logs | `cdn.originating_ip_geoip.city_name`, `cdn.zone_name`, `cdn.originating_ip_geoip.asn.organization`, `client.number`, `cdn.request_source` |
| 95418 | Sidekick v6 (Safari) | `cdn.originating_ip_geoip.ip`, `helix.route`, `cdn.originating_ip_geoip.city_name`, `helix.owner`, `helix.repo` |
| 84181 | hlx.page (with project creation date) | `response.headers.x_created_date`, `response.headers.x_warning`, `request.headers.x_backend_type`, `cdn.originating_ip_geoip.asn.organization`, `response.headers.x_rate_limited_rate` |
| 91240 | media.aem.page (long running requests: >5s) | `response.headers.fastly_stats`, `response.headers.fastly_io_warning`, `response.headers.fastly_io_error`, `response.headers.fastly_io_info`, `helix.blob_id`, `helix.contentbus_id` |
| 90057 | form.aem.page | `cdn.request.url`, `cdn.request.headers.referer`, `cdn.request.method`, `cdn.response.status`, `cdn.request.backend`, `cdn.response.headers.x_error` |
| 91227 | media.aem.page | `response.headers.fastly_stats`, `response.headers.fastly_io_warning`, `response.headers.fastly_io_error`, `response.headers.fastly_io_info`, `helix.blob_id`, `helix.contentbus_id` |
| 83190 | admin.hlx.page (rate-limited) | `response.headers.x_ratelimit_rate`, `helix.route`, `helix.owner`, `helix.repo`, `helix.ref`, `response.headers.x_retry_after`, `response.headers.x_ratelimit_limit` |
| 29297 | hlx.page | `request.headers.fastly_orig_accept_encoding`, `response.headers.x_warning`, `request.headers.x_backend_type`, `request.headers.x_abuse_info`, `cdn.originating_ip_geoip.asn.organization`, `response.headers.x_audit`, `response.headers.x_auth_warning`, `response.headers.x_rate_limited_rate` |

## Non-CDN Views (Require New Data Sources)

These views use Lambda function logs, RUM data, or other sources not present in `cdn_requests_combined`. They require separate ingestion pipelines.

### Lambda/Function Logs (AWS)

| View ID | Name | Function | Description |
|---------|------|----------|-------------|
| 10497 | admin (lambda) errors | `/helix3/admin/v12` | Admin service errors |
| 9592 | admin (lambda) log (condensed) | `/helix3/admin/v11-v12` | Condensed admin logs |
| 57731 | admin (lambda) purge errors | `/helix3/admin/*` | Cache purge errors |
| 59449 | admin (lambda) request log | `/helix3/admin/*` | Request logs |
| 60169 | admin github rate limit | `/helix3/admin/*` | GitHub API rate limits |
| 59714 | admin-code-sync-jobs | `/helix3/admin/*` | Code sync jobs |
| 60359 | Forms service errors | `/helix3/forms/*` | Forms service errors |
| 10768 | Forms-Handler not empty | `/helix3/forms-handler/*` | Forms handler activity |
| 66599 | Pipeline (Lambda) | `/helix3/pipeline-service/v9-v10` | Pipeline service |
| 10972 | all (indexer) | `/helix3/indexer/v6` | Indexer logs |
| 94268 | indexer latency | `/helix3/indexer/*` | Indexer performance |
| 1861 | helix-bot log | `/helix3/bot/v3` | Helix bot |
| 62542 | helix-bot log (new) | `/helix3/bot/v3` | Helix bot (updated) |
| 55563 | slack-bot-logs | `/helix-services/slack-bot/v4` | Slack integration |
| 5530 | function-logs | Various | Generic Lambda logs |

### RUM (Real User Monitoring)

| View ID | Name | Description |
|---------|------|-------------|
| 59488 | rum data | RUM collector data |
| 74398 | rum data - Alex | Extended RUM view |
| 79940 | RUM Logs Fastly AND Cloudflare | Combined RUM logs |
| 6194 | CWV Log | Core Web Vitals (LCP, CLS, FID, INP) |
| 68412 | rum-bundler aws logs | RUM bundler Lambda |
| 65710 | rum-bundler fastly logs | RUM bundler Fastly |
| 71244 | rum-bundler perf logs | RUM bundler performance |
| 80253 | rum-bundler truncated cf events | Truncated CloudFront events |

### Other Non-CDN Sources

| View ID | Name | Source | Description |
|---------|------|--------|-------------|
| 58734 | OneDrive Operations | OneDrive API | SharePoint/OneDrive operations |
| 10739 | S3 to R2 sync (cron) log | Lambda | S3→R2 sync jobs |
| 66985 | Cloudflare worker logs | Workers Logpush | Worker execution logs |
| 11180 | Cloudflare zone logs (native) | Cloudflare HTTP | Native format (not normalized) |
| 91674 | aem.network (native) | Cloudflare HTTP | aem.network zone native format |

## Recommended Schema Changes

To maximize view portability, add these columns to `cdn_requests_combined`:

### Phase 1: High Impact (enables 30+ views)

```sql
ALTER TABLE helix_logs_production.cdn_requests_combined
ADD COLUMN `request.headers.fastly_orig_accept_encoding` String DEFAULT '' CODEC(ZSTD(1)),
ADD COLUMN `request.headers.x_backend_type` LowCardinality(String) DEFAULT '' CODEC(ZSTD(1)),
ADD COLUMN `request.headers.x_abuse_info` String DEFAULT '' CODEC(ZSTD(1));
```

Note: For `cdn.originating_ip_geoip.asn.organization`, use the existing `asn_dict` dictionary:
```sql
dictGet('helix_logs_production.asn_dict', 'name', `client.asn`) as asn_organization
```

### Phase 2: Medium Impact (enables 15+ views)

```sql
ALTER TABLE helix_logs_production.cdn_requests_combined
ADD COLUMN `response.headers.x_rate_limited_rate` String DEFAULT '' CODEC(ZSTD(1)),
ADD COLUMN `response.headers.x_audit` String DEFAULT '' CODEC(ZSTD(1)),
ADD COLUMN `helix.route` LowCardinality(String) DEFAULT '' CODEC(ZSTD(1)),
ADD COLUMN `helix.owner` String DEFAULT '' CODEC(ZSTD(1)),
ADD COLUMN `helix.repo` String DEFAULT '' CODEC(ZSTD(1));
```

### Phase 3: Lower Impact (enables specialized views)

```sql
ALTER TABLE helix_logs_production.cdn_requests_combined
ADD COLUMN `helix.org` String DEFAULT '' CODEC(ZSTD(1)),
ADD COLUMN `helix.site` String DEFAULT '' CODEC(ZSTD(1)),
ADD COLUMN `helix.path` String DEFAULT '' CODEC(ZSTD(1)),
ADD COLUMN `helix.rso` String DEFAULT '' CODEC(ZSTD(1)),
ADD COLUMN `helix.scope` LowCardinality(String) DEFAULT '' CODEC(ZSTD(1)),
ADD COLUMN `cdn.zone_name` LowCardinality(String) DEFAULT '' CODEC(ZSTD(1)),
ADD COLUMN `cdn.request_source` LowCardinality(String) DEFAULT '' CODEC(ZSTD(1)),
ADD COLUMN `response.headers.x_auth_warning` String DEFAULT '' CODEC(ZSTD(1)),
ADD COLUMN `response.headers.x_auth_error` String DEFAULT '' CODEC(ZSTD(1)),
ADD COLUMN `response.headers.fastly_io_error` String DEFAULT '' CODEC(ZSTD(1)),
ADD COLUMN `response.headers.fastly_io_info` String DEFAULT '' CODEC(ZSTD(1)),
ADD COLUMN `response.headers.x_invocation_id` String DEFAULT '' CODEC(ZSTD(1));
```

## Implementation Approach

1. **Immediate**: Implement the 21 portable views in `index.html` with working ClickHouse queries
2. **Short-term**: Add Phase 1 columns to schema and update materialized views
3. **Medium-term**: Add Phase 2 columns, implement Sidekick and rate-limiting views
4. **Long-term**: Evaluate need for Lambda/RUM log ingestion into ClickHouse

## Files Reference

- `hars/views_summary.json` - Extracted view definitions from Coralogix HAR files
- `index.html` - Dashboard with legacy views section (includes `data-view-id` attributes)
- `CLAUDE.md` - Database schema documentation
