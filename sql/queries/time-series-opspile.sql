SELECT
  {{bucket}} as t,
  countIf(NOT (`label.urgency_level` IN ('critical', 'high') OR `label.kind` IN ('incident', 'security')) AND NOT (NOT (`label.urgency_level` IN ('critical', 'high') OR `label.kind` IN ('incident', 'security')) AND `thread.waiting_on` = 'us' AND `thread.resolved` = 0)) as cnt_ok,
  countIf((NOT (`label.urgency_level` IN ('critical', 'high') OR `label.kind` IN ('incident', 'security')) AND `thread.waiting_on` = 'us' AND `thread.resolved` = 0)) as cnt_4xx,
  countIf((`label.urgency_level` IN ('critical', 'high') OR `label.kind` IN ('incident', 'security'))) as cnt_5xx
FROM {{database}}.{{table}}
WHERE {{timeFilter}} {{hostFilter}} {{facetFilters}} {{additionalWhereClause}}
GROUP BY t
ORDER BY t WITH FILL FROM {{rangeStart}} TO {{rangeEnd}} STEP {{step}}
