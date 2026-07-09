SELECT
  timestamp,
  `request.host`,
  `request.url`,
  `request.method`,
  `response.status`,
  `cdn.cache_status`,
  `cdn.script_name`
FROM {{database}}.da
WHERE ray_id = '{{rayId}}'
ORDER BY timestamp
LIMIT 5
