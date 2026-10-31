-- Mean time to first response over inbox entries (a thread, or a re-threaded group as the
-- inbox shows it): from the first human message to the first human message from Adobe after
-- it. Entries Adobe started have nobody to answer and entries without a reply have no
-- duration, so neither counts. Reactions (a 👀) are not exported, so only messages answer.
-- Durations come from the entry's whole history, so the range and the filters only pick
-- entries, they never shorten them: an entry counts when a message in the range matches the
-- filters and its first response falls in the range.
SELECT avg(duration_s) AS mean_s
FROM (
  SELECT duration_s, first_response_at AS timestamp
  FROM (
    SELECT
      if(logical_thread != '', logical_thread, thread) AS entry,
      argMinIf(`author.relation`, timestamp, `author.kind` = 'person') AS opened_by,
      minIf(timestamp, `author.kind` = 'person') AS opened_at,
      minIf(timestamp, `author.kind` = 'person' AND `author.relation` = 'adobe') AS first_response_at,
      dateDiff('second', opened_at, first_response_at) AS duration_s
    FROM {{database}}.{{table}}
    WHERE if(logical_thread != '', logical_thread, thread) IN (
      SELECT if(logical_thread != '', logical_thread, thread)
      FROM {{database}}.{{table}}
      WHERE {{timeFilter}} {{hostFilter}} {{facetFilters}} {{additionalWhereClause}}
    )
    GROUP BY entry
    HAVING opened_by NOT IN ('', 'adobe') AND first_response_at > opened_at
  )
)
WHERE {{timeFilter}}
