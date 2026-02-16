SELECT value
FROM {{database}}.optel_admin
WHERE key = 'domainkey:read'
LIMIT 1
