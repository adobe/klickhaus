SELECT
  {{bucket}} as t,
  countIf(outcome NOT IN ('exception', 'exceeded') AND (`response.status` = 0 OR `response.status` < 400)) as cnt_ok,
  countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
  countIf(outcome IN ('exception', 'exceeded') OR `response.status` >= 500) as cnt_5xx
FROM {{database}}.{{table}}
WHERE {{timeFilter}} {{hostFilter}} {{facetFilters}} {{additionalWhereClause}}
GROUP BY t
ORDER BY t WITH FILL FROM {{rangeStart}} TO {{rangeEnd}} STEP {{step}}
