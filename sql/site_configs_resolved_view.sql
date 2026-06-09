-- Resolved site configs: scalar fields prefer site value over profile fallback;
-- JSON fields (features, limits) are merged via RFC 7396 (profile base + site override).
-- Sites with no profile are returned unchanged.
-- Created: 2026-06-09

CREATE VIEW IF NOT EXISTS helix_logs_production.site_configs_resolved AS
SELECT
  s.org,
  s.site,
  s.profile,
  s.version,
  s.created,
  s.last_modified,
  if(s.cdn_prod_host != '', s.cdn_prod_host, p.cdn_prod_host)                   AS cdn_prod_host,
  if(s.cdn_prod_type != '', s.cdn_prod_type, p.cdn_prod_type)                   AS cdn_prod_type,
  if(s.code_owner != '', s.code_owner, p.code_owner)                           AS code_owner,
  if(s.code_repo != '', s.code_repo, p.code_repo)                               AS code_repo,
  if(s.code_source_type != '', s.code_source_type, p.code_source_type)         AS code_source_type,
  if(s.code_source_url != '', s.code_source_url, p.code_source_url)             AS code_source_url,
  if(s.content_bus_id != '', s.content_bus_id, p.content_bus_id)               AS content_bus_id,
  if(s.content_source_type != '', s.content_source_type, p.content_source_type) AS content_source_type,
  if(s.content_source_url != '', s.content_source_url, p.content_source_url)   AS content_source_url,
  if(
    s.content_source_overlay_type != '',
    s.content_source_overlay_type,
    p.content_source_overlay_type
  ) AS content_source_overlay_type,
  if(
    s.content_source_overlay_url != '',
    s.content_source_overlay_url,
    p.content_source_overlay_url
  ) AS content_source_overlay_url,
  if(s.folders, s.folders, p.folders) AS folders,
  -- JSON merge: profile provides base, site values override per RFC 7396
  if(
    s.features != '' AND s.features != '{}',
    JSONMergePatch(if(p.features != '' AND p.features != '{}', p.features, '{}'), s.features),
    if(p.features != '' AND p.features != '{}', p.features, '')
  ) AS features,
  if(
    s.limits != '' AND s.limits != '{}',
    JSONMergePatch(if(p.limits != '' AND p.limits != '{}', p.limits, '{}'), s.limits),
    if(p.limits != '' AND p.limits != '{}', p.limits, '')
  ) AS limits
FROM (SELECT * FROM helix_logs_production.site_configs FINAL) AS s
LEFT JOIN (SELECT * FROM helix_logs_production.profile_configs FINAL) AS p
  ON s.org = p.org AND p.profile = if(s.profile != '', s.profile, 'default');
