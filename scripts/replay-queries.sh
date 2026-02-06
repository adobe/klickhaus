#!/usr/bin/env bash
#
# Replay ClickHouse dashboard queries against the full cdn_requests_v2 table
# (no sampled tables) to benchmark whether parallel replicas make them fast enough.
#
# Usage:
#   ./scripts/replay-queries.sh [user] [password]
#
# Defaults to the lars read-only user.

set -euo pipefail

CH_USER="${1:-lars}"
CH_PASS="${2:-HEi#Kw7B8#o326QN}"
CH_HOST="s2p5b8wmt5.eastus2.azure.clickhouse.cloud"
CH_URL="https://${CH_HOST}:8443/?max_execution_time=30&timeout_before_checking_execution_speed=0"

# Time range: last 7 days from now
# The queries use toStartOfMinute(timestamp) BETWEEN ... so we replicate that pattern
# but with dynamic values instead of hardcoded timestamps.
TIME_START="now() - INTERVAL 7 DAY"
TIME_END="now()"
FILL_START="toStartOfTenMinutes(${TIME_START})"
FILL_END="toStartOfTenMinutes(${TIME_END})"

# Arrays to collect results for the summary table
declare -a QUERY_NAMES=()
declare -a QUERY_STATUSES=()
declare -a QUERY_TIMES=()

run_query() {
  local name="$1"
  local sql="$2"

  printf "%-45s " "${name}..."
  result=$(curl -s -o /dev/null -w '%{http_code} %{time_total}' \
    --user "${CH_USER}:${CH_PASS}" \
    -d "${sql}" \
    "${CH_URL}")

  http_code=$(echo "$result" | awk '{print $1}')
  time_total=$(echo "$result" | awk '{print $2}')

  if [ "$http_code" = "200" ]; then
    printf "\033[32m%s\033[0m  %ss\n" "$http_code" "$time_total"
  else
    printf "\033[31m%s\033[0m  %ss\n" "$http_code" "$time_total"
  fi

  QUERY_NAMES+=("$name")
  QUERY_STATUSES+=("$http_code")
  QUERY_TIMES+=("$time_total")
}

echo "========================================================================"
echo "ClickHouse Full-Table Query Replay"
echo "========================================================================"
echo "Host:       ${CH_HOST}"
echo "User:       ${CH_USER}"
echo "Time range: now() - 7 days to now()"
echo "Table:      helix_logs_production.cdn_requests_v2 (full, no sampling)"
echo "========================================================================"
echo ""

# ---- Time Series ----

run_query "time-series" \
  "SELECT toStartOfTenMinutes(timestamp) as t, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) GROUP BY t ORDER BY t WITH FILL FROM toStartOfTenMinutes(${TIME_START}) TO toStartOfTenMinutes(${TIME_END}) STEP INTERVAL 10 MINUTE FORMAT JSON"

# ---- SELECT * (logs view) ----

run_query "select-star-logs" \
  "SELECT * FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) ORDER BY timestamp DESC LIMIT 500 FORMAT JSON"

# ---- Breakdown facets ----

run_query "breakdown-url" \
  "SELECT \`request.url\` as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-status" \
  "SELECT toString(\`response.status\`) as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-status-range" \
  "SELECT concat(toString(intDiv(\`response.status\`, 100)), 'xx') as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx, countIf(\`response.status\` >= 500) as summary_cnt FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-cache-status" \
  "SELECT upper(\`cdn.cache_status\`) as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx, countIf(upper(\`cdn.cache_status\`) LIKE 'HIT%') as summary_cnt FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-content-type" \
  "SELECT \`response.headers.content_type\` as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-client-ip" \
  "SELECT if(\`request.headers.x_forwarded_for\` != '', \`request.headers.x_forwarded_for\`, \`client.ip\`) as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx, countIf(if(\`request.headers.x_forwarded_for\` != '', \`request.headers.x_forwarded_for\`, \`client.ip\`) LIKE '%:%') as summary_cnt FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-byo-cdn-type" \
  "SELECT \`request.headers.x_byo_cdn_type\` as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) AND \`request.headers.x_byo_cdn_type\` != '' GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-x-forwarded-host" \
  "SELECT \`request.headers.x_forwarded_host\` as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx, countIf(\`request.headers.x_forwarded_host\` != '') as summary_cnt FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-x-error" \
  "SELECT REGEXP_REPLACE(\`response.headers.x_error\`, '/[a-zA-Z0-9/_.-]+', '/...') as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) AND \`response.headers.x_error\` != '' GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-referer" \
  "SELECT \`request.headers.referer\` as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-accept-encoding" \
  "SELECT \`request.headers.accept_encoding\` as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) AND \`request.headers.accept_encoding\` != '' GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-user-agent" \
  "SELECT \`request.headers.user_agent\` as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx, countIf(NOT \`request.headers.user_agent\` LIKE 'Mozilla/%' OR \`request.headers.user_agent\` LIKE '%+http%') as summary_cnt FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-cache-control" \
  "SELECT \`request.headers.cache_control\` as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) AND \`request.headers.cache_control\` != '' GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-asn" \
  "SELECT concat(toString(\`client.asn\`), ' ', dictGet('helix_logs_production.asn_dict', 'name', \`client.asn\`)) as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) AND \`client.asn\` != 0 GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-time-elapsed" \
  "SELECT multiIf(\`cdn.time_elapsed_msec\` < 1, '< 1ms', \`cdn.time_elapsed_msec\` < 50, '1ms-50ms', \`cdn.time_elapsed_msec\` < 1500, '50ms-1.5s', \`cdn.time_elapsed_msec\` < 60000, '1.5s-60s', '\xe2\x89\xa5 60s') as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx, countIf(\`cdn.time_elapsed_msec\` >= 1000) as summary_cnt FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) GROUP BY dim WITH TOTALS ORDER BY min(\`cdn.time_elapsed_msec\`) LIMIT 5 FORMAT JSON"

run_query "breakdown-accept" \
  "SELECT \`request.headers.accept\` as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) AND \`request.headers.accept\` != '' GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-x-push-invalidation" \
  "SELECT \`request.headers.x_push_invalidation\` as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) AND \`request.headers.x_push_invalidation\` != '' GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-datacenter" \
  "SELECT \`cdn.datacenter\` as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-request-type" \
  "SELECT \`helix.request_type\` as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) AND \`helix.request_type\` != '' GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-method" \
  "SELECT \`request.method\` as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx, countIf(\`request.method\` IN ('POST', 'PUT', 'PATCH', 'DELETE')) as summary_cnt FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-content-length" \
  "SELECT multiIf(\`response.headers.content_length\` = 0, '0 (empty)', \`response.headers.content_length\` < 10, '1 B-10 B', \`response.headers.content_length\` < 50000, '10 B-50 KB', \`response.headers.content_length\` < 100000000, '50 KB-100 MB', '\xe2\x89\xa5 100 MB') as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) GROUP BY dim WITH TOTALS ORDER BY min(\`response.headers.content_length\`) LIMIT 5 FORMAT JSON"

run_query "breakdown-host" \
  "SELECT \`request.host\` as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx, countIf(\`request.host\` LIKE '%.aem.live') as summary_cnt FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-location" \
  "SELECT \`response.headers.location\` as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) AND \`response.headers.location\` != '' GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-backend-type" \
  "SELECT \`helix.backend_type\` as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

run_query "breakdown-source" \
  "SELECT \`source\` as dim, count() as cnt, countIf(\`response.status\` < 400) as cnt_ok, countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx, countIf(\`response.status\` >= 500) as cnt_5xx, countIf(\`source\` = 'fastly') as summary_cnt FROM helix_logs_production.cdn_requests_v2 WHERE toStartOfMinute(timestamp) BETWEEN toStartOfMinute(${TIME_START}) AND toStartOfMinute(${TIME_END}) GROUP BY dim WITH TOTALS ORDER BY cnt DESC LIMIT 5 FORMAT JSON"

# ---- Summary ----

echo ""
echo "========================================================================"
echo "SUMMARY"
echo "========================================================================"
printf "%-40s  %s  %s\n" "Query" "Status" "Time"
printf "%-40s  %s  %s\n" "----------------------------------------" "------" "----------"

total_time=0
failures=0
for i in "${!QUERY_NAMES[@]}"; do
  status="${QUERY_STATUSES[$i]}"
  time="${QUERY_TIMES[$i]}"
  if [ "$status" = "200" ]; then
    status_display="\033[32m${status}\033[0m"
  else
    status_display="\033[31m${status}\033[0m"
    failures=$((failures + 1))
  fi
  printf "%-40s  ${status_display}    %ss\n" "${QUERY_NAMES[$i]}" "${time}"
  total_time=$(echo "$total_time + $time" | bc)
done

echo "------------------------------------------------------------------------"
printf "%-40s         %ss\n" "TOTAL (${#QUERY_NAMES[@]} queries, ${failures} failures)" "$total_time"
echo "========================================================================"
