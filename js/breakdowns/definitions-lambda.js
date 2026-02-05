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

/**
 * Breakdown (facet) definitions for the lambda_logs table.
 */
export const lambdaBreakdowns = [
  {
    id: 'breakdown-level',
    col: '`level`',
    summaryCountIf: "`level` = 'ERROR'",
    summaryLabel: 'error rate',
    summaryColor: 'error',
  },
  {
    id: 'breakdown-function-name',
    col: '`function_name`',
    highCardinality: true,
  },
  {
    id: 'breakdown-app-name',
    col: '`app_name`',
  },
  {
    id: 'breakdown-subsystem',
    col: '`subsystem`',
  },
  {
    id: 'breakdown-log-group',
    col: '`log_group`',
    highCardinality: true,
  },
];
