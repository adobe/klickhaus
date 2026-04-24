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
import { daBreakdowns } from './breakdowns/definitions-da.js';

const DEFAULT_HIDDEN_FACETS = [
  'breakdown-accept-encoding',
  'breakdown-content-encoding',
  'breakdown-content-length',
  'breakdown-content-types',
  'breakdown-ips',
  'breakdown-paths',
  'breakdown-referers',
  'breakdown-time-elapsed',
];

initDashboard({
  title: 'DA',
  tableName: 'da',
  weightColumn: 'weight',
  timeSeriesTemplate: 'time-series-delivery',
  breakdowns: daBreakdowns,
  defaultHiddenFacets: DEFAULT_HIDDEN_FACETS,
});
