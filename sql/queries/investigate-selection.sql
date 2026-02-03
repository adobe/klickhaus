SELECT
  dim,
  sumIf(cnt, {{selectionMinuteFilter}}) as selection_cnt,
  sumIf(cnt, NOT ({{selectionMinuteFilter}})) as baseline_cnt,
  sumIf(cnt_4xx + cnt_5xx, {{selectionMinuteFilter}}) as selection_err_cnt,
  sumIf(cnt_4xx + cnt_5xx, NOT ({{selectionMinuteFilter}})) as baseline_err_cnt
FROM (
  SELECT
    toStartOfMinute(timestamp) as minute,
    {{col}} as dim,
    count() as cnt,
    countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
    countIf(`response.status` >= 500) as cnt_5xx
  FROM {{database}}.{{table}}
  WHERE {{timeFilter}}
    {{hostFilter}} {{facetFilters}} {{extra}}
  GROUP BY minute, dim
)
GROUP BY dim
HAVING selection_cnt > 0 OR baseline_cnt > 0
ORDER BY selection_cnt DESC
LIMIT 50
