SELECT
  lower(trimRight(splitByChar(':',
    trimBoth(splitByChar(',', `request.headers.x_forwarded_host`)[1])
  )[1], '.')) AS domain,
  splitByString('--', replaceOne(`request.host`, '.aem.live', ''))[3] AS owner,
  splitByString('--', replaceOne(`request.host`, '.aem.live', ''))[2] AS repo,
  `request.headers.x_byo_cdn_type` AS cdn_type,
  round(count() / (dateDiff('hour', min(timestamp), max(timestamp)) + 1), 1) AS req_per_hour,
  count() AS total,
  dateDiff('day', min(timestamp), now()) AS age_days
FROM {{database}}.cdn_requests_v2
WHERE `request.host` LIKE '%.aem.live'
  AND `request.headers.x_forwarded_host` != ''
  AND `request.headers.x_forwarded_host` != `request.host`
  AND `request.headers.x_forwarded_host` NOT LIKE '%.aem.live'
  AND `request.headers.x_forwarded_host` NOT LIKE '%.aem.page'
  AND `request.headers.x_forwarded_host` NOT LIKE 'localhost%'
  AND `request.headers.x_forwarded_host` NOT LIKE '%.workers.dev%'
  AND `request.headers.x_forwarded_host` NOT LIKE '%<%'
  AND `request.headers.x_forwarded_host` NOT LIKE '%{%'
  AND `request.headers.x_forwarded_host` NOT LIKE '%/%'
  AND `request.headers.x_forwarded_host` NOT LIKE '%oast%'
  AND timestamp > now() - INTERVAL 7 DAY
GROUP BY domain, owner, repo, cdn_type
HAVING NOT match(domain, '^[0-9.]+$')
  AND domain NOT IN ('da.live', 'da.page', 'aem.live', 'docs.da.live', 'docs.da.page')
  AND domain NOT LIKE '%.aem.reviews'
  AND match(domain, '^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$')
ORDER BY total DESC
