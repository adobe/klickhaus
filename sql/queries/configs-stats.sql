SELECT
  count()                        AS total,
  countIf(cdn_prod_host != '')   AS with_cdn_host,
  countIf(cdn_prod_type != '')   AS with_cdn_type,
  countIf(folders)               AS with_folders,
  countIf(profile != '')         AS with_profile
FROM {{database}}.{{source}}
