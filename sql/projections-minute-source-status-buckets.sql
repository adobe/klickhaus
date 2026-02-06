-- Drop old projections with mismatched bucket boundaries
ALTER TABLE helix_logs_production.cdn_requests_v2 DROP PROJECTION IF EXISTS proj_facet_time_elapsed;
ALTER TABLE helix_logs_production.cdn_requests_v2 DROP PROJECTION IF EXISTS proj_facet_content_length;
-- Drop least-used projection to free slot (25 projection limit)
ALTER TABLE helix_logs_production.cdn_requests_v2 DROP PROJECTION IF EXISTS proj_minute_push_invalidation;

-- Projection: source (only 2 values: 'cloudflare', 'fastly')
ALTER TABLE helix_logs_production.cdn_requests_v2
ADD PROJECTION proj_minute_source (
    SELECT
        toStartOfMinute(timestamp) as minute,
        `source`,
        count() as cnt,
        countIf(`response.status` < 400) as cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
        countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY minute, `source`
);

-- proj_minute_status already exists (toString wrapping matches facetCol)
-- It was not materialized; MATERIALIZE PROJECTION run to backfill.

-- Projection: time elapsed (raw ms value for two-level bucketed queries)
ALTER TABLE helix_logs_production.cdn_requests_v2
ADD PROJECTION proj_minute_time_elapsed (
    SELECT
        toStartOfMinute(timestamp) as minute,
        `cdn.time_elapsed_msec`,
        count() as cnt,
        countIf(`response.status` < 400) as cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
        countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY minute, `cdn.time_elapsed_msec`
);

-- Projection: content length (raw byte value for two-level bucketed queries)
ALTER TABLE helix_logs_production.cdn_requests_v2
ADD PROJECTION proj_minute_content_length (
    SELECT
        toStartOfMinute(timestamp) as minute,
        `response.headers.content_length`,
        count() as cnt,
        countIf(`response.status` < 400) as cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
        countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY minute, `response.headers.content_length`
);

-- Materialize ALL projections (they were all missing backfill for existing parts)
-- Run these one at a time; each is a background mutation
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_source;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_time_elapsed;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_content_length;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_status;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_host;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_status_range;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_url;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_referer;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_x_error;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_x_error_grouped;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_x_forwarded_host;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_user_agent;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_client_ip;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_cache_status;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_content_type;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_datacenter;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_method;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_request_type;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_backend_type;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_asn;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_accept;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_accept_encoding;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_cache_control;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_byo_cdn;
ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_location;
