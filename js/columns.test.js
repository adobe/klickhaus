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
import { buildLogColumnsSql, LOG_COLUMN_ORDER } from './columns.js';

describe('buildLogColumnsSql', () => {
  it('returns backtick-quoted column list', () => {
    const result = buildLogColumnsSql();
    assert.include(result, '`timestamp`');
    assert.include(result, '`request.host`');
    assert.include(result, '`response.status`');
  });

  it('includes always-needed columns', () => {
    const result = buildLogColumnsSql();
    assert.include(result, '`timestamp`');
    assert.include(result, '`source`');
    assert.notInclude(result, '`sample_hash`');
  });

  it('includes all LOG_COLUMN_ORDER columns', () => {
    const result = buildLogColumnsSql();
    for (const col of LOG_COLUMN_ORDER) {
      assert.include(result, `\`${col}\``, `missing column: ${col}`);
    }
  });

  it('does not duplicate columns', () => {
    // timestamp is in both ALWAYS_NEEDED and LOG_COLUMN_ORDER
    const result = buildLogColumnsSql();
    const matches = result.match(/`timestamp`/g);
    assert.strictEqual(matches.length, 1, 'timestamp should appear exactly once');
  });

  it('includes pinned columns', () => {
    const result = buildLogColumnsSql(['custom.column']);
    assert.include(result, '`custom.column`');
  });

  it('does not duplicate pinned columns already in the list', () => {
    const result = buildLogColumnsSql(['request.host']);
    const matches = result.match(/`request\.host`/g);
    assert.strictEqual(matches.length, 1, 'request.host should appear exactly once');
  });

  it('returns comma-separated values', () => {
    const result = buildLogColumnsSql();
    const parts = result.split(', ');
    assert.ok(parts.length > 5, 'should have many columns');
    for (const part of parts) {
      assert.match(part, /^`[^`]+`$/, `each part should be backtick-quoted: ${part}`);
    }
  });

  it('starts with always-needed columns', () => {
    const result = buildLogColumnsSql();
    const parts = result.split(', ');
    assert.strictEqual(parts[0], '`timestamp`');
    assert.strictEqual(parts[1], '`source`');
  });
});
