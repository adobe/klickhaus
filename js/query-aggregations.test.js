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
import { assert } from 'chai';
import { state } from './state.js';
import {
  buildStatusAggregations,
  buildSummaryCountBreakdownFragment,
  getInvestigateMinuteAggregateLines,
  getDimCountAgg,
} from './query-aggregations.js';

describe('query-aggregations', () => {
  beforeEach(() => {
    state.aggregations = null;
    state.weightColumn = null;
  });

  it('buildStatusAggregations uses count for default CDN mode', () => {
    const a = buildStatusAggregations(false, '');
    assert.include(a.aggTotal, 'count()');
    assert.include(a.aggOk, 'countIf');
  });

  it('buildStatusAggregations uses weight when weightColumn is set', () => {
    state.weightColumn = 'weight';
    const a = buildStatusAggregations(false, ' * 3');
    assert.include(a.aggTotal, 'sum(`weight`) * 3');
    assert.include(a.aggOk, 'sumIf(`weight`');
  });

  it('buildSummaryCountBreakdownFragment uses sumIf with weight', () => {
    state.weightColumn = 'weight';
    const frag = buildSummaryCountBreakdownFragment('`response.status` >= 500', '');
    assert.include(frag, 'sumIf(`weight`');
    assert.include(frag, '`response.status` >= 500');
  });

  it('getInvestigateMinuteAggregateLines matches weight mode', () => {
    state.weightColumn = 'weight';
    const lines = getInvestigateMinuteAggregateLines();
    assert.include(lines.innerCnt, 'sum(`weight`)');
    assert.include(lines.innerOk, 'sumIf(`weight`');
  });

  it('getDimCountAgg returns sum for weight column', () => {
    state.weightColumn = 'weight';
    assert.strictEqual(getDimCountAgg(), 'sum(`weight`)');
  });
});
