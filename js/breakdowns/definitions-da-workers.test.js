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
import { daWorkerBreakdowns } from './definitions-da-workers.js';

describe('daWorkerBreakdowns', () => {
  it('has nine facets', () => {
    assert.strictEqual(daWorkerBreakdowns.length, 9);
  });

  it('each facet has a unique id and a col (string or function)', () => {
    const ids = new Set();
    daWorkerBreakdowns.forEach((b) => {
      assert.ok(typeof b.col === 'string' || typeof b.col === 'function');
      assert.isFalse(ids.has(b.id), `duplicate id: ${b.id}`);
      ids.add(b.id);
    });
  });

  it('outcome facet flags exception/exceeded as the error-rate summary', () => {
    const outcome = daWorkerBreakdowns.find((b) => b.id === 'breakdown-outcome');
    assert.ok(outcome);
    assert.strictEqual(outcome.summaryCountIf, "`outcome` IN ('exception', 'exceeded')");
    assert.strictEqual(outcome.summaryLabel, 'error rate');
    assert.strictEqual(outcome.summaryColor, 'error');
  });

  it('ray-id facet excludes empty and internal service-binding ("0") values', () => {
    const rayId = daWorkerBreakdowns.find((b) => b.id === 'breakdown-ray-id');
    assert.ok(rayId);
    assert.include(rayId.extraFilter, "`ray_id` != ''");
    assert.include(rayId.extraFilter, "`ray_id` != '0'");
  });

  it('logs and exceptions facets arrayJoin their column and cap the time range', () => {
    const logs = daWorkerBreakdowns.find((b) => b.id === 'breakdown-logs');
    const exceptions = daWorkerBreakdowns.find((b) => b.id === 'breakdown-exceptions');
    assert.strictEqual(logs.col, 'arrayJoin(`logs`)');
    assert.strictEqual(logs.filterOp, 'HAS');
    assert.strictEqual(logs.maxTimeRangeHours, 24);
    assert.strictEqual(exceptions.col, 'arrayJoin(`exceptions`)');
    assert.strictEqual(exceptions.filterOp, 'HAS');
    assert.strictEqual(exceptions.maxTimeRangeHours, 24);
  });

  it('url and script-version facets are marked high cardinality', () => {
    const url = daWorkerBreakdowns.find((b) => b.id === 'breakdown-url');
    const version = daWorkerBreakdowns.find((b) => b.id === 'breakdown-script-version');
    assert.strictEqual(url.highCardinality, true);
    assert.strictEqual(version.highCardinality, true);
  });
});
