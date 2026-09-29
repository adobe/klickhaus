SELECT {{searchCol}} as dim, {{dimCountAgg}} as cnt
FROM {{database}}.{{table}}
WHERE {{timeFilter}} {{hostFilter}} {{facetFilters}}
  AND {{searchCol}} LIKE '%{{escapedPattern}}%'
GROUP BY dim WITH TOTALS
ORDER BY cnt DESC
LIMIT 20
