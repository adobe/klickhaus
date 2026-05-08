-- Monitor user that checks alert conditions and creates incidents.
--
-- Run as `default` (admin). Substitute the writer password from the password
-- manager (see README.local.md).

-- ============================================================================
-- alert_monitor
-- ----------------------------------------------------------------------------
-- Used by:
--   - helix-alert-monitor (Cloud Run service for GCS that checks conditions)
--
-- ============================================================================
-- CREATE USER alert_monitor IDENTIFIED BY '<';

GRANT SELECT ON helix_logs_production.lambda_logs TO alert_monitor;