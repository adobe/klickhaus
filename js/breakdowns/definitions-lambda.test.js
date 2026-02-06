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
import { assert } from 'chai';
import { lambdaBreakdowns } from './definitions-lambda.js';

describe('lambdaBreakdowns', () => {
  it('has six facets', () => {
    assert.strictEqual(lambdaBreakdowns.length, 6);
  });

  it('each facet has id and col', () => {
    const ids = [
      'breakdown-level',
      'breakdown-function-name',
      'breakdown-app-name',
      'breakdown-subsystem',
      'breakdown-log-group',
      'breakdown-admin-method',
    ];
    lambdaBreakdowns.forEach((b, i) => {
      assert.strictEqual(b.id, ids[i]);
      assert.isString(b.col);
    });
  });

  it('level facet has summaryCountIf for error rate', () => {
    const levelFacet = lambdaBreakdowns.find((b) => b.id === 'breakdown-level');
    assert.ok(levelFacet);
    assert.strictEqual(levelFacet.summaryCountIf, "`level` = 'ERROR'");
    assert.strictEqual(levelFacet.summaryLabel, 'error rate');
  });

  it('function_name and log_group are high cardinality', () => {
    const fn = lambdaBreakdowns.find((b) => b.id === 'breakdown-function-name');
    const lg = lambdaBreakdowns.find((b) => b.id === 'breakdown-log-group');
    assert.strictEqual(fn.highCardinality, true);
    assert.strictEqual(lg.highCardinality, true);
  });

  it('admin-method facet has col for message_json.admin.method', () => {
    const adminMethod = lambdaBreakdowns.find((b) => b.id === 'breakdown-admin-method');
    assert.ok(adminMethod);
    assert.include(adminMethod.col, 'message_json');
    assert.include(adminMethod.col, 'admin');
    assert.include(adminMethod.col, 'method');
  });
});
