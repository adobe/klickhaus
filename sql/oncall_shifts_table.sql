-- Tables for storing oncall shift data from ServiceNow iCal feeds
-- Ingested by GitHub Action every 5 minutes
-- Created: 2026-01-19

-- Lookup table for user iCal URLs
CREATE TABLE IF NOT EXISTS helix_logs_production.user_shifts
(
    user String,
    ical_url String
)
ENGINE = ReplacingMergeTree()
ORDER BY user;

-- Parsed oncall shifts
CREATE TABLE IF NOT EXISTS helix_logs_production.oncall_shifts
(
    user LowCardinality(String),
    shift_start DateTime64(3, 'UTC'),
    shift_end DateTime64(3, 'UTC'),
    summary String,
    uid String,
    _version UInt64 DEFAULT toUnixTimestamp64Milli(now64(3))  -- Deduplication key
)
ENGINE = ReplacingMergeTree(_version)
ORDER BY (user, shift_start)
TTL toDateTime(shift_end) + INTERVAL 2 WEEK;
