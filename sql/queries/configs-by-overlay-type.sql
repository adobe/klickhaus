SELECT
  if(content_source_overlay_type = '', '(none)', content_source_overlay_type) AS type,
  count() AS cnt
FROM {{database}}.{{source}}
GROUP BY type
ORDER BY cnt DESC
