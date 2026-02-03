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
import { interpolate, loadSql, preloadAllTemplates } from './sql-loader.js';

describe('interpolate', () => {
  it('replaces single placeholder', () => {
    assert.strictEqual(
      interpolate('SELECT * FROM {{table}}', { table: 'cdn_requests_v2' }),
      'SELECT * FROM cdn_requests_v2',
    );
  });

  it('replaces multiple placeholders', () => {
    const result = interpolate(
      'SELECT {{col}} FROM {{db}}.{{table}} WHERE {{filter}}',
      {
        col: 'host', db: 'helix_logs_production', table: 'cdn_requests_v2', filter: '1=1',
      },
    );
    assert.strictEqual(result, 'SELECT host FROM helix_logs_production.cdn_requests_v2 WHERE 1=1');
  });

  it('replaces repeated placeholders', () => {
    assert.strictEqual(
      interpolate('{{x}} + {{x}}', { x: '1' }),
      '1 + 1',
    );
  });

  it('throws on missing parameter', () => {
    assert.throws(
      () => interpolate('SELECT {{missing}}', {}),
      /Missing SQL template parameter: missing/,
    );
  });

  it('handles empty params with no placeholders', () => {
    assert.strictEqual(
      interpolate('SELECT 1', {}),
      'SELECT 1',
    );
  });

  it('preserves non-placeholder braces', () => {
    assert.strictEqual(
      interpolate('WHERE x IN {1,2} AND y = {{val}}', { val: '3' }),
      'WHERE x IN {1,2} AND y = 3',
    );
  });

  it('handles empty string values', () => {
    assert.strictEqual(
      interpolate('WHERE {{filter}}', { filter: '' }),
      'WHERE ',
    );
  });
});

describe('loadSql', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = window.fetch;
  });

  afterEach(() => {
    window.fetch = originalFetch;
  });

  it('fetches template and interpolates params', async () => {
    window.fetch = async (url) => {
      assert.match(url, /\/sql\/queries\/test-query\.sql$/);
      return { ok: true, text: async () => 'SELECT {{col}} FROM {{table}}' };
    };
    const result = await loadSql('test-query', { col: 'host', table: 'cdn' });
    assert.strictEqual(result, 'SELECT host FROM cdn');
  });

  it('throws on fetch failure', async () => {
    window.fetch = async () => ({ ok: false, status: 404 });
    try {
      await loadSql('not-found', {});
      assert.fail('should have thrown');
    } catch (e) {
      assert.include(e.message, 'Failed to load SQL template: not-found');
    }
  });
});

describe('preloadAllTemplates', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = window.fetch;
  });

  afterEach(() => {
    window.fetch = originalFetch;
  });

  it('fetches all templates in parallel', async () => {
    const fetched = [];
    window.fetch = async (url) => {
      fetched.push(url);
      return { ok: true, text: async () => 'SELECT 1' };
    };
    await preloadAllTemplates();
    assert.ok(fetched.length > 0, 'should fetch at least one template');
    assert.ok(fetched.some((u) => u.includes('time-series.sql')));
    assert.ok(fetched.some((u) => u.includes('breakdown.sql')));
  });
});
