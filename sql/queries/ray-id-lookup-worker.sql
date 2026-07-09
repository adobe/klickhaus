SELECT
  timestamp,
  script_name,
  outcome,
  `response.status`,
  cpu_ms,
  wall_ms,
  logs,
  exceptions
FROM {{database}}.da_worker_logs
WHERE ray_id = '{{rayId}}'
ORDER BY timestamp
LIMIT 5
