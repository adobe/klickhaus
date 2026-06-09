SELECT
  if(content_source_type = '', '(none)', content_source_type) AS type,
  count() AS cnt
FROM {{database}}.site_configs FINAL
GROUP BY type
ORDER BY cnt DESC
