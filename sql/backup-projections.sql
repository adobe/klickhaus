-- Backup of all 25 projections on cdn_requests_v2
-- Created 2026-02-11 before dropping to free memory
-- To restore: run each ALTER TABLE ... ADD PROJECTION, then MATERIALIZE PROJECTION

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_url (
    SELECT toStartOfMinute(timestamp) AS minute, `request.url`,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx
    GROUP BY minute, `request.url`
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_referer (
    SELECT toStartOfMinute(timestamp) AS minute, `request.headers.referer`,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx
    GROUP BY minute, `request.headers.referer`
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_x_error (
    SELECT toStartOfMinute(timestamp) AS minute, `response.headers.x_error`,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx
    GROUP BY minute, `response.headers.x_error`
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_datacenter (
    SELECT toStartOfMinute(timestamp) AS minute, `cdn.datacenter`,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx
    GROUP BY minute, `cdn.datacenter`
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_request_type (
    SELECT toStartOfMinute(timestamp) AS minute, `helix.request_type`,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx
    GROUP BY minute, `helix.request_type`
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_backend_type (
    SELECT toStartOfMinute(timestamp) AS minute, `helix.backend_type`,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx
    GROUP BY minute, `helix.backend_type`
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_content_type (
    SELECT toStartOfMinute(timestamp) AS minute, `response.headers.content_type`,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx,
        sum(`response.headers.content_length`) AS bytes,
        sumIf(`response.headers.content_length`, `response.status` < 400) AS bytes_ok,
        sumIf(`response.headers.content_length`, `response.status` >= 400 AND `response.status` < 500) AS bytes_4xx,
        sumIf(`response.headers.content_length`, `response.status` >= 500) AS bytes_5xx
    GROUP BY minute, `response.headers.content_type`
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_status (
    SELECT toStartOfMinute(timestamp) AS minute, toString(`response.status`) AS dim,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx
    GROUP BY minute, dim
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_asn (
    SELECT toStartOfMinute(timestamp) AS minute, `client.asn`,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx
    GROUP BY minute, `client.asn`
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_accept (
    SELECT toStartOfMinute(timestamp) AS minute, `request.headers.accept`,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx
    GROUP BY minute, `request.headers.accept`
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_accept_encoding (
    SELECT toStartOfMinute(timestamp) AS minute, `request.headers.accept_encoding`,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx
    GROUP BY minute, `request.headers.accept_encoding`
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_cache_control (
    SELECT toStartOfMinute(timestamp) AS minute, `request.headers.cache_control`,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx
    GROUP BY minute, `request.headers.cache_control`
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_byo_cdn (
    SELECT toStartOfMinute(timestamp) AS minute, `request.headers.x_byo_cdn_type`,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx
    GROUP BY minute, `request.headers.x_byo_cdn_type`
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_location (
    SELECT toStartOfMinute(timestamp) AS minute, `response.headers.location`,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx
    GROUP BY minute, `response.headers.location`
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_x_error_grouped (
    SELECT toStartOfMinute(timestamp) AS minute,
        replaceRegexpAll(`response.headers.x_error`, '/[a-zA-Z0-9/_.-]+', '/...') AS dim,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx
    GROUP BY minute, dim
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_user_agent (
    SELECT toStartOfMinute(timestamp) AS minute, `request.headers.user_agent` AS dim,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx,
        countIf(NOT (`request.headers.user_agent` LIKE 'Mozilla/%') OR (`request.headers.user_agent` LIKE '%+http%')) AS summary_cnt
    GROUP BY minute, dim
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_method (
    SELECT toStartOfMinute(timestamp) AS minute, `request.method` AS dim,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx,
        countIf(`request.method` IN ('POST', 'PUT', 'PATCH', 'DELETE')) AS summary_cnt
    GROUP BY minute, dim
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_host (
    SELECT toStartOfMinute(timestamp) AS minute, `request.host` AS dim,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx,
        countIf(`request.host` LIKE '%.aem.live') AS summary_cnt
    GROUP BY minute, dim
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_client_ip (
    SELECT toStartOfMinute(timestamp) AS minute,
        if(`request.headers.x_forwarded_for` != '', `request.headers.x_forwarded_for`, `client.ip`) AS dim,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx,
        countIf(if(`request.headers.x_forwarded_for` != '', `request.headers.x_forwarded_for`, `client.ip`) LIKE '%:%') AS summary_cnt
    GROUP BY minute, dim
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_cache_status (
    SELECT toStartOfMinute(timestamp) AS minute, upper(`cdn.cache_status`) AS dim,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx,
        countIf(upper(`cdn.cache_status`) LIKE 'HIT%') AS summary_cnt
    GROUP BY minute, dim
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_status_range (
    SELECT toStartOfMinute(timestamp) AS minute,
        concat(toString(intDiv(`response.status`, 100)), 'xx') AS dim,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx,
        countIf(`response.status` >= 500) AS summary_cnt
    GROUP BY minute, dim
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_x_forwarded_host (
    SELECT toStartOfMinute(timestamp) AS minute, `request.headers.x_forwarded_host` AS dim,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx,
        countIf(`request.headers.x_forwarded_host` != '') AS summary_cnt
    GROUP BY minute, dim
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_source (
    SELECT toStartOfMinute(timestamp) AS minute, source,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx
    GROUP BY minute, source
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_time_elapsed (
    SELECT toStartOfMinute(timestamp) AS minute, `cdn.time_elapsed_msec`,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx
    GROUP BY minute, `cdn.time_elapsed_msec`
);

ALTER TABLE helix_logs_production.cdn_requests_v2 ADD PROJECTION proj_minute_content_length (
    SELECT toStartOfMinute(timestamp) AS minute, `response.headers.content_length`,
        count() AS cnt, countIf(`response.status` < 400) AS cnt_ok,
        countIf(`response.status` >= 400 AND `response.status` < 500) AS cnt_4xx,
        countIf(`response.status` >= 500) AS cnt_5xx
    GROUP BY minute, `response.headers.content_length`
);

-- After adding projections, materialize each one (run one at a time):
-- ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_url;
-- ALTER TABLE helix_logs_production.cdn_requests_v2 MATERIALIZE PROJECTION proj_minute_referer;
-- ... etc for each projection
