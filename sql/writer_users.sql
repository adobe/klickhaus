-- Writer users for ingestion pipelines.
--
-- These users are managed manually, outside scripts/add-user.mjs (which only
-- creates *read-only* dashboard users). roll-user.mjs rotates passwords but
-- does not touch grants, so rotations are safe.
--
-- This file is the canonical source for *intentional* grants. Real grants in
-- the cluster may have drifted — before applying, diff with:
--   SHOW GRANTS FOR <user>;
--
-- Run as `default` (admin). Substitute the writer password from the password
-- manager (see README.local.md).

-- ============================================================================
-- logpush_writer
-- ----------------------------------------------------------------------------
-- Used by:
--   - Cloudflare Logpush jobs   (HTTPS POST to ClickHouse on each batch)
--   - Fastly HTTP logging       (HTTPS POST to ClickHouse on each batch)
--   - helix-gcs2clickhouse-ingestor (Cloud Run service for GCS → ClickHouse)
--
-- Ingest path: each source inserts into a per-source staging table; chained
-- materialized views fan rows out into delivery / delivery_errors / backend /
-- admin / da. Because chained MVs run in the inserter's security context, this
-- user needs SELECT on `delivery` (the columns that cdn_facet_minutes_mv reads)
-- in addition to the obvious INSERTs.
-- ============================================================================

-- CREATE USER logpush_writer IDENTIFIED BY '<password>';

-- Raw staging tables (one per source):
GRANT SELECT, INSERT ON helix_logs_production.cloudflare_http_requests TO logpush_writer;
GRANT SELECT, INSERT ON helix_logs_production.fastly_logs_incoming2   TO logpush_writer;
-- Per-Fastly-service backend staging tables:
GRANT SELECT, INSERT ON helix_logs_production.fastly_logs_incoming_00QRLuuAsVNvsKgNWYVCbb TO logpush_writer;
GRANT SELECT, INSERT ON helix_logs_production.fastly_logs_incoming_6a6O21m8WoIIVg5cliw7BW TO logpush_writer;
GRANT SELECT, INSERT ON helix_logs_production.fastly_logs_incoming_ItVEMJu5q2pJE3ejseo0W6 TO logpush_writer;
GRANT SELECT, INSERT ON helix_logs_production.fastly_logs_incoming_SIDuP3HxleUgBDR3Gi8T24 TO logpush_writer;
GRANT SELECT, INSERT ON helix_logs_production.fastly_logs_incoming_UDBDj4zfyNdZEpZApUqhL3 TO logpush_writer;
GRANT SELECT, INSERT ON helix_logs_production.fastly_logs_incoming_atG7Eq66bH88LhbNq7Fqq2 TO logpush_writer;
GRANT SELECT, INSERT ON helix_logs_production.fastly_logs_incoming_cHpjIl1WNRu9SFyL1eBSj3 TO logpush_writer;
GRANT SELECT, INSERT ON helix_logs_production.fastly_logs_incoming_s2dVksBUsvEKaaYF13wIh6 TO logpush_writer;

-- Final tables (INSERT for the ingestion MVs, ALTER DELETE for retention jobs):
GRANT INSERT, ALTER DELETE ON helix_logs_production.admin           TO logpush_writer;
GRANT INSERT, ALTER DELETE ON helix_logs_production.backend         TO logpush_writer;
GRANT INSERT             ON helix_logs_production.delivery_errors TO logpush_writer;
GRANT SELECT, INSERT     ON helix_logs_production.da              TO logpush_writer;
GRANT INSERT             ON helix_logs_production.asn_mapping     TO logpush_writer;

-- delivery: INSERT plus ALTER DELETE for retention; SELECT on the specific
-- columns that cdn_facet_minutes_mv reads (chained-MV permission requirement):
GRANT INSERT, ALTER DELETE,
      SELECT(
          timestamp, source, weight,
          `request.method`,
          `request.headers.accept`, `request.headers.accept_encoding`, `request.headers.cache_control`,
          `request.headers.x_byo_cdn_type`,
          `response.status`, `response.headers.content_type`, `response.headers.x_error`,
          `cdn.cache_status`, `cdn.datacenter`,
          `helix.request_type`, `helix.backend_type`, `helix.contentbus_prefix`
      )
ON helix_logs_production.delivery TO logpush_writer;

-- Mutation visibility (so retention jobs can poll progress):
GRANT SELECT ON system.mutations TO logpush_writer;
GRANT SELECT(query, query_id, user) ON system.processes TO logpush_writer;

-- ============================================================================
-- releases_writer
-- ----------------------------------------------------------------------------
-- Used by:
--   - GitHub Action ingesting the AEM release feed → releases
--   - On-call ingestion → oncall_shifts (reads user_shifts to resolve users)
-- ============================================================================

-- CREATE USER releases_writer IDENTIFIED BY '<password>';

GRANT INSERT ON helix_logs_production.releases      TO releases_writer;
GRANT INSERT ON helix_logs_production.oncall_shifts TO releases_writer;
GRANT SELECT ON helix_logs_production.user_shifts   TO releases_writer;
GRANT SELECT(query, query_id, user) ON system.processes TO releases_writer;

-- ============================================================================
-- lambda_logs_writer
-- ----------------------------------------------------------------------------
-- See sql/lambda_logs_tables.sql for the canonical setup. Repeated here for
-- discoverability.
-- ============================================================================

-- CREATE USER lambda_logs_writer IDENTIFIED BY '<password>';

GRANT SELECT, INSERT ON helix_logs_production.lambda_logs_incoming TO lambda_logs_writer;
GRANT INSERT         ON helix_logs_production.lambda_logs          TO lambda_logs_writer;
-- lambda_facet_minutes_mv reads lambda_logs and writes lambda_facet_minutes in the inserter's context:
GRANT SELECT         ON helix_logs_production.lambda_logs          TO lambda_logs_writer;
GRANT INSERT         ON helix_logs_production.lambda_facet_minutes TO lambda_logs_writer;
GRANT SELECT(query, query_id, user) ON system.processes TO lambda_logs_writer;

-- ============================================================================
-- config_writer
-- ----------------------------------------------------------------------------
-- Used by:
--   - scripts/import-helix-configs.mjs  (bulk import from helix-ctl dump)
--   - Future: S3 change listener progressive updates
--
-- ReplacingMergeTree tables — only INSERT needed (deduplication is engine-side).
-- ============================================================================

-- CREATE USER config_writer IDENTIFIED BY '<password>';

GRANT OPTIMIZE, SELECT, INSERT ON helix_logs_production.helix_org_configs     TO config_writer;
GRANT OPTIMIZE, SELECT, INSERT ON helix_logs_production.helix_site_configs    TO config_writer;
GRANT OPTIMIZE, SELECT, INSERT ON helix_logs_production.helix_profile_configs TO config_writer;
GRANT SELECT(query, query_id, user) ON system.processes TO config_writer;
