SELECT *
FROM {{database}}.{{table}}
WHERE timestamp = toDateTime64('{{timestamp}}', 3) AND `request.host` = '{{host}}'
LIMIT 1
