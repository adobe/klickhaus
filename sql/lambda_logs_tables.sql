-- Lambda Logs: staging table, final table, materialized view, and user
-- Run against helix_logs_production on ClickHouse Cloud

-- Staging table: receives inserts from the Lambda feeder, TTL 1 day
CREATE TABLE IF NOT EXISTS helix_logs_production.lambda_logs_incoming
(
    `timestamp`     DateTime64(3),
    `level`         LowCardinality(String),
    `message`       String,
    `request_id`    String,
    `function_name` String,
    `app_name`      LowCardinality(String),
    `subsystem`     LowCardinality(String),
    `log_stream`    String,
    `log_group`     String
)
ENGINE = MergeTree
ORDER BY (timestamp, function_name)
TTL toDateTime(timestamp) + INTERVAL 1 DAY;

-- Final table: queryable logs with skip indexes, TTL 2 weeks
--
-- message_json (JSON type) is auto-populated from message by the MV below.
-- Query JSON fields directly: message_json.admin.method, message_json.onedrive.status, etc.
-- Known top-level keys: admin, onedrive, metric, indexer, discover, csrf
--
-- Extraction columns (Array(String)) are regex-populated from message text:
--   urls       — full URLs (https?://...)
--   paths      — path-like strings (/foo/bar)
--   hostnames  — FQDN patterns (foo.bar.com)
--   emails     — email addresses
--   ips        — IPv4 addresses
--   refs       — AEM ref--repo--owner triples (main--site--org)
CREATE TABLE IF NOT EXISTS helix_logs_production.lambda_logs
(
    `timestamp`     DateTime64(3),
    `level`         LowCardinality(String),
    `message`       String,
    `message_json`  JSON,
    `request_id`    String,
    `function_name` String,
    `app_name`      LowCardinality(String),
    `subsystem`     LowCardinality(String),
    `log_stream`    String,
    `log_group`     String,
    `urls`          Array(String),
    `paths`         Array(String),
    `hostnames`     Array(String),
    `emails`        Array(String),
    `ips`           Array(String),
    `refs`          Array(String),

    INDEX idx_request_id request_id TYPE bloom_filter GRANULARITY 4,
    INDEX idx_level level TYPE set(10) GRANULARITY 4,
    INDEX idx_message message TYPE ngrambf_v1(4, 1024, 3, 0) GRANULARITY 4,
    INDEX idx_urls urls TYPE bloom_filter GRANULARITY 4,
    INDEX idx_hostnames hostnames TYPE bloom_filter GRANULARITY 4,
    INDEX idx_emails emails TYPE bloom_filter GRANULARITY 4,
    INDEX idx_ips ips TYPE bloom_filter GRANULARITY 4,
    INDEX idx_refs refs TYPE bloom_filter GRANULARITY 4
)
ENGINE = MergeTree
ORDER BY (timestamp, function_name)
TTL toDateTime(timestamp) + INTERVAL 2 WEEK;

-- Materialized view: parses JSON + extracts entities from message text.
-- Plain text messages and Python-style dicts (single quotes) get an empty JSON object.
CREATE MATERIALIZED VIEW IF NOT EXISTS helix_logs_production.lambda_logs_ingestion
TO helix_logs_production.lambda_logs
AS SELECT
    timestamp,
    level,
    message,
    if(isValidJSON(message), message, '{}')::JSON                              AS message_json,
    request_id,
    function_name,
    app_name,
    subsystem,
    log_stream,
    log_group,
    extractAll(message, 'https?://[^\s''"}>\\\\]+')                            AS urls,
    extractAll(message, '/[a-zA-Z0-9._%-]+(?:/[a-zA-Z0-9._%-]+)+')            AS paths,
    extractAll(message, '[a-zA-Z0-9-]+\\.[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}')      AS hostnames,
    extractAll(message, '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}')    AS emails,
    extractAll(message, '\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b')    AS ips,
    extractAll(message, '[a-zA-Z0-9_-]+--[a-zA-Z0-9_-]+--[a-zA-Z0-9_-]+')     AS refs
FROM helix_logs_production.lambda_logs_incoming;

-- Per-minute facet rollup: SummingMergeTree fed by the MV below.
-- Mirrors cdn_facet_minutes (delivery dashboard); used by the Lambda Logs dashboard
-- to serve low-cardinality breakdowns without scanning lambda_logs directly.
CREATE TABLE IF NOT EXISTS helix_logs_production.lambda_facet_minutes
(
    `minute` DateTime,
    `facet`  LowCardinality(String),
    `dim`    String,
    `cnt`    UInt64,
    `cnt_ok`  UInt64,
    `cnt_4xx` UInt64,
    `cnt_5xx` UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toDate(minute)
ORDER BY (facet, minute, dim)
TTL minute + toIntervalDay(14);

-- Materialized view: ARRAY JOINs each lambda_logs row into 7 facet entries
-- (level, function_name, function_version, app_name, subsystem, log_group, admin_method)
-- and pre-aggregates per minute.
--
-- IMPORTANT: This MV is chained off lambda_logs, which is itself written by the
-- lambda_logs_ingestion MV from lambda_logs_incoming. Chained MVs run in the
-- inserter's security context, so lambda_logs_writer must have SELECT on
-- lambda_logs (see GRANT block below) — without it, every insert into
-- lambda_logs_incoming fails with ACCESS_DENIED.
CREATE MATERIALIZED VIEW IF NOT EXISTS helix_logs_production.lambda_facet_minutes_mv
TO helix_logs_production.lambda_facet_minutes
AS SELECT
    toStartOfMinute(timestamp) AS minute,
    facet,
    dim,
    count()                                                  AS cnt,
    countIf(lower(level) NOT IN ('error', 'warn', 'warning')) AS cnt_ok,
    countIf(lower(level) IN ('warn', 'warning'))             AS cnt_4xx,
    countIf(lower(level) = 'error')                          AS cnt_5xx
FROM helix_logs_production.lambda_logs
ARRAY JOIN
    ['level', 'function_name', 'function_version', 'app_name', 'subsystem', 'log_group', 'admin_method'] AS facet,
    [
        toString(level),
        replaceRegexpOne(function_name, '/[^/]+$', ''),
        arrayElement(splitByChar('/', function_name), -1),
        toString(app_name),
        toString(subsystem),
        toString(log_group),
        CAST(message_json.admin.method, 'String')
    ] AS dim
GROUP BY minute, facet, dim;

-- Writer user (set password before running)
-- CREATE USER lambda_logs_writer IDENTIFIED BY '<password>';
-- GRANT SELECT, INSERT ON helix_logs_production.lambda_logs_incoming TO lambda_logs_writer;
-- GRANT INSERT ON helix_logs_production.lambda_logs TO lambda_logs_writer;
-- -- Required because lambda_facet_minutes_mv reads lambda_logs in the inserter's context:
-- GRANT SELECT ON helix_logs_production.lambda_logs TO lambda_logs_writer;
