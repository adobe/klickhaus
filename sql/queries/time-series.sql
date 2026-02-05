SELECT
  {{bucket}} as t,
  countIf(`response.status` < 400){{mult}} as cnt_ok,
  countIf(`response.status` >= 400 AND `response.status` < 500){{mult}} as cnt_4xx,
  countIf(`response.status` >= 500){{mult}} as cnt_5xx
FROM {{database}}.{{table}}
WHERE {{timeFilter}} {{hostFilter}} {{facetFilters}} {{additionalWhereClause}}
GROUP BY t
ORDER BY t WITH FILL FROM {{rangeStart}} TO {{rangeEnd}} STEP {{step}}
