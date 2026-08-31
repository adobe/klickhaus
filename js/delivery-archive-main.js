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
import { ARCHIVE_TIME_RANGE_ORDER, ARCHIVE_DEFAULT_TIME_RANGE } from './constants.js';
import { allBreakdowns } from './breakdowns/definitions.js';

// Breakdowns/filters removed from the archive view. referer and originating IP are
// PII-scrubbed to empty in delivery_archive (always blank), and restarts is not
// meaningful for long-range archive analysis.
const REMOVED_FACETS = new Set([
  'breakdown-referers',
  'breakdown-ips', // originating IP
  'breakdown-restarts',
]);

const archiveBreakdowns = allBreakdowns.filter((b) => !REMOVED_FACETS.has(b.id));

const DEFAULT_HIDDEN_FACETS = [
  'breakdown-accept-encoding',
  'breakdown-body-size',
  'breakdown-cdn-version',
  'breakdown-content-encoding',
  'breakdown-content-length',
  'breakdown-content-types',
  'breakdown-delivery-ratelimit-rate',
  'breakdown-location',
  'breakdown-paths',
  'breakdown-surrogate-key',
  'breakdown-time-elapsed',
];

// delivery_archive is an 18-month, PII-scrubbed, self-sampled mirror of `delivery`
// (identical schema). It has NO cdn_facet_minutes facet table, so breakdowns always
// query the raw table — canUseFacetTable() gates the facet path on tableName ===
// 'delivery', which this view is not, so it falls through automatically.
initDashboard({
  title: 'Delivery Archive',
  tableName: 'delivery_archive',
  weightColumn: 'weight',
  timeSeriesTemplate: 'time-series-delivery',
  timeRangeOrder: ARCHIVE_TIME_RANGE_ORDER,
  defaultTimeRange: ARCHIVE_DEFAULT_TIME_RANGE,
  breakdowns: archiveBreakdowns,
  defaultHiddenFacets: DEFAULT_HIDDEN_FACETS,
});
