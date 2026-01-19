-- Table for storing AEM release feed data
-- Source: https://aem-release-feed.david8603.workers.dev/
-- Ingested by GitHub Action every 5 minutes
-- Created: 2026-01-19

CREATE TABLE IF NOT EXISTS helix_logs_production.releases
(
    published DateTime64(3, 'UTC'),
    repo LowCardinality(String),
    tag String,
    url String,
    body String,
    _version UInt64 DEFAULT toUnixTimestamp64Milli(now64(3))  -- Deduplication key
)
ENGINE = ReplacingMergeTree(_version)
ORDER BY (repo, tag)
TTL toDateTime(published) + INTERVAL 2 WEEK
SETTINGS index_granularity = 8192;
