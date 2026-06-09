SELECT
  org,
  site,
  cdn_prod_host,
  cdn_prod_type,
  code_owner,
  code_repo,
  code_source_type,
  code_source_url,
  content_bus_id,
  content_source_type,
  content_source_url,
  content_source_overlay_type,
  content_source_overlay_url,
  folders,
  features,
  limits
FROM {{database}}.{{source}}
ORDER BY org, site
