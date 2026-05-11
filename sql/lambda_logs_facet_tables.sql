-- Lambda Logs facet pre-aggregation: table and materialized view
-- Run against helix_logs_production on ClickHouse Cloud after lambda_logs_tables.sql

-- Pre-aggregation table: one row per (minute, facet, dim), same shape as cdn_facet_minutes
CREATE TABLE IF NOT EXISTS helix_logs_production.lambda_facet_minutes
(
    `minute`  DateTime,
    `facet`   LowCardinality(String),
    `dim`     String,
    `cnt`     UInt64,
    `cnt_ok`  UInt64,
    `cnt_4xx` UInt64,
    `cnt_5xx` UInt64
) ENGINE = SummingMergeTree
PARTITION BY toDate(minute)
ORDER BY (facet, minute, dim)
TTL minute + toIntervalDay(14);

-- Materialized view: fans each lambda_logs row into 7 facet rows via ARRAY JOIN.
-- Facets covered: level, function_name (version stripped), function_version,
--   app_name, subsystem, log_group, admin_method (from message_json).
-- High-cardinality facets (message, request_id, urls, paths, ips, emails)
--   are excluded and always query the raw table.
CREATE MATERIALIZED VIEW IF NOT EXISTS helix_logs_production.lambda_facet_minutes_mv
TO helix_logs_production.lambda_facet_minutes
AS SELECT
    toStartOfMinute(timestamp) AS minute,
    facet,
    dim,
    count()                                              AS cnt,
    countIf(lower(level) NOT IN ('error', 'warn', 'warning')) AS cnt_ok,
    countIf(lower(level) IN ('warn', 'warning'))         AS cnt_4xx,
    countIf(lower(level) = 'error')                      AS cnt_5xx
FROM helix_logs_production.lambda_logs
ARRAY JOIN
    [
        'level',
        'function_name',
        'function_version',
        'app_name',
        'subsystem',
        'log_group',
        'admin_method'
    ] AS facet,
    [
        toString(`level`),
        replaceRegexpOne(`function_name`, '/[^/]+$', ''),
        arrayElement(splitByChar('/', `function_name`), -1),
        toString(`app_name`),
        toString(`subsystem`),
        toString(`log_group`),
        CAST(`message_json`.`admin`.`method`, 'String')
    ] AS dim
GROUP BY minute, facet, dim;

-- Grant SELECT to all existing read-only dashboard users.
-- Run this after creating the table for the first time.
-- New users get access automatically via scripts/add-user.mjs.
-- GRANT SELECT ON helix_logs_production.lambda_facet_minutes TO <username>;
