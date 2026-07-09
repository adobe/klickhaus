SELECT
  timestamp,
  `request.host`,
  `request.url`,
  `request.method`,
  `response.status`,
  `cdn.script_name`,
  `cdn.time_elapsed_msec`,
  `response.headers.x_error`
FROM {{database}}.da
WHERE ray_id = '{{rayId}}'
ORDER BY timestamp
LIMIT 5
