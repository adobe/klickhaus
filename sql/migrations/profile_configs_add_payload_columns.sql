-- Migration: add payload columns to profile_configs
-- Run once against helix_logs_production to align the live table with profile_configs_table.sql
-- After running, re-import configs via: node scripts/import-helix-configs.mjs <dump>

ALTER TABLE helix_logs_production.profile_configs
  ADD COLUMN IF NOT EXISTS code_owner       LowCardinality(String) DEFAULT '',
  ADD COLUMN IF NOT EXISTS code_repo        String DEFAULT '',
  ADD COLUMN IF NOT EXISTS code_source_type LowCardinality(String) DEFAULT '',
  ADD COLUMN IF NOT EXISTS code_source_url  String DEFAULT '',
  ADD COLUMN IF NOT EXISTS content_bus_id              String DEFAULT '',
  ADD COLUMN IF NOT EXISTS content_source_type         LowCardinality(String) DEFAULT '',
  ADD COLUMN IF NOT EXISTS content_source_url          String DEFAULT '',
  ADD COLUMN IF NOT EXISTS content_source_overlay_type LowCardinality(String) DEFAULT '',
  ADD COLUMN IF NOT EXISTS content_source_overlay_url  String DEFAULT '',
  ADD COLUMN IF NOT EXISTS cdn_prod_host String DEFAULT '',
  ADD COLUMN IF NOT EXISTS cdn_prod_type LowCardinality(String) DEFAULT '',
  ADD COLUMN IF NOT EXISTS folders  Bool DEFAULT false,
  ADD COLUMN IF NOT EXISTS features String DEFAULT '',
  ADD COLUMN IF NOT EXISTS limits   String DEFAULT '';
