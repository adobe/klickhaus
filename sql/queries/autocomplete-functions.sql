SELECT `function_name` as host, count() as cnt
FROM {{database}}.{{table}}
WHERE timestamp > now() - INTERVAL 1 DAY
GROUP BY `function_name`
ORDER BY cnt DESC
LIMIT 100
