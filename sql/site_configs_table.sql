-- Table mirroring Helix site configs from helix-config-bus (S3)
-- Source: helix-ctl config-bus dump JSON, ingested by scripts/import-helix-configs.mjs
-- Future: progressive updates from the S3 change listener
-- Created: 2026-05-21

CREATE TABLE IF NOT EXISTS helix_logs_production.site_configs
(
    org           LowCardinality(String),
    site          String,
    version       UInt32,
    created       DateTime64(3, 'UTC'),
    last_modified DateTime64(3, 'UTC'),
    -- code source
    code_owner       LowCardinality(String),
    code_repo        String,
    code_source_type LowCardinality(String),
    code_source_url  String,
    -- content source
    content_bus_id              String,
    content_source_type         LowCardinality(String),
    content_source_url          String,
    content_source_overlay_type LowCardinality(String),
    content_source_overlay_url  String,
    -- cdn (prod only)
    cdn_prod_host String,
    cdn_prod_type LowCardinality(String),
    -- folders mapping is present and non-empty
    folders  Bool,
    -- profile this site extends (data.extends.profile)
    profile LowCardinality(String),
    -- special JSON fields (handled separately during import)
    features String,
    limits   String,
    _version UInt64 DEFAULT toUnixTimestamp64Milli(now64(3))
)
ENGINE = ReplacingMergeTree(_version)
ORDER BY (org, site)
SETTINGS index_granularity = 8192;
