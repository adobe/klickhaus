-- Table mirroring Helix profile configs from helix-config-bus (S3)
-- Source: helix-ctl config-bus dump JSON, ingested by scripts/import-helix-configs.mjs
-- Future: progressive updates from the S3 change listener
-- Created: 2026-05-21

CREATE TABLE IF NOT EXISTS helix_logs_production.helix_profile_configs
(
    org     LowCardinality(String),
    profile String,
    version       UInt32,
    created       DateTime64(3, 'UTC'),
    last_modified DateTime64(3, 'UTC'),
    _version UInt64 DEFAULT toUnixTimestamp64Milli(now64(3))  -- Deduplication key
)
ENGINE = ReplacingMergeTree(_version)
ORDER BY (org, profile)
SETTINGS index_granularity = 8192;
