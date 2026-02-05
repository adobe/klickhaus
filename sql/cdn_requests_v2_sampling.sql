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
