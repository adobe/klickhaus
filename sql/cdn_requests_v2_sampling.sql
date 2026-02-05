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
  DROP PROJECTION IF EXISTS proj_facet_url;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_facet_user_agent;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_facet_referer;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_facet_x_forwarded_host;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_facet_x_error;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_facet_host;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_facet_method;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_facet_datacenter;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_facet_request_type;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_facet_backend_type;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_facet_content_type;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_facet_cache_status;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_facet_client_ip;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_facet_status_range;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_facet_status;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_facet_asn;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  DROP PROJECTION IF EXISTS proj_facet_asn_num;

ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_facet_url;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_facet_user_agent;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_facet_referer;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_facet_x_forwarded_host;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_facet_x_error;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_facet_host;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_facet_method;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_facet_datacenter;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_facet_request_type;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_facet_backend_type;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_facet_content_type;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_facet_cache_status;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_facet_client_ip;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_facet_status_range;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_facet_status;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_facet_asn;
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  DROP PROJECTION IF EXISTS proj_facet_asn_num;

ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_facet_url (
    SELECT
      toStartOfHour(timestamp) as hour,
      `request.url`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `request.url`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_facet_user_agent (
    SELECT
      toStartOfHour(timestamp) as hour,
      `request.headers.user_agent`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `request.headers.user_agent`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_facet_referer (
    SELECT
      toStartOfHour(timestamp) as hour,
      `request.headers.referer`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `request.headers.referer`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_facet_x_forwarded_host (
    SELECT
      toStartOfHour(timestamp) as hour,
      `request.headers.x_forwarded_host`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `request.headers.x_forwarded_host`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_facet_x_error (
    SELECT
      toStartOfHour(timestamp) as hour,
      `response.headers.x_error`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `response.headers.x_error`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_facet_host (
    SELECT
      toStartOfHour(timestamp) as hour,
      `request.host`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `request.host`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_facet_method (
    SELECT
      toStartOfHour(timestamp) as hour,
      `request.method`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `request.method`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_facet_datacenter (
    SELECT
      toStartOfHour(timestamp) as hour,
      `cdn.datacenter`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `cdn.datacenter`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_facet_request_type (
    SELECT
      toStartOfHour(timestamp) as hour,
      `helix.request_type`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `helix.request_type`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_facet_backend_type (
    SELECT
      toStartOfHour(timestamp) as hour,
      `helix.backend_type`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `helix.backend_type`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_facet_content_type (
    SELECT
      toStartOfHour(timestamp) as hour,
      `response.headers.content_type`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `response.headers.content_type`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_facet_cache_status (
    SELECT
      toStartOfHour(timestamp) as hour,
      upper(`cdn.cache_status`) as cache_status,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, cache_status
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_facet_client_ip (
    SELECT
      toStartOfHour(timestamp) as hour,
      if(`request.headers.x_forwarded_for` != '', `request.headers.x_forwarded_for`, `client.ip`) as client_ip,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, client_ip
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_facet_status_range (
    SELECT
      toStartOfHour(timestamp) as hour,
      concat(toString(intDiv(`response.status`, 100)), 'xx') as status_range,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, status_range
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_facet_status (
    SELECT
      toStartOfHour(timestamp) as hour,
      toString(`response.status`) as status,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, status
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_facet_asn (
    SELECT
      toStartOfHour(timestamp) as hour,
      concat(toString(`client.asn`), ' - ', `client.name`) as asn,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, asn
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10
  ADD PROJECTION proj_facet_asn_num (
    SELECT
      toStartOfHour(timestamp) as hour,
      `client.asn` as asn_num,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, asn_num
  );

ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_facet_url (
    SELECT
      toStartOfHour(timestamp) as hour,
      `request.url`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `request.url`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_facet_user_agent (
    SELECT
      toStartOfHour(timestamp) as hour,
      `request.headers.user_agent`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `request.headers.user_agent`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_facet_referer (
    SELECT
      toStartOfHour(timestamp) as hour,
      `request.headers.referer`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `request.headers.referer`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_facet_x_forwarded_host (
    SELECT
      toStartOfHour(timestamp) as hour,
      `request.headers.x_forwarded_host`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `request.headers.x_forwarded_host`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_facet_x_error (
    SELECT
      toStartOfHour(timestamp) as hour,
      `response.headers.x_error`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `response.headers.x_error`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_facet_host (
    SELECT
      toStartOfHour(timestamp) as hour,
      `request.host`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `request.host`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_facet_method (
    SELECT
      toStartOfHour(timestamp) as hour,
      `request.method`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `request.method`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_facet_datacenter (
    SELECT
      toStartOfHour(timestamp) as hour,
      `cdn.datacenter`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `cdn.datacenter`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_facet_request_type (
    SELECT
      toStartOfHour(timestamp) as hour,
      `helix.request_type`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `helix.request_type`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_facet_backend_type (
    SELECT
      toStartOfHour(timestamp) as hour,
      `helix.backend_type`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `helix.backend_type`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_facet_content_type (
    SELECT
      toStartOfHour(timestamp) as hour,
      `response.headers.content_type`,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, `response.headers.content_type`
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_facet_cache_status (
    SELECT
      toStartOfHour(timestamp) as hour,
      upper(`cdn.cache_status`) as cache_status,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, cache_status
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_facet_client_ip (
    SELECT
      toStartOfHour(timestamp) as hour,
      if(`request.headers.x_forwarded_for` != '', `request.headers.x_forwarded_for`, `client.ip`) as client_ip,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, client_ip
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_facet_status_range (
    SELECT
      toStartOfHour(timestamp) as hour,
      concat(toString(intDiv(`response.status`, 100)), 'xx') as status_range,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, status_range
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_facet_status (
    SELECT
      toStartOfHour(timestamp) as hour,
      toString(`response.status`) as status,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, status
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_facet_asn (
    SELECT
      toStartOfHour(timestamp) as hour,
      concat(toString(`client.asn`), ' - ', `client.name`) as asn,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, asn
  );
ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1
  ADD PROJECTION proj_facet_asn_num (
    SELECT
      toStartOfHour(timestamp) as hour,
      `client.asn` as asn_num,
      count() as cnt,
      countIf(`response.status` < 400) as cnt_ok,
      countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
      countIf(`response.status` >= 500) as cnt_5xx
    GROUP BY hour, asn_num
  );

-- Materialize projections for existing data (runs in background)
-- ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_10 MATERIALIZE PROJECTION proj_facet_url;
-- ALTER TABLE helix_logs_production.cdn_requests_v2_sampled_1 MATERIALIZE PROJECTION proj_facet_url;

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
