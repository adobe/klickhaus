SELECT
  {{bucket}} as t,
  sumIf(`weight`, `response.status` < 400) as cnt_ok,
  sumIf(`weight`, `response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
  sumIf(`weight`, `response.status` >= 500) as cnt_5xx
FROM {{database}}.{{table}}
WHERE {{timeFilter}} {{hostFilter}} {{facetFilters}} {{additionalWhereClause}}
GROUP BY t
ORDER BY t WITH FILL FROM {{rangeStart}} TO {{rangeEnd}} STEP {{step}}
