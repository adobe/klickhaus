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
import { lambdaBreakdowns } from './breakdowns/definitions-lambda.js';

const LAMBDA_AGGREGATIONS = {
  aggTotal: 'count()',
  aggOk: "countIf(lower(level) NOT IN ('error', 'warn', 'warning'))",
  agg4xx: "countIf(lower(level) IN ('warn', 'warning'))",
  agg5xx: "countIf(lower(level) = 'error')",
};

initDashboard({
  title: 'Lambda Logs',
  tableName: 'lambda_logs',
  timeSeriesTemplate: 'time-series-lambda',
  aggregations: LAMBDA_AGGREGATIONS,
  hostFilterColumn: 'function_name',
  breakdowns: lambdaBreakdowns,
});
