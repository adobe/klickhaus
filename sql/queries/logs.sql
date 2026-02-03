SELECT *
FROM {{database}}.{{table}}
WHERE {{timeFilter}} {{hostFilter}} {{facetFilters}} {{additionalWhereClause}}
ORDER BY timestamp DESC
LIMIT {{pageSize}}
