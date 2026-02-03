SELECT
  {{col}} as dim,
  {{aggTotal}} as cnt,
  {{aggOk}} as cnt_ok,
  {{agg4xx}} as cnt_4xx,
  {{agg5xx}} as cnt_5xx
FROM {{database}}.{{table}}
{{sampleClause}}
WHERE {{timeFilter}} {{hostFilter}} {{extra}} {{additionalWhereClause}}
  AND {{searchCol}} IN ({{valuesList}})
GROUP BY dim
