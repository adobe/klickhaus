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
import { allBreakdowns } from './definitions.js';
import { COLUMN_DEFS } from '../columns.js';

// misc_services carries `subsystem` and a `cdn.domain` column but has NO helix.*
// columns and none of the x_ratelimit_* / x_severity response headers. Start from
// the delivery breakdown set, drop the facets whose columns don't exist here, and
// add a Domain facet. (facetName fields are inherited but ignored: canUseFacetTable
// gates the cdn_facet_minutes path on tableName === 'delivery', so misc_services
// breakdowns always query the raw table.)
const UNSUPPORTED_FACETS = new Set([
  'breakdown-request-type', // helix.request_type
  'breakdown-tech-stack', // helix.backend_type
  'breakdown-tier', // helix.contentbus_prefix
  'breakdown-rso', // helix.rso
  'breakdown-helix-route',
  'breakdown-helix-topic',
  'breakdown-helix-org',
  'breakdown-helix-site',
  'breakdown-helix-repo',
  'breakdown-helix-owner',
  'breakdown-helix-path',
  'breakdown-helix-ref',
  'breakdown-severity', // response.headers.x_severity
  'breakdown-ratelimit-limit', // response.headers.x_ratelimit_limit
  'breakdown-ratelimit-rate', // response.headers.x_ratelimit_rate
]);

const domainBreakdown = {
  id: 'breakdown-domain', col: COLUMN_DEFS.domain.facetCol, extraFilter: "AND `cdn.domain` != ''",
};

// misc_services stores surrogate keys in `response.headers.surrogate_key`
// (delivery uses `response.headers.x_surrogate_key`).
const MISC_SURROGATE_KEY_COL = '`response.headers.surrogate_key`';

// Keep Domain next to Subsystem — the two service-identifying facets.
export const miscBreakdowns = allBreakdowns
  .filter((b) => !UNSUPPORTED_FACETS.has(b.id))
  .flatMap((b) => {
    if (b.id === 'breakdown-subsystem') { return [b, domainBreakdown]; }
    if (b.id === 'breakdown-referers') { return [{ ...b, substringFilter: true }]; }
    if (b.id === 'breakdown-surrogate-key') {
      return [{ ...b, col: MISC_SURROGATE_KEY_COL, extraFilter: `AND ${MISC_SURROGATE_KEY_COL} != ''` }];
    }
    return [b];
  });
