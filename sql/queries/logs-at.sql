SELECT {{columns}}
FROM {{database}}.{{table}}
WHERE {{timeFilter}} AND timestamp <= toDateTime64('{{target}}', 3) {{hostFilter}} {{facetFilters}} {{additionalWhereClause}}
ORDER BY timestamp DESC
LIMIT {{pageSize}}
