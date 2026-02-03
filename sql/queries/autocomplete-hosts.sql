SELECT `request.host` as host, count() as cnt
FROM {{database}}.{{table}}
WHERE timestamp > now() - INTERVAL 1 DAY
GROUP BY host
ORDER BY cnt DESC
LIMIT 100
