SELECT
  {{bucket}} as t,
  countIf(lower(level) NOT IN ('error', 'warn', 'warning')) as cnt_ok,
  countIf(lower(level) IN ('warn', 'warning')) as cnt_4xx,
  countIf(lower(level) = 'error') as cnt_5xx
FROM {{database}}.{{table}}
WHERE {{timeFilter}} {{hostFilter}} {{facetFilters}} {{additionalWhereClause}}
GROUP BY t
ORDER BY t WITH FILL FROM {{rangeStart}} TO {{rangeEnd}} STEP {{step}}
