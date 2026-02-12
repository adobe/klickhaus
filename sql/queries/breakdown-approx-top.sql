WITH top_dims AS (
  SELECT tupleElement(pair, 1) AS dim
  FROM (
    SELECT arrayJoin(approx_top_count({{topN}})({{col}})) AS pair
    FROM {{database}}.{{table}}
    {{sampleClause}}
    WHERE {{timeFilter}} {{hostFilter}} {{extra}} {{additionalWhereClause}}
  )
)
SELECT {{col}} AS dim, {{aggTotal}} AS cnt, {{aggOk}} AS cnt_ok,
  {{agg4xx}} AS cnt_4xx, {{agg5xx}} AS cnt_5xx{{summaryCol}}
FROM {{database}}.{{table}}
WHERE {{timeFilter}} {{hostFilter}} {{extra}} {{additionalWhereClause}}
  AND {{col}} IN (SELECT dim FROM top_dims)
GROUP BY dim
ORDER BY cnt DESC
LIMIT {{topN}}
UNION ALL
SELECT '' AS dim, {{aggTotal}} AS cnt, {{aggOk}} AS cnt_ok,
  {{agg4xx}} AS cnt_4xx, {{agg5xx}} AS cnt_5xx{{summaryCol}}
FROM {{database}}.{{table}}
WHERE {{timeFilter}} {{hostFilter}} {{extra}} {{additionalWhereClause}}
