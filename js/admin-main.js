/*
 * Copyright 2025 Adobe. All rights reserved.
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

const DEFAULT_HIDDEN_FACETS = [
  'breakdown-accept-encoding',
  'breakdown-cdn-version',
  'breakdown-content-encoding',
  'breakdown-content-length',
  'breakdown-content-types',
  'breakdown-datacenters',
  'breakdown-forwarded-hosts',
  'breakdown-helix-ref',
  'breakdown-ips',
  'breakdown-location',
  'breakdown-methods',
  'breakdown-ratelimit-limit',
  'breakdown-ratelimit-rate',
  'breakdown-source',
  'breakdown-user-agents',
];

initDashboard({
  title: 'Admin',
  tableName: 'admin',
  weightColumn: 'weight',
  timeSeriesTemplate: 'time-series-backend',
  defaultHiddenFacets: DEFAULT_HIDDEN_FACETS,
});
