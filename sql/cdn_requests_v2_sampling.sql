-- Sampled tables for progressive facet sampling
-- Created: 2026-02-04
-- Notes:
-- - 10% table TTL: 20 weeks. 1% table TTL: 200 weeks.
-- - IP addresses are withheld in sampled tables.
-- - Drop projections before updating them (projection limit is tight).

-- Create sampled tables with the same schema, projections, and ordering
CREATE TABLE IF NOT EXISTS helix_logs_production.cdn_requests_v2_sampled_10
AS helix_logs_production.cdn_requests_v2;

CREATE TABLE IF NOT EXISTS helix_logs_production.cdn_requests_v2_sampled_1
AS helix_logs_production.cdn_requests_v2;

-- Extend TTLs for sampled retention
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  MODIFY TTL timestamp + toIntervalWeek(20);

ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  MODIFY TTL timestamp + toIntervalWeek(200);

-- Ensure the logpush writer can populate the sampled tables via cascading MVs
GRANT SELECT ON helix_logs_production.cdn_requests_v2 TO logpush_writer;
GRANT INSERT ON helix_logs_production.cdn_requests_v2_sampled_10 TO logpush_writer;
GRANT INSERT ON helix_logs_production.cdn_requests_v2_sampled_1 TO logpush_writer;

-- Drop existing MVs before re-creating
DROP TABLE IF EXISTS helix_logs_production.cdn_requests_v2_sampled_10_mv;
DROP TABLE IF EXISTS helix_logs_production.cdn_requests_v2_sampled_1_mv;

-- Maintain sampled tables via MVs sourced from the primary table
CREATE MATERIALIZED VIEW helix_logs_production.cdn_requests_v2_sampled_10_mv
TO helix_logs_production.cdn_requests_v2_sampled_10
AS SELECT * REPLACE (
  '(withheld)' AS `client.ip`,
  '(withheld)' AS `cdn.originating_ip`,
  '(withheld)' AS `request.headers.x_forwarded_for`,
  '(withheld)' AS `request.headers.cf_connecting_ip`,
  '(withheld)' AS `request.headers.true_client_ip`
)
FROM helix_logs_production.cdn_requests_v2
WHERE (sample_hash % 10) = 0;

CREATE MATERIALIZED VIEW helix_logs_production.cdn_requests_v2_sampled_1_mv
TO helix_logs_production.cdn_requests_v2_sampled_1
AS SELECT * REPLACE (
  '(withheld)' AS `client.ip`,
  '(withheld)' AS `cdn.originating_ip`,
  '(withheld)' AS `request.headers.x_forwarded_for`,
  '(withheld)' AS `request.headers.cf_connecting_ip`,
  '(withheld)' AS `request.headers.true_client_ip`
)
FROM helix_logs_production.cdn_requests_v2
WHERE (sample_hash % 100) = 0;



-- Rebuild projections for sampled tables using coarse (hourly) buckets.
-- Drop projections first to stay within the projection limit.
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_facet_content_length;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_facet_time_elapsed;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_accept;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_accept_encoding;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_asn;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_backend_type;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_byo_cdn;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_cache_control;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_cache_status;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_client_ip;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_content_type;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_datacenter;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_host;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_location;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_method;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_push_invalidation;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_referer;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_request_type;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_status;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_status_range;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_url;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_user_agent;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_x_error;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_x_error_grouped;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_hour_x_forwarded_host;

ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_facet_content_length;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_facet_time_elapsed;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_accept;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_accept_encoding;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_asn;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_backend_type;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_byo_cdn;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_cache_control;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_cache_status;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_client_ip;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_content_type;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_datacenter;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_host;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_location;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_method;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_push_invalidation;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_referer;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_request_type;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_status;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_status_range;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_url;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_user_agent;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_x_error;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_x_error_grouped;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_hour_x_forwarded_host;

ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_facet_content_length (
    SELECT toStartOfHour(timestamp) AS hour, multiIf(`response.headers.content_length` = 0, '0 (empty)', `response.headers.content_length` < 100, '1-100 B', `response.headers.content_length` < 500, '100-500 B', `response.headers.content_length` < 1024, '500 B - 1 KB', `response.headers.content_length` < 5120, '1-5 KB', `response.headers.content_length` < 10240, '5-10 KB', `response.headers.content_length` < 51200, '10-50 KB', `response.headers.content_length` < 102400, '50-100 KB', `response.headers.content_length` < 512000, '100-500 KB', `response.headers.content_length` < 1048576, '500 KB - 1 MB', `response.headers.content_length` < 10485760, '1-10 MB', '> 10 MB') AS content_length_bucket, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, content_length_bucket
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_facet_time_elapsed (
    SELECT toStartOfHour(timestamp) AS hour, multiIf(`cdn.time_elapsed_msec` < 5, '< 5ms', `cdn.time_elapsed_msec` < 10, '5-10ms', `cdn.time_elapsed_msec` < 20, '10-20ms', `cdn.time_elapsed_msec` < 35, '20-35ms', `cdn.time_elapsed_msec` < 50, '35-50ms', `cdn.time_elapsed_msec` < 100, '50-100ms', `cdn.time_elapsed_msec` < 250, '100-250ms', `cdn.time_elapsed_msec` < 500, '250-500ms', `cdn.time_elapsed_msec` < 1000, '500ms - 1s', '>= 1s') AS time_elapsed_bucket, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, time_elapsed_bucket
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_accept (
    SELECT toStartOfHour(timestamp) AS hour, `request.headers.accept`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `request.headers.accept`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_accept_encoding (
    SELECT toStartOfHour(timestamp) AS hour, `request.headers.accept_encoding`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `request.headers.accept_encoding`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_asn (
    SELECT toStartOfHour(timestamp) AS hour, `client.asn`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `client.asn`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_backend_type (
    SELECT toStartOfHour(timestamp) AS hour, `helix.backend_type`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `helix.backend_type`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_byo_cdn (
    SELECT toStartOfHour(timestamp) AS hour, `request.headers.x_byo_cdn_type`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `request.headers.x_byo_cdn_type`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_cache_control (
    SELECT toStartOfHour(timestamp) AS hour, `request.headers.cache_control`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `request.headers.cache_control`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_cache_status (
    SELECT toStartOfHour(timestamp) AS hour, upper(`cdn.cache_status`) AS dim, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx, countIf(upper(`cdn.cache_status`) LIKE 'HIT%') AS summary_cnt GROUP BY hour, dim
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_client_ip (
    SELECT toStartOfHour(timestamp) AS hour, if(`request.headers.x_forwarded_for` != '', `request.headers.x_forwarded_for`, `client.ip`) AS dim, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx, countIf(if(`request.headers.x_forwarded_for` != '', `request.headers.x_forwarded_for`, `client.ip`) LIKE '%:%') AS summary_cnt GROUP BY hour, dim
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_content_type (
    SELECT toStartOfHour(timestamp) AS hour, `response.headers.content_type`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx, sum(`response.headers.content_length`) AS bytes, sumIf(`response.headers.content_length`, `response.status` < 400) AS bytes_ok, sumIf(`response.headers.content_length`, (`response.status` >= 400) AND (`response.status` < 500)) AS bytes_4xx, sumIf(`response.headers.content_length`, `response.status` >= 500) AS bytes_5xx GROUP BY hour, `response.headers.content_type`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_datacenter (
    SELECT toStartOfHour(timestamp) AS hour, `cdn.datacenter`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `cdn.datacenter`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_host (
    SELECT toStartOfHour(timestamp) AS hour, `request.host` AS dim, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx, countIf(`request.host` LIKE '%.aem.live') AS summary_cnt GROUP BY hour, dim
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_location (
    SELECT toStartOfHour(timestamp) AS hour, `response.headers.location`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `response.headers.location`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_method (
    SELECT toStartOfHour(timestamp) AS hour, `request.method` AS dim, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx, countIf(`request.method` IN ('POST', 'PUT', 'PATCH', 'DELETE')) AS summary_cnt GROUP BY hour, dim
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_push_invalidation (
    SELECT toStartOfHour(timestamp) AS hour, `request.headers.x_push_invalidation`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `request.headers.x_push_invalidation`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_referer (
    SELECT toStartOfHour(timestamp) AS hour, `request.headers.referer`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `request.headers.referer`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_request_type (
    SELECT toStartOfHour(timestamp) AS hour, `helix.request_type`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `helix.request_type`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_status (
    SELECT toStartOfHour(timestamp) AS hour, toString(`response.status`) AS dim, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, dim
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_status_range (
    SELECT toStartOfHour(timestamp) AS hour, concat(toString(intDiv(`response.status`, 100)), 'xx') AS dim, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx, countIf(`response.status` >= 500) AS summary_cnt GROUP BY hour, dim
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_url (
    SELECT toStartOfHour(timestamp) AS hour, `request.url`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `request.url`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_user_agent (
    SELECT toStartOfHour(timestamp) AS hour, `request.headers.user_agent` AS dim, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx, countIf((NOT (`request.headers.user_agent` LIKE 'Mozilla/%')) OR (`request.headers.user_agent` LIKE '%+http%')) AS summary_cnt GROUP BY hour, dim
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_x_error (
    SELECT toStartOfHour(timestamp) AS hour, `response.headers.x_error`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `response.headers.x_error`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_x_error_grouped (
    SELECT toStartOfHour(timestamp) AS hour, replaceRegexpAll(`response.headers.x_error`, '/[a-zA-Z0-9/_.-]+', '/...') AS dim, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, dim
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_hour_x_forwarded_host (
    SELECT toStartOfHour(timestamp) AS hour, `request.headers.x_forwarded_host` AS dim, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx, countIf(`request.headers.x_forwarded_host` != '') AS summary_cnt GROUP BY hour, dim
  );

ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_facet_content_length (
    SELECT toStartOfHour(timestamp) AS hour, multiIf(`response.headers.content_length` = 0, '0 (empty)', `response.headers.content_length` < 100, '1-100 B', `response.headers.content_length` < 500, '100-500 B', `response.headers.content_length` < 1024, '500 B - 1 KB', `response.headers.content_length` < 5120, '1-5 KB', `response.headers.content_length` < 10240, '5-10 KB', `response.headers.content_length` < 51200, '10-50 KB', `response.headers.content_length` < 102400, '50-100 KB', `response.headers.content_length` < 512000, '100-500 KB', `response.headers.content_length` < 1048576, '500 KB - 1 MB', `response.headers.content_length` < 10485760, '1-10 MB', '> 10 MB') AS content_length_bucket, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, content_length_bucket
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_facet_time_elapsed (
    SELECT toStartOfHour(timestamp) AS hour, multiIf(`cdn.time_elapsed_msec` < 5, '< 5ms', `cdn.time_elapsed_msec` < 10, '5-10ms', `cdn.time_elapsed_msec` < 20, '10-20ms', `cdn.time_elapsed_msec` < 35, '20-35ms', `cdn.time_elapsed_msec` < 50, '35-50ms', `cdn.time_elapsed_msec` < 100, '50-100ms', `cdn.time_elapsed_msec` < 250, '100-250ms', `cdn.time_elapsed_msec` < 500, '250-500ms', `cdn.time_elapsed_msec` < 1000, '500ms - 1s', '>= 1s') AS time_elapsed_bucket, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, time_elapsed_bucket
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_accept (
    SELECT toStartOfHour(timestamp) AS hour, `request.headers.accept`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `request.headers.accept`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_accept_encoding (
    SELECT toStartOfHour(timestamp) AS hour, `request.headers.accept_encoding`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `request.headers.accept_encoding`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_asn (
    SELECT toStartOfHour(timestamp) AS hour, `client.asn`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `client.asn`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_backend_type (
    SELECT toStartOfHour(timestamp) AS hour, `helix.backend_type`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `helix.backend_type`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_byo_cdn (
    SELECT toStartOfHour(timestamp) AS hour, `request.headers.x_byo_cdn_type`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `request.headers.x_byo_cdn_type`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_cache_control (
    SELECT toStartOfHour(timestamp) AS hour, `request.headers.cache_control`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `request.headers.cache_control`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_cache_status (
    SELECT toStartOfHour(timestamp) AS hour, upper(`cdn.cache_status`) AS dim, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx, countIf(upper(`cdn.cache_status`) LIKE 'HIT%') AS summary_cnt GROUP BY hour, dim
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_client_ip (
    SELECT toStartOfHour(timestamp) AS hour, if(`request.headers.x_forwarded_for` != '', `request.headers.x_forwarded_for`, `client.ip`) AS dim, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx, countIf(if(`request.headers.x_forwarded_for` != '', `request.headers.x_forwarded_for`, `client.ip`) LIKE '%:%') AS summary_cnt GROUP BY hour, dim
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_content_type (
    SELECT toStartOfHour(timestamp) AS hour, `response.headers.content_type`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx, sum(`response.headers.content_length`) AS bytes, sumIf(`response.headers.content_length`, `response.status` < 400) AS bytes_ok, sumIf(`response.headers.content_length`, (`response.status` >= 400) AND (`response.status` < 500)) AS bytes_4xx, sumIf(`response.headers.content_length`, `response.status` >= 500) AS bytes_5xx GROUP BY hour, `response.headers.content_type`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_datacenter (
    SELECT toStartOfHour(timestamp) AS hour, `cdn.datacenter`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `cdn.datacenter`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_host (
    SELECT toStartOfHour(timestamp) AS hour, `request.host` AS dim, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx, countIf(`request.host` LIKE '%.aem.live') AS summary_cnt GROUP BY hour, dim
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_location (
    SELECT toStartOfHour(timestamp) AS hour, `response.headers.location`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `response.headers.location`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_method (
    SELECT toStartOfHour(timestamp) AS hour, `request.method` AS dim, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx, countIf(`request.method` IN ('POST', 'PUT', 'PATCH', 'DELETE')) AS summary_cnt GROUP BY hour, dim
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_push_invalidation (
    SELECT toStartOfHour(timestamp) AS hour, `request.headers.x_push_invalidation`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `request.headers.x_push_invalidation`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_referer (
    SELECT toStartOfHour(timestamp) AS hour, `request.headers.referer`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `request.headers.referer`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_request_type (
    SELECT toStartOfHour(timestamp) AS hour, `helix.request_type`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `helix.request_type`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_status (
    SELECT toStartOfHour(timestamp) AS hour, toString(`response.status`) AS dim, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, dim
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_status_range (
    SELECT toStartOfHour(timestamp) AS hour, concat(toString(intDiv(`response.status`, 100)), 'xx') AS dim, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx, countIf(`response.status` >= 500) AS summary_cnt GROUP BY hour, dim
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_url (
    SELECT toStartOfHour(timestamp) AS hour, `request.url`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `request.url`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_user_agent (
    SELECT toStartOfHour(timestamp) AS hour, `request.headers.user_agent` AS dim, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx, countIf((NOT (`request.headers.user_agent` LIKE 'Mozilla/%')) OR (`request.headers.user_agent` LIKE '%+http%')) AS summary_cnt GROUP BY hour, dim
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_x_error (
    SELECT toStartOfHour(timestamp) AS hour, `response.headers.x_error`, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, `response.headers.x_error`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_x_error_grouped (
    SELECT toStartOfHour(timestamp) AS hour, replaceRegexpAll(`response.headers.x_error`, '/[a-zA-Z0-9/_.-]+', '/...') AS dim, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx GROUP BY hour, dim
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_hour_x_forwarded_host (
    SELECT toStartOfHour(timestamp) AS hour, `request.headers.x_forwarded_host` AS dim, count() AS cnt, countIf(`response.status` < 400) AS cnt_ok, countIf((`response.status` >= 400) AND (`response.status` < 500)) AS cnt_4xx, countIf(`response.status` >= 500) AS cnt_5xx, countIf(`request.headers.x_forwarded_host` != '') AS summary_cnt GROUP BY hour, dim
  );

-- Materialize projections for existing data (runs in background)
-- ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10 MATERIALIZE PROJECTION proj_hour_url;
-- ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1 MATERIALIZE PROJECTION proj_hour_url;

-- Backfill (run once, per day to keep inserts smaller)
-- WARNING: destructive. Only run TRUNCATE during initial setup.
-- TRUNCATE TABLE helix_logs_production.cdn_requests_v2_sampled_10;
-- TRUNCATE TABLE helix_logs_production.cdn_requests_v2_sampled_1;

-- Example per-day backfill (substitute partition date)
-- INSERT INTO helix_logs_production.cdn_requests_v2_sampled_10
-- SELECT * REPLACE (
--   '(withheld)' AS `client.ip`,
--   '(withheld)' AS `cdn.originating_ip`,
--   '(withheld)' AS `request.headers.x_forwarded_for`,
--   '(withheld)' AS `request.headers.cf_connecting_ip`,
--   '(withheld)' AS `request.headers.true_client_ip`
-- )
-- FROM helix_logs_production.cdn_requests_v2
-- WHERE (sample_hash % 10) = 0
--   AND toDate(timestamp) = toDate('2026-02-04');
-- INSERT INTO helix_logs_production.cdn_requests_v2_sampled_1
-- SELECT * REPLACE (
--   '(withheld)' AS `client.ip`,
--   '(withheld)' AS `cdn.originating_ip`,
--   '(withheld)' AS `request.headers.x_forwarded_for`,
--   '(withheld)' AS `request.headers.cf_connecting_ip`,
--   '(withheld)' AS `request.headers.true_client_ip`
-- )
-- FROM helix_logs_production.cdn_requests_v2
-- WHERE (sample_hash % 100) = 0
--   AND toDate(timestamp) = toDate('2026-02-04');
