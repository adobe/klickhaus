SELECT owner_repo FROM (
    SELECT `helix.owner` AS owner_repo
    FROM {{database}}.{{table}}
    WHERE timestamp > now() - INTERVAL 7 DAY AND `helix.owner` != ''
    GROUP BY `helix.owner`
    UNION ALL
    SELECT concat(`helix.owner`, '/', `helix.repo`) AS owner_repo
    FROM {{database}}.{{table}}
    WHERE timestamp > now() - INTERVAL 7 DAY
      AND `helix.owner` != ''
      AND `helix.repo` != ''
    GROUP BY `helix.owner`, `helix.repo`
)
GROUP BY owner_repo
ORDER BY lower(owner_repo) ASC
