SELECT
  dim,
  sumIf(cat_cnt, {{anomalyMinuteFilter}}) as anomaly_cat_cnt,
  sumIf(cat_cnt, NOT ({{anomalyMinuteFilter}})) as baseline_cat_cnt,
  sumIf(cnt, {{anomalyMinuteFilter}}) as anomaly_total_cnt,
  sumIf(cnt, NOT ({{anomalyMinuteFilter}})) as baseline_total_cnt
FROM (
  SELECT
    toStartOfMinute(timestamp) as minute,
    {{col}} as dim,
    count() as cnt,
    countIf(`response.status` < 400) as cnt_ok,
    countIf(`response.status` >= 400 AND `response.status` < 500) as cnt_4xx,
    countIf(`response.status` >= 500) as cnt_5xx,
    {{catCountExpr}} as cat_cnt
  FROM {{database}}.{{table}}
  WHERE {{timeFilter}}
    {{hostFilter}} {{facetFilters}} {{extra}}
  GROUP BY minute, dim
)
GROUP BY dim
HAVING anomaly_cat_cnt > 0 OR baseline_cat_cnt > 0
ORDER BY anomaly_cat_cnt DESC
LIMIT 50
