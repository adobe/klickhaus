SELECT
  org,
  site,
  version,
  formatDateTime(toDateTime(created), '%Y-%m-%d') AS created_date,
  cdn_prod_host,
  cdn_prod_type,
  code_owner,
  code_repo,
  code_source_type,
  content_bus_id,
  content_source_type,
  content_source_url,
  content_source_overlay_type,
  content_source_overlay_url,
  profile,
  folders,
  features,
  limits,
  formatDateTime(toDateTime(last_modified), '%Y-%m-%d') AS last_modified_date
FROM {{database}}.site_configs FINAL
ORDER BY org, site
