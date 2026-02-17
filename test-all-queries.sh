#!/bin/bash
# Test all query types against Coralogix API

set -e

echo "========================================="
echo "🧪 Testing All Coralogix Data Prime Queries"
echo "========================================="
echo ""

# Login and get token
echo "🔐 Logging in to Coralogix..."
TOKEN=$(curl -X POST https://api.coralogix.com/api/v1/user/login \
  -H 'Content-Type: application/json' \
  -H 'testtoken: f11a30f5-6df2-4b5d-842b-62034fb07482' \
  -d '{"username":"yoni@coralogix.com","password":"Verint1!"}' \
  -s | jq -r '.token')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "❌ Login failed"
  exit 1
fi

echo "✅ Login successful"
echo ""

NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
ONE_HOUR_AGO=$(date -u -v-1H +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u -d '1 hour ago' +"%Y-%m-%dT%H:%M:%S.000Z")

PASSED=0
FAILED=0

# Function to test a query
test_query() {
  local NAME="$1"
  local QUERY="$2"

  echo "📊 Testing: $NAME"

  RESPONSE=$(jq -n --arg query "$QUERY" \
    '{query: $query, metadata: {syntax: "QUERY_SYNTAX_DATAPRIME", tier: "TIER_ARCHIVE"}}' | \
    curl -X POST https://api.coralogix.com/api/v1/dataprime/query \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $TOKEN" \
      -H 'CGX-Team-Id: 7667' \
      -d @- \
      -s -w '\nHTTP_STATUS:%{http_code}')

  HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
  BODY=$(echo "$RESPONSE" | grep -v "HTTP_STATUS")

  if [ "$HTTP_CODE" = "200" ]; then
    echo "  ✅ PASSED (200 OK)"
    PASSED=$((PASSED + 1))
  else
    echo "  ❌ FAILED (HTTP $HTTP_CODE)"
    echo "$BODY" | head -5
    FAILED=$((FAILED + 1))
  fi
  echo ""
}

# Test 1: Time-series chart query
test_query "Time-Series Chart" \
  "source logs | filter \$m.timestamp >= @'${ONE_HOUR_AGO}' && \$m.timestamp <= @'${NOW}' | groupby \$m.timestamp/10m as t aggregate count() as total, count(\$d.response.status:num < 400) as cnt_ok, count(\$d.response.status:num >= 400 && \$d.response.status:num < 500) as cnt_4xx, count(\$d.response.status:num >= 500) as cnt_5xx | orderby t asc"

# Test 2: Simple facet (host)
test_query "Facet: Host" \
  "source logs | filter \$m.timestamp >= @'${ONE_HOUR_AGO}' && \$m.timestamp <= @'${NOW}' | groupby \$d.request.host as dim aggregate count() as cnt, count(\$d.response.status:num < 400) as cnt_ok, count(\$d.response.status:num >= 400 && \$d.response.status:num < 500) as cnt_4xx, count(\$d.response.status:num >= 500) as cnt_5xx | orderby cnt desc | limit 10"

# Test 3: Status range (complex expression)
test_query "Facet: Status Range" \
  "source logs | filter \$m.timestamp >= @'${ONE_HOUR_AGO}' && \$m.timestamp <= @'${NOW}' | groupby \$d.response.status:num / 100 as dim aggregate count() as cnt, count(\$d.response.status:num < 400) as cnt_ok, count(\$d.response.status:num >= 400 && \$d.response.status:num < 500) as cnt_4xx, count(\$d.response.status:num >= 500) as cnt_5xx | orderby cnt desc | limit 10"

# Test 4: Status (toString)
test_query "Facet: Status" \
  "source logs | filter \$m.timestamp >= @'${ONE_HOUR_AGO}' && \$m.timestamp <= @'${NOW}' | groupby \$d.response.status:string as dim aggregate count() as cnt, count(\$d.response.status:num < 400) as cnt_ok, count(\$d.response.status:num >= 400 && \$d.response.status:num < 500) as cnt_4xx, count(\$d.response.status:num >= 500) as cnt_5xx | orderby cnt desc | limit 10"

# Test 5: Cache status (no upper, Data Prime doesn't support it)
test_query "Facet: Cache Status" \
  "source logs | filter \$m.timestamp >= @'${ONE_HOUR_AGO}' && \$m.timestamp <= @'${NOW}' | groupby \$d.cdn.cache_status as dim aggregate count() as cnt, count(\$d.response.status:num < 400) as cnt_ok, count(\$d.response.status:num >= 400 && \$d.response.status:num < 500) as cnt_4xx, count(\$d.response.status:num >= 500) as cnt_5xx | orderby cnt desc | limit 10"

# Test 6: Logs view
test_query "Logs View" \
  "source logs | filter \$m.timestamp >= @'${ONE_HOUR_AGO}' && \$m.timestamp <= @'${NOW}' | limit 50"

echo "========================================="
echo "📊 Test Results"
echo "========================================="
echo "✅ Passed: $PASSED"
echo "❌ Failed: $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
  echo "🎉 All tests passed!"
  exit 0
else
  echo "⚠️  Some tests failed"
  exit 1
fi
