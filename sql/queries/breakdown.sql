SELECT
  {{col}} as dim,
  {{aggTotal}} as cnt,
  {{aggOk}} as cnt_ok,
  {{agg4xx}} as cnt_4xx,
  {{agg5xx}} as cnt_5xx{{summaryCol}}
FROM {{database}}.{{table}}
WHERE {{timeFilter}} {{hostFilter}} {{facetFilters}} {{extra}} {{additionalWhereClause}}
GROUP BY dim WITH TOTALS
ORDER BY {{orderBy}}
LIMIT {{topN}}
