SELECT {{columns}}
FROM {{database}}.{{table}}
WHERE {{timeFilter}} AND timestamp < toDateTime64('{{cursor}}', 3) {{hostFilter}} {{facetFilters}} {{additionalWhereClause}}
ORDER BY timestamp DESC
LIMIT {{pageSize}}
