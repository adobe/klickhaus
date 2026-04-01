SELECT
  {{bucket}} as t,
  sumIf(`weight`, `response.status` < 400){{mult}} as cnt_ok,
  sumIf(`weight`, `response.status` >= 400 AND `response.status` < 500){{mult}} as cnt_4xx,
  sumIf(`weight`, `response.status` >= 500){{mult}} as cnt_5xx
FROM {{database}}.{{table}}
{{sampleClause}}
WHERE {{timeFilter}} {{hostFilter}} {{facetFilters}} {{additionalWhereClause}}
GROUP BY t
ORDER BY t WITH FILL FROM {{rangeStart}} TO {{rangeEnd}} STEP {{step}}
