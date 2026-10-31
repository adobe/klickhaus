-- Mean time to resolve over inbox entries (a thread, or a re-threaded group as the inbox
-- shows it). There is no resolution timestamp, so an entry's duration runs from its first
-- root to its last message by a person. Durations come from the entry's whole history, so
-- the range and the filters only pick entries, they never shorten them: an entry counts when
-- a message in the range matches the filters and its last human message falls in the range.
SELECT avg(duration_s) AS mean_s
FROM (
  SELECT duration_s, last_person_at AS timestamp
  FROM (
    SELECT
      if(logical_thread != '', logical_thread, thread) AS entry,
      min(`thread.resolved`) AS resolved,
      min(`thread.root_at`) AS opened_at,
      maxIf(timestamp, `author.kind` = 'person') AS last_person_at,
      dateDiff('second', opened_at, last_person_at) AS duration_s
    FROM {{database}}.{{table}}
    WHERE if(logical_thread != '', logical_thread, thread) IN (
      SELECT if(logical_thread != '', logical_thread, thread)
      FROM {{database}}.{{table}}
      WHERE {{timeFilter}} {{hostFilter}} {{facetFilters}} {{additionalWhereClause}}
    )
    GROUP BY entry
    HAVING resolved = 1 AND duration_s > 0
  )
)
WHERE {{timeFilter}}
