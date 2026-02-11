SELECT
  dim,
  sum(cnt) as cnt,
  sum(cnt_ok) as cnt_ok,
  sum(cnt_4xx) as cnt_4xx,
  sum(cnt_5xx) as cnt_5xx{{summaryCol}}
FROM (
  SELECT dim, cnt, cnt_ok, cnt_4xx, cnt_5xx{{innerSummaryCol}}
  FROM {{database}}.cdn_facet_minutes
  WHERE facet = '{{facetName}}'
    AND minute >= toDateTime('{{startTime}}')
    AND minute <= toDateTime('{{endTime}}')
    {{dimFilter}}
)
GROUP BY dim WITH TOTALS
ORDER BY {{orderBy}}
LIMIT {{topN}}
