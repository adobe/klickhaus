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
import { miscBreakdowns } from './breakdowns/definitions-misc.js';

const DEFAULT_HIDDEN_FACETS = [
  'breakdown-content-types',
  'breakdown-forwarded-hosts',
  'breakdown-referers',
  'breakdown-ips',
  'breakdown-asn',
  'breakdown-accept-encoding',
  'breakdown-byo-cdn',
  'breakdown-push-invalidation',
  'breakdown-content-length',
  'breakdown-body-size',
  'breakdown-location',
  'breakdown-content-encoding',
  'breakdown-surrogate-key',
  'breakdown-time-elapsed',
  'breakdown-cdn-version',
  'breakdown-restarts',
  'breakdown-delivery-ratelimit-rate',
];

initDashboard({
  title: 'Misc. Services',
  tableName: 'misc_services',
  weightColumn: 'weight',
  timeSeriesTemplate: 'time-series-backend',
  breakdowns: miscBreakdowns,
  defaultHiddenFacets: DEFAULT_HIDDEN_FACETS,
});
