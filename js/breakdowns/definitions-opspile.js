/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { COLUMN_DEFS } from '../columns.js';

/**
 * Chart/facet severity for opspile_messages rows (see sql/queries/time-series-opspile.sql,
 * which must stay in sync):
 *   red    = critical/high urgency, or an incident/security thread
 *   yellow = the inbox is waiting on us (`thread.waiting_on`, which overrides Clef's
 *            next_actor when Adobe posted last) and the thread is not resolved (and not red)
 *   green  = everything else
 */
export const OPSPILE_RED = "(`label.urgency_level` IN ('critical', 'high') OR `label.kind` IN ('incident', 'security'))";
export const OPSPILE_YELLOW = `(NOT ${OPSPILE_RED} AND \`thread.waiting_on\` = 'us' AND \`thread.resolved\` = 0)`;

/** Status aggregations for initDashboard: cnt_ok = green, cnt_4xx = yellow, cnt_5xx = red. */
export const OPSPILE_AGGREGATIONS = {
  aggTotal: 'count()',
  aggOk: `countIf(NOT ${OPSPILE_RED} AND NOT ${OPSPILE_YELLOW})`,
  agg4xx: `countIf(${OPSPILE_YELLOW})`,
  agg5xx: `countIf(${OPSPILE_RED})`,
};

/**
 * Thread keys look like `<platform>:<tenant>:…:<root id>`, built from platform ids only
 * (Teams channel ids look like 19:abc@thread.tacv2). The search box matches such input
 * exactly against `thread`; anything else is a substring match on the thread title.
 */
export const THREAD_KEY_RE = /^(slack|teams|discord):[A-Za-z0-9_.@:-]+$/;

/**
 * Facet over an Array(String) column: one row per element, filtered with has().
 * searchCol is the same arrayJoin() expression, so facet search queries elements (not
 * the array) and a picked value goes through the breakdown's HAS lookup in addFilter.
 * @param {string} id
 * @param {string} column - bare column name
 * @param {Object} [extra]
 */
function arrayFacet(id, column, extra = {}) {
  return {
    id,
    col: `arrayJoin(\`${column}\`)`,
    searchCol: `arrayJoin(\`${column}\`)`,
    filterCol: `\`${column}\``,
    filterOp: 'HAS',
    ...extra,
  };
}

/**
 * Breakdown (facet) definitions for the opspile_messages view (one row per ops-inbox
 * message). There is no facet-minutes table: every facet queries the view directly,
 * which is cheap because the table is tiny. Counts are messages; `is_root` splits
 * thread roots from replies.
 */
export const opspileBreakdowns = [
  {
    id: 'breakdown-urgency',
    col: COLUMN_DEFS.opsUrgencyLevel.facetCol,
    summaryCountIf: "`label.urgency_level` IN ('critical', 'high')",
    summaryLabel: 'high/critical',
    summaryColor: 'error',
  },
  {
    id: 'breakdown-kind',
    col: COLUMN_DEFS.opsKind.facetCol,
    summaryCountIf: "`label.kind` IN ('incident', 'security')",
    summaryLabel: 'incident/security',
    summaryColor: 'error',
  },
  {
    id: 'breakdown-waiting-on',
    col: COLUMN_DEFS.opsWaitingOn.facetCol,
    summaryCountIf: "`thread.waiting_on` = 'us'",
    summaryLabel: 'on us',
    summaryColor: 'warning',
  },
  {
    id: 'breakdown-next-actor',
    col: COLUMN_DEFS.opsNextActor.facetCol,
  },
  {
    id: 'breakdown-resolved',
    col: COLUMN_DEFS.opsResolved.facetCol,
  },
  {
    id: 'breakdown-team',
    col: COLUMN_DEFS.opsTeam.facetCol,
  },
  // Filed + shared teams (channel_teams). Link with the filter
  //   {"col":"arrayJoin(`teams`)","value":<team>,"exclude":false,
  //    "filterCol":"`teams`","filterOp":"HAS"}
  arrayFacet('breakdown-teams', 'teams'),
  {
    id: 'breakdown-org',
    col: COLUMN_DEFS.opsOrg.facetCol,
    highCardinality: true,
  },
  {
    id: 'breakdown-org-type',
    col: COLUMN_DEFS.opsOrgType.facetCol,
  },
  {
    id: 'breakdown-channel',
    col: COLUMN_DEFS.opsChannel.facetCol,
    highCardinality: true,
  },
  {
    id: 'breakdown-channel-kind',
    col: COLUMN_DEFS.opsChannelKind.facetCol,
  },
  {
    id: 'breakdown-source',
    col: '`source`',
  },
  {
    id: 'breakdown-author-relation',
    col: COLUMN_DEFS.opsAuthorRelation.facetCol,
  },
  {
    id: 'breakdown-author',
    col: COLUMN_DEFS.opsAuthor.facetCol,
    highCardinality: true,
  },
  {
    id: 'breakdown-author-domain',
    col: COLUMN_DEFS.opsAuthorDomain.facetCol,
  },
  arrayFacet('breakdown-author-ops-teams', 'author.ops_teams'),
  {
    id: 'breakdown-is-root',
    col: "if(`is_root` = 1, 'root', 'reply')",
  },
  {
    id: 'breakdown-edited',
    col: "if(`edited` = 1, 'edited', 'not edited')",
  },
  arrayFacet('breakdown-tickets', 'facts_tickets', { highCardinality: true }),
  arrayFacet('breakdown-sites', 'facts_sites', { highCardinality: true }),
  arrayFacet('breakdown-cves', 'facts_cves', { highCardinality: true }),
  arrayFacet('breakdown-problems', 'facts_problems', { highCardinality: true }),
  arrayFacet('breakdown-fact-urls', 'facts_urls', { highCardinality: true }),
  {
    id: 'breakdown-thread',
    col: COLUMN_DEFS.opsThread.facetCol,
    highCardinality: true,
  },
  {
    id: 'breakdown-title',
    col: COLUMN_DEFS.opsTitle.facetCol,
    highCardinality: true,
  },
];
