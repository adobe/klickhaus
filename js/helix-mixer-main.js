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
import { helixMixerBreakdowns } from './breakdowns/definitions-helix-mixer.js';

const LOG_COLUMN_ORDER = [
  'timestamp',
  'outcome',
  'response.status',
  'script_name',
  'request.method',
  'request.url',
  'ray_id',
  'logs',
  'exceptions',
  'cpu_ms',
  'wall_ms',
  'script_version',
];

const DEFAULT_HIDDEN_FACETS = [
  'breakdown-script-version',
  'breakdown-ray-id',
];

// outcome and response.status are independent signals here: status is 0 for
// service-binding calls and WebSocket upgrades even when the invocation succeeded,
// so "ok" must not require status < 400.
const MIXER_AGGREGATIONS = {
  aggTotal: 'count()',
  aggOk: "countIf(outcome NOT IN ('exception', 'exceeded') AND (`response.status` = 0 OR `response.status` < 400))",
  agg4xx: 'countIf(`response.status` >= 400 AND `response.status` < 500)',
  agg5xx: "countIf(outcome IN ('exception', 'exceeded') OR `response.status` >= 500)",
};

initDashboard({
  title: 'Helix Mixer Logs',
  tableName: 'helix_mixer_logs',
  timeSeriesTemplate: 'time-series-helix-mixer',
  aggregations: MIXER_AGGREGATIONS,
  hostFilterColumn: 'script_name',
  requestIdColumn: 'ray_id',
  messageColumn: 'request.url',
  defaultTimeRange: '24h',
  logColumnOrder: LOG_COLUMN_ORDER,
  defaultHiddenFacets: DEFAULT_HIDDEN_FACETS,
  breakdowns: helixMixerBreakdowns,
});
