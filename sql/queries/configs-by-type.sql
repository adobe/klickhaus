SELECT
  if(cdn_prod_type = '', '(none)', cdn_prod_type) AS type,
  count() AS cnt
FROM {{database}}.site_configs FINAL
GROUP BY type
ORDER BY cnt DESC
