SELECT published, repo, tag, url, body
FROM helix_logs_production.releases FINAL
WHERE published >= toDateTime64('{{startTime}}', 3)
  AND published <= toDateTime64('{{endTime}}', 3)
ORDER BY published
