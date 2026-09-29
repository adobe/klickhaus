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
import { allBreakdowns, withSubstringFilters } from './breakdowns/definitions.js';

// Last-Modified response header (Nullable DateTime64), rendered at second precision;
// missing headers map to '' so they show up (and can be filtered) as "(empty)".
const lastModifiedBreakdown = {
  id: 'breakdown-last-modified',
  col: "ifNull(formatDateTime(`response.headers.last_modified`, '%F %T'), '')",
};

const debugBreakdowns = withSubstringFilters(allBreakdowns).flatMap(
  (b) => (b.id === 'breakdown-push-invalidation' ? [b, lastModifiedBreakdown] : [b]),
);

const DEFAULT_HIDDEN_FACETS = [
  'breakdown-accept-encoding',
  'breakdown-body-size',
  'breakdown-cdn-version',
  'breakdown-content-encoding',
  'breakdown-content-length',
  'breakdown-content-types',
  'breakdown-delivery-ratelimit-rate',
  'breakdown-ips',
  'breakdown-location',
  'breakdown-paths',
  'breakdown-referers',
  'breakdown-restarts',
  'breakdown-time-elapsed',
];

// delivery_debug is a manually ingested, unsampled, filtered subset of `delivery`
// (identical schema) used to investigate cache and other issues. It has no
// cdn_facet_minutes facet table; canUseFacetTable() only routes tableName ===
// 'delivery' to it, so breakdowns here always query the raw table.
initDashboard({
  title: 'Delivery Debug',
  tableName: 'delivery_debug',
  weightColumn: 'weight',
  timeSeriesTemplate: 'time-series-delivery',
  breakdowns: debugBreakdowns,
  defaultHiddenFacets: DEFAULT_HIDDEN_FACETS,
});
