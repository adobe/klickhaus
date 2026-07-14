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
 * Breakdown (facet) definitions for the helix_mixer_logs table
 * (Cloudflare Workers Trace Events for the helix3--helix-mixer worker).
 */
export const helixMixerBreakdowns = [
  {
    id: 'breakdown-outcome',
    col: '`outcome`',
    summaryCountIf: "`outcome` IN ('exception', 'exceeded')",
    summaryLabel: 'error rate',
    summaryColor: 'error',
  },
  {
    id: 'breakdown-status',
    col: COLUMN_DEFS.status.facetCol,
  },
  {
    id: 'breakdown-script-name',
    col: '`script_name`',
  },
  {
    id: 'breakdown-method',
    col: COLUMN_DEFS.method.facetCol,
  },
  {
    id: 'breakdown-url',
    col: COLUMN_DEFS.url.facetCol,
    highCardinality: true,
  },
  {
    id: 'breakdown-script-version',
    col: '`script_version`',
    highCardinality: true,
  },
  {
    id: 'breakdown-ray-id',
    col: '`ray_id`',
    highCardinality: true,
    // "0" marks internal service-binding calls that never appear in a CDN access-log
    // table, so it's not a useful breakdown value.
    extraFilter: "AND `ray_id` != '' AND `ray_id` != '0'",
  },
  {
    id: 'breakdown-logs',
    col: 'arrayJoin(`logs`)',
    filterCol: '`logs`',
    filterOp: 'HAS',
    highCardinality: true,
    maxTimeRangeHours: 24,
  },
  {
    id: 'breakdown-exceptions',
    col: 'arrayJoin(`exceptions`)',
    filterCol: '`exceptions`',
    filterOp: 'HAS',
    highCardinality: true,
    maxTimeRangeHours: 24,
  },
];
