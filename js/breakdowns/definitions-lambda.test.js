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
  it('has fourteen facets', () => {
    assert.strictEqual(lambdaBreakdowns.length, 14);
  });

  it('each facet has id and col (string or function)', () => {
    const ids = [
      'breakdown-level',
      'breakdown-function-name',
      'breakdown-function-version',
      'breakdown-app-name',
      'breakdown-subsystem',
      'breakdown-log-group',
      'breakdown-admin-method',
      'breakdown-message',
      'breakdown-request-id',
      'breakdown-url',
      'breakdown-path',
      'breakdown-ip',
      'breakdown-email',
      'breakdown-admin-duration',
    ];
    lambdaBreakdowns.forEach((b, i) => {
      assert.strictEqual(b.id, ids[i]);
      assert.ok(typeof b.col === 'string' || typeof b.col === 'function');
    });
  });

  it('level facet has summaryCountIf for error rate', () => {
    const levelFacet = lambdaBreakdowns.find((b) => b.id === 'breakdown-level');
    assert.ok(levelFacet);
    assert.strictEqual(levelFacet.summaryCountIf, "lower(`level`) = 'error'");
    assert.strictEqual(levelFacet.summaryLabel, 'error rate');
  });

  it('function_name strips version and function_version is last segment', () => {
    const fn = lambdaBreakdowns.find((b) => b.id === 'breakdown-function-name');
    const fv = lambdaBreakdowns.find((b) => b.id === 'breakdown-function-version');
    assert.ok(fn);
    assert.ok(fv);
    assert.include(fn.col, 'replaceRegexpOne');
    assert.include(fn.col, "'/[^/]+$'");
    assert.include(fv.col, "arrayElement(splitByChar('/', `function_name`), -1)");
    assert.strictEqual(fn.highCardinality, true);
    assert.strictEqual(fv.highCardinality, true);
  });

  it('log_group is high cardinality', () => {
    const lg = lambdaBreakdowns.find((b) => b.id === 'breakdown-log-group');
    assert.strictEqual(lg.highCardinality, true);
  });

  it('admin-method facet has col for message_json.admin.method', () => {
    const adminMethod = lambdaBreakdowns.find((b) => b.id === 'breakdown-admin-method');
    assert.ok(adminMethod);
    assert.include(adminMethod.col, 'message_json');
    assert.include(adminMethod.col, 'admin');
    assert.include(adminMethod.col, 'method');
  });

  it('message facet has col for message and is high cardinality', () => {
    const messageFacet = lambdaBreakdowns.find((b) => b.id === 'breakdown-message');
    assert.ok(messageFacet);
    assert.strictEqual(messageFacet.col, '`message`');
    assert.strictEqual(messageFacet.highCardinality, true);
  });

  it('request_id facet has col for request_id and is high cardinality', () => {
    const requestIdFacet = lambdaBreakdowns.find((b) => b.id === 'breakdown-request-id');
    assert.ok(requestIdFacet);
    assert.strictEqual(requestIdFacet.col, '`request_id`');
    assert.strictEqual(requestIdFacet.highCardinality, true);
  });

  it('array facets (url, path, ip, email) use arrayJoin, filterCol, filterOp HAS, and highCardinality', () => {
    const arrayFacets = [
      { id: 'breakdown-url', col: 'arrayJoin(`urls`)', filterCol: '`urls`' },
      { id: 'breakdown-path', col: 'arrayJoin(`paths`)', filterCol: '`paths`' },
      { id: 'breakdown-ip', col: 'arrayJoin(`ips`)', filterCol: '`ips`' },
      { id: 'breakdown-email', col: 'arrayJoin(`emails`)', filterCol: '`emails`' },
    ];
    for (const spec of arrayFacets) {
      const facet = lambdaBreakdowns.find((b) => b.id === spec.id);
      assert.ok(facet, spec.id);
      assert.strictEqual(facet.col, spec.col);
      assert.strictEqual(facet.filterCol, spec.filterCol);
      assert.strictEqual(facet.filterOp, 'HAS');
      assert.strictEqual(facet.highCardinality, true);
    }
  });

  it('admin-duration facet is bucketed with rawCol and getExpectedLabels', () => {
    const adminDuration = lambdaBreakdowns.find((b) => b.id === 'breakdown-admin-duration');
    assert.ok(adminDuration);
    assert.strictEqual(typeof adminDuration.col, 'function');
    assert.include(adminDuration.rawCol, 'message_json.admin.duration');
    assert.strictEqual(typeof adminDuration.getExpectedLabels, 'function');
  });
});
