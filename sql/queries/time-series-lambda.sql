SELECT
  {{bucket}} as t,
  countIf(level NOT IN ('ERROR', 'WARN', 'WARNING')) as cnt_ok,
  countIf(level IN ('WARN', 'WARNING')) as cnt_4xx,
  countIf(level = 'ERROR') as cnt_5xx
FROM {{database}}.{{table}}
WHERE {{timeFilter}} {{hostFilter}} {{facetFilters}} {{additionalWhereClause}}
GROUP BY t
ORDER BY t WITH FILL FROM {{rangeStart}} TO {{rangeEnd}} STEP {{step}}
