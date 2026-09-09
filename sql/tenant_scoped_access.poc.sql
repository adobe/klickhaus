-- PROOF OF CONCEPT: tenant-scoped, time-limited read access to CDN logs.
--
-- Goal: let an external party (customer, or a support engineer acting on a
-- customer's behalf) query the log tables through a restricted surface that
-- (a) only ever returns rows belonging to that tenant, (b) hides PII columns,
-- (c) expires on its own, and (d) cannot melt the cluster.
--
-- Mechanism: SQL SECURITY DEFINER views in a separate database. The tenant user
-- gets SELECT on the views only -- never on helix_logs_production.*. The view
-- body runs with `default` privileges, so the filter cannot be bypassed, while
-- currentUser() still resolves to the *calling* tenant user, which is what makes
-- a single shared view self-scoping.
--
-- Deliberately NOT using row policies: per ClickHouse semantics, creating any
-- row policy on a table makes that table policy-gated for *every* user, which
-- would silently blank out the dashboard users and the ingestion MV chain.
-- Views keep the blast radius at zero.
--
-- Run as `default`.

CREATE DATABASE IF NOT EXISTS tenant_poc;

-- ---------------------------------------------------------------------------
-- Grant registry: which ClickHouse user may see which org/site, until when.
-- site = '' means "every site in this org".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_poc.tenant_grants
(
    ch_user  LowCardinality(String),
    org      LowCardinality(String),
    site     String DEFAULT '',
    expires  DateTime,
    granted  DateTime DEFAULT now(),
    reason   String DEFAULT '',
    _version UInt64 DEFAULT toUnixTimestamp64Milli(now64(3))
)
ENGINE = ReplacingMergeTree(_version)
ORDER BY (ch_user, org, site);

-- Effective grants for the calling user. Kept as its own definer view so the
-- scoping logic lives in exactly one place.
CREATE OR REPLACE VIEW tenant_poc.my_grants
DEFINER = default SQL SECURITY DEFINER
AS
SELECT org, site
FROM tenant_poc.tenant_grants FINAL
WHERE ch_user = currentUser() AND expires > now();

-- Directory of observed Helix hosts (<ref>--<site>--<org>.aem.page|.aem.live).
-- Exists purely for query performance: resolving the tenant's hosts to an exact
-- literal set lets ClickHouse prune granules on the (timestamp, request.host)
-- primary key. Deriving org/site from request.host inside the view instead
-- defeats both the primary key and the host skip indexes and costs ~17x the
-- rows read. Refreshed by the statement at the bottom of this file.
CREATE TABLE IF NOT EXISTS tenant_poc.host_dir
(
    host      String,
    org       LowCardinality(String),
    site      String,
    last_seen DateTime
)
ENGINE = ReplacingMergeTree(last_seen)
ORDER BY host;

-- Hosts the calling user may see: observed Helix hosts of their granted sites
-- plus the prod CDN hosts those sites are configured with.
CREATE OR REPLACE VIEW tenant_poc.my_hosts
DEFINER = default SQL SECURITY DEFINER
AS
SELECT host FROM
(
    SELECT d.host AS host, d.org AS org, d.site AS site
    FROM tenant_poc.host_dir AS d
    UNION ALL
    SELECT s.cdn_prod_host AS host, s.org AS org, s.site AS site
    FROM helix_logs_production.site_configs_resolved AS s
    WHERE s.cdn_prod_host != ''
)
WHERE (org, site) IN (SELECT org, site FROM tenant_poc.my_grants WHERE site != '')
   OR org IN (SELECT org FROM tenant_poc.my_grants WHERE site = '');

-- ---------------------------------------------------------------------------
-- delivery: PII columns dropped, rows restricted to the caller's hosts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW tenant_poc.delivery
DEFINER = default SQL SECURITY DEFINER
AS
SELECT
    `timestamp`, `weight`, `request.host`, `request.headers.user_agent`, `source`,
    `cdn.cache_status`, `cdn.cache_ttl`, `cdn.datacenter`, `cdn.is_edge`,
    `cdn.region_code`, `cdn.time_elapsed_msec`, `cdn.version`, `cdn.fastly_error`,
    `client.city_name`, `client.country_name`, `client.name`, `client.asn`,
    `helix.backend_type`, `helix.contentbus_prefix`, `helix.request_type`,
    `request.backend`, `request.body_size`, `request.method`, `request.protocol`,
    `request.url`, `request.is_mixed_case`, `request.restarts`,
    `request.headers.accept`, `request.headers.accept_encoding`,
    `request.headers.accept_language`, `request.headers.cache_control`,
    `request.headers.cdn_loop`, `request.headers.if_match`,
    `request.headers.if_modified_since`, `request.headers.if_none_match`,
    `request.headers.if_unmodified_since`, `request.headers.origin`,
    `request.headers.range`, `request.headers.via`, `request.headers.x_automation`,
    `request.headers.x_byo_cdn_type`, `request.headers.x_forwarded_host`,
    `request.headers.x_push_invalidation`,
    `response.status`, `response.body_size`, `response.headers.cache_control`,
    `response.headers.cache_tag`, `response.headers.cdn_cache_control`,
    `response.headers.cf_resized`, `response.headers.content_encoding`,
    `response.headers.content_length`, `response.headers.content_range`,
    `response.headers.content_type`, `response.headers.edge_cache_tag`,
    `response.headers.edge_control`, `response.headers.etag`,
    `response.headers.expires`, `response.headers.last_modified`,
    `response.headers.location`, `response.headers.surrogate_control`,
    `response.headers.surrogate_key`, `response.headers.vary`,
    `response.headers.x_amz_meta_cache_tag`, `response.headers.x_audit`,
    `response.headers.x_error`, `response.headers.x_rate_limited_rate`,
    `response.headers.x_robots_tag`, `response.headers.x_surrogate_key`,
    `response.headers.x_warning`
FROM helix_logs_production.delivery
WHERE `request.host` IN (SELECT host FROM tenant_poc.my_hosts);

-- ---------------------------------------------------------------------------
-- admin: org/site (api.aem.live) and owner/repo (admin.hlx.page) are columns,
-- so no host parsing needed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW tenant_poc.admin
DEFINER = default SQL SECURITY DEFINER
AS
SELECT
    `timestamp`, `source`, `request.host`, `request.headers.user_agent`,
    `cdn.datacenter`, `cdn.region_code`, `cdn.time_elapsed_msec`,
    `client.city_name`, `client.country_name`, `client.asn`,
    `helix.route`, `helix.owner`, `helix.repo`, `helix.ref`,
    `helix.org`, `helix.site`, `helix.topic`,
    `request.method`, `request.url`, `request.headers.origin`,
    `request.headers.x_forwarded_host`,
    `response.status`, `response.body_size`, `response.headers.content_type`,
    `response.headers.location`, `response.headers.x_error`,
    `response.headers.x_invocation_id`, `response.headers.x_ratelimit_limit`,
    `response.headers.x_ratelimit_rate`, `response.headers.x_severity`
FROM helix_logs_production.admin
WHERE (`helix.org`, `helix.site`) IN (SELECT org, site FROM tenant_poc.my_grants WHERE site != '')
   OR (`helix.owner`, `helix.repo`) IN (SELECT org, site FROM tenant_poc.my_grants WHERE site != '')
   OR `helix.org` IN (SELECT org FROM tenant_poc.my_grants WHERE site = '')
   OR `helix.owner` IN (SELECT org FROM tenant_poc.my_grants WHERE site = '');

-- ---------------------------------------------------------------------------
-- Role, settings profile and quota shared by all tenant users.
-- ---------------------------------------------------------------------------
CREATE ROLE IF NOT EXISTS tenant_selfserve;

-- READONLY on each setting makes that limit non-overridable by the tenant.
--
-- Two settings here are load-bearing for dashboard compatibility:
--   readonly = 2, not 1. The dashboard passes use_query_cache / query_cache_ttl /
--     query_cache_nondeterministic_function_handling as URL parameters on every
--     request, including the SELECT 1 login probe. readonly = 1 rejects all
--     setting changes, so the tenant cannot even sign in. readonly = 2 allows
--     setting changes but still forbids writes and DDL, and the per-setting
--     READONLY markers above continue to block raising the limits.
--   no result_overflow_mode = 'break'. It cannot be combined with
--     use_query_cache (QUERY_CACHE_USED_WITH_NON_THROW_OVERFLOW_MODE), which
--     would fail every dashboard query. max_result_rows alone is enough.
CREATE SETTINGS PROFILE IF NOT EXISTS tenant_selfserve_profile SETTINGS
    max_execution_time = 30 READONLY,
    max_memory_usage = 2000000000 READONLY,
    max_rows_to_read = 20000000000 READONLY,
    max_result_rows = 50000 READONLY,
    max_result_bytes = 100000000 READONLY,
    enable_parallel_replicas = 0 READONLY,
    max_threads = 4 READONLY,
    readonly = 2
TO tenant_selfserve;

CREATE QUOTA IF NOT EXISTS tenant_selfserve_quota KEYED BY user_name
    FOR INTERVAL 1 minute MAX queries = 60, errors = 30
    FOR INTERVAL 1 hour MAX queries = 600, execution_time = 900, read_rows = 100000000000
    TO tenant_selfserve;

GRANT SELECT ON tenant_poc.delivery  TO tenant_selfserve;
GRANT SELECT ON tenant_poc.admin     TO tenant_selfserve;
GRANT SELECT ON tenant_poc.my_grants TO tenant_selfserve;
GRANT SELECT ON tenant_poc.my_hosts  TO tenant_selfserve;

-- Tenant-independent reference data the dashboard needs. Neither carries
-- customer data: asn_dict maps AS numbers to network names, releases mirrors
-- public GitHub release feeds.
GRANT dictGet ON helix_logs_production.asn_dict TO tenant_selfserve;
GRANT SELECT  ON helix_logs_production.releases TO tenant_selfserve;

-- ---------------------------------------------------------------------------
-- host_dir refresh. Reads only the host column over a 2-hour window, so it is
-- cheap enough to run hourly; the overlap covers scheduler jitter.
-- ---------------------------------------------------------------------------
INSERT INTO tenant_poc.host_dir (host, org, site, last_seen)
SELECT
    host,
    splitByString('--', splitByChar('.', host)[1])[3] AS org,
    splitByString('--', splitByChar('.', host)[1])[2] AS site,
    now() AS last_seen
FROM
(
    SELECT DISTINCT `request.host` AS host
    FROM helix_logs_production.delivery
    WHERE timestamp > now() - INTERVAL 2 HOUR
)
WHERE length(splitByString('--', splitByChar('.', host)[1])) = 3;

-- ---------------------------------------------------------------------------
-- Minting a tenant (per request, e.g. from tools.aem.live):
--
--   CREATE USER tenant_<id> IDENTIFIED BY '<generated>'
--     VALID UNTIL '<now + 72h, UTC>' DEFAULT ROLE tenant_selfserve;
--   GRANT tenant_selfserve TO tenant_<id>;
--   INSERT INTO tenant_poc.tenant_grants (ch_user, org, site, expires, reason)
--     VALUES ('tenant_<id>', '<org>', '<site or empty for whole org>',
--             now() + INTERVAL 72 HOUR, '<ticket ref>');
--
-- Revoking early:
--   DROP USER tenant_<id>;
--   ALTER TABLE tenant_poc.tenant_grants DELETE WHERE ch_user = 'tenant_<id>';
--
-- Both expiries are enforced server-side: VALID UNTIL blocks authentication,
-- and an expired grant row makes every view return zero rows.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Dashboard compatibility, as measured against these views.
--
-- Works unchanged: login, time series, log viewer (SELECT * adapts to the
-- reduced column set), host autocomplete, releases overlay, and every
-- breakdown over non-PII columns including the ASN breakdown.
--
-- Needs frontend work:
--   1. js/config.js DATABASE is a single constant, so pointing the UI at the
--      tenant database is a one-line change. sql/queries/releases.sql hardcodes
--      helix_logs_production.releases and should be templated for consistency.
--   2. canUseFacetTable() in js/breakdowns/index.js must return false for
--      tenant sessions. cdn_facet_minutes has no host dimension, so it cannot
--      be tenant-scoped at all, and {{database}}.cdn_facet_minutes does not
--      exist in the tenant database. Falling back to the raw table is cheap
--      here: a single tenant's slice is a few percent of the table.
--   3. Breakdown cards over PII columns (referers, originating IPs, client IPs)
--      fail with UNKNOWN_IDENTIFIER and must be hidden. Whether they should be
--      scrubbed at all is a policy question: a customer is the controller of
--      their own traffic data, a support engineer is not.
-- ---------------------------------------------------------------------------
