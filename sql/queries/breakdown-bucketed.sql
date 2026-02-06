SELECT
  {{bucketExpr}} as dim,
  sum(agg_total) as cnt,
  sum(agg_ok) as cnt_ok,
  sum(agg_4xx) as cnt_4xx,
  sum(agg_5xx) as cnt_5xx{{outerSummaryCol}}
FROM (
  SELECT
    {{rawCol}} as val,
    {{aggTotal}} as agg_total,
    {{aggOk}} as agg_ok,
    {{agg4xx}} as agg_4xx,
    {{agg5xx}} as agg_5xx{{innerSummaryCol}}
  FROM {{database}}.{{table}}
  {{sampleClause}}
  WHERE {{timeFilter}} {{hostFilter}} {{facetFilters}} {{extra}} {{additionalWhereClause}}
  GROUP BY val
)
GROUP BY dim WITH TOTALS
ORDER BY min(val)
LIMIT {{topN}}
