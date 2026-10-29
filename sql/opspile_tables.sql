-- opspile messages: one row per message filed by opspile (Slack / Teams / Discord ops inbox)
-- Run against helix_logs_production on ClickHouse Cloud
--
-- Written directly by the opspile Worker (no GCS, like lambda_logs) as
--   INSERT INTO opspile_messages_raw FORMAT JSONEachRow
-- using the opspile_writer user (see sql/writer_users.sql).
--
-- Metadata and classification only: no message text. Each row carries its thread's
-- labels, team, org and facts as they were at the last export, so a thread is re-exported
-- whenever its labels change. ReplacingMergeTree keeps the row with the highest _version
-- (export time, ms); _deleted = 1 tombstones a deleted message. Always read through the
-- opspile_messages view (FINAL), never the raw table.
--
-- facts_* use underscores: dotted Array columns with one prefix (facts.tickets, facts.sites, …)
-- would form a ClickHouse Nested structure, which requires equal array lengths per row.
--
-- Volume is tiny (thousands of rows a day), so FINAL is cheap and there is no facet table.

CREATE TABLE IF NOT EXISTS helix_logs_production.opspile_messages_raw
(
    timestamp              DateTime64(3),                 -- the message's `at`
    source                 LowCardinality(String),        -- slack | teams | discord
    thread                 String,                        -- opspile thread key
    logical_thread         String,                        -- re-threaded group's first thread, '' if none
    message_id             String,
    is_root                UInt8,
    `channel.key`          String,
    `channel.name`         String,
    `channel.kind`         LowCardinality(String),        -- channel | alert
    team                   LowCardinality(String),        -- the team the channel is filed under
    teams                  Array(LowCardinality(String)), -- filed + shared (channel_teams)
    `org.slug`             LowCardinality(String),
    `org.name`             String,
    `org.type`             LowCardinality(String),        -- customer | partner | vendor
    `author.kind`          LowCardinality(String),        -- person | bot | system
    `author.relation`      LowCardinality(String),        -- adobe | partner | customer | bot
    `author.name`          String,
    `author.domain`        LowCardinality(String),
    `author.ops_teams`     Array(LowCardinality(String)),
    edited                 UInt8,
    reactions              UInt16,
    mentions               UInt16,
    attachments            UInt16,
    `thread.title`         String,                        -- Clef / first-line title; no message text
    `thread.root_at`       DateTime64(3),
    `thread.messages`      UInt32,
    `thread.resolved`      UInt8,                         -- resolved by staff, or Clef resolved_p >= 0.5
    `label.next_actor`     LowCardinality(String),        -- us | customer | vendor | nobody | ''
    `label.kind`           LowCardinality(String),        -- incident | security | question | request | alert | other
    `label.urgency`        Float32,                       -- 0..3
    `label.urgency_level`  LowCardinality(String),        -- low | normal | high | critical
    `label.resolved_p`     Float32,
    `label.model`          LowCardinality(String),
    facts_tickets          Array(String),
    facts_sites            Array(String),
    facts_cves             Array(String),
    facts_urls             Array(String),
    facts_problems         Array(String),
    url                    String,                        -- PUBLIC_ORIGIN/inbox?view=personal&t=<thread>
    _version               UInt64,                        -- export time, ms
    _deleted               UInt8                          -- tombstone: message deleted
)
ENGINE = ReplacingMergeTree(_version, _deleted)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (timestamp, thread, message_id)
TTL toDateTime(timestamp) + INTERVAL 18 MONTH;

-- Deduplicated, tombstone-free view. Views run with SQL SECURITY INVOKER (cluster default),
-- so readers need SELECT on both opspile_messages and opspile_messages_raw.
CREATE VIEW IF NOT EXISTS helix_logs_production.opspile_messages AS
SELECT * EXCEPT (_version, _deleted) FROM helix_logs_production.opspile_messages_raw FINAL;
