SELECT {{searchCol}} as dim, count() as cnt
FROM {{database}}.{{table}}
WHERE {{timeFilter}} {{hostFilter}} {{facetFilters}}
GROUP BY dim
ORDER BY cnt DESC
LIMIT 20 OFFSET {{offset}}
