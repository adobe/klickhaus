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
import { initDashboard } from './dashboard-init.js';
import { OPSPILE_TIME_RANGE_ORDER, OPSPILE_DEFAULT_TIME_RANGE } from './constants.js';
import { opspileBreakdowns, OPSPILE_AGGREGATIONS } from './breakdowns/definitions-opspile.js';

const LOG_COLUMN_ORDER = [
  'timestamp',
  'label.urgency_level',
  'label.kind',
  'thread.waiting_on',
  'thread.resolved',
  'org.slug',
  'team',
  'channel.name',
  'author.name',
  'author.relation',
  'thread.title',
  'url',
  'source',
  'channel.kind',
  'is_root',
  'teams',
  'org.type',
  'label.next_actor',
];

const DEFAULT_HIDDEN_FACETS = [
  'breakdown-author-ops-teams',
  'breakdown-edited',
  'breakdown-fact-urls',
  'breakdown-thread',
];

// Thread keys look like `<platform>:<tenant>:…:<root id>`; anything else in the search
// box is a substring match on the thread title.
const THREAD_KEY_RE = /^(slack|teams|discord):\S+$/;

// opspile_messages is a FINAL view over a tiny ReplacingMergeTree, so there is no
// facet-minutes table: canUseFacetTable() only routes delivery and lambda_logs there.
initDashboard({
  title: 'opspile',
  tableName: 'opspile_messages',
  timeSeriesTemplate: 'time-series-opspile',
  aggregations: OPSPILE_AGGREGATIONS,
  timeRangeOrder: OPSPILE_TIME_RANGE_ORDER,
  defaultTimeRange: OPSPILE_DEFAULT_TIME_RANGE,
  hostFilterColumn: 'org.slug',
  requestIdColumn: 'thread',
  requestIdPattern: THREAD_KEY_RE,
  messageColumn: 'thread.title',
  rowLinkColumn: 'url',
  logColumnOrder: LOG_COLUMN_ORDER,
  defaultHiddenFacets: DEFAULT_HIDDEN_FACETS,
  breakdowns: opspileBreakdowns,
});
