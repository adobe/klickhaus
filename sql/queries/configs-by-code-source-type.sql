SELECT
  if(code_source_type = '', '(none)', code_source_type) AS type,
  count() AS cnt
FROM {{database}}.{{source}}
GROUP BY type
ORDER BY cnt DESC
