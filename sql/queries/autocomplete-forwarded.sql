SELECT `request.headers.x_forwarded_host` as host, count() as cnt
FROM {{database}}.{{table}}
WHERE timestamp > now() - INTERVAL 1 DAY
  AND `request.headers.x_forwarded_host` != ''
GROUP BY host
ORDER BY cnt DESC
LIMIT 100
