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
import { copyFacetAsTsv } from './copy-facet.js';

let lastCopiedText = '';

function createFacetCard(id, facetData) {
  const card = document.createElement('div');
  card.id = id;
  card.dataset.facetData = JSON.stringify(facetData);
  const btn = document.createElement('button');
  btn.dataset.action = 'copy-facet-tsv';
  btn.textContent = 'copy';
  card.appendChild(btn);
  document.body.appendChild(card);
  return card;
}

beforeEach(() => {
  document.body.innerHTML = '';
  lastCopiedText = '';
  navigator.clipboard.writeText = async (text) => {
    lastCopiedText = text;
  };
});

describe('copyFacetAsTsv', () => {
  it('should copy facet data as TSV with headers', async () => {
    createFacetCard('test-facet', {
      title: 'Test Facet',
      data: [
        {
          dim: 'value1', cnt: 100, cnt_ok: 90, cnt_4xx: 5, cnt_5xx: 5,
        },
        {
          dim: 'value2', cnt: 50, cnt_ok: 48, cnt_4xx: 1, cnt_5xx: 1,
        },
      ],
      totals: {
        cnt: 150, cnt_ok: 138, cnt_4xx: 6, cnt_5xx: 6,
      },
      mode: 'count',
    });

    const result = await copyFacetAsTsv('test-facet');

    assert.strictEqual(result, true, 'Copy should succeed');
    assert.ok(lastCopiedText, 'Should have copied text');

    const lines = lastCopiedText.split('\n');
    assert.strictEqual(lines[0], 'Value\tCount\tOK (2xx/3xx)\t4xx\t5xx', 'Should have correct headers');
    assert.strictEqual(lines[1], 'value1\t100\t90\t5\t5', 'Should have first data row');
    assert.strictEqual(lines[2], 'value2\t50\t48\t1\t1', 'Should have second data row');
  });

  it('should handle bytes mode', async () => {
    createFacetCard('bytes-facet', {
      title: 'Bytes Facet',
      data: [
        {
          dim: 'large.jpg', cnt: 1048576, cnt_ok: 1048576, cnt_4xx: 0, cnt_5xx: 0,
        },
      ],
      totals: {
        cnt: 1048576, cnt_ok: 1048576, cnt_4xx: 0, cnt_5xx: 0,
      },
      mode: 'bytes',
    });

    const result = await copyFacetAsTsv('bytes-facet');

    assert.strictEqual(result, true, 'Copy should succeed');

    const lines = lastCopiedText.split('\n');
    assert.strictEqual(lines[1], 'large.jpg\t1048576\t1048576\t0\t0', 'Should preserve raw byte values');
  });

  it('should return false for non-existent facet', async () => {
    const result = await copyFacetAsTsv('non-existent');

    assert.strictEqual(result, false, 'Should return false for missing facet');
  });

  it('should return false and show error feedback when clipboard fails', async () => {
    createFacetCard('fail-facet', {
      title: 'Fail Test',
      data: [
        {
          dim: 'x', cnt: 1, cnt_ok: 1, cnt_4xx: 0, cnt_5xx: 0,
        },
      ],
      mode: 'count',
    });

    navigator.clipboard.writeText = async () => {
      throw new Error('Clipboard blocked');
    };

    const result = await copyFacetAsTsv('fail-facet');
    assert.strictEqual(result, false, 'Should return false on clipboard error');

    const btn = document.querySelector('[data-action="copy-facet-tsv"]');
    assert.strictEqual(btn.textContent, '\u2717', 'Should show failure icon');
  });

  it('should restore button text after feedback timeout', async () => {
    const origSetTimeout = window.setTimeout;
    const pendingCallbacks = [];
    window.setTimeout = (fn) => {
      pendingCallbacks.push(fn);
    };

    createFacetCard('timeout-facet', {
      title: 'Timeout Test',
      data: [
        {
          dim: 'a', cnt: 1, cnt_ok: 1, cnt_4xx: 0, cnt_5xx: 0,
        },
      ],
      mode: 'count',
    });

    await copyFacetAsTsv('timeout-facet');

    const btn = document.querySelector('[data-action="copy-facet-tsv"]');
    assert.strictEqual(btn.textContent, '\u2713', 'Should show success icon');

    // Execute the pending setTimeout callback
    pendingCallbacks.forEach((cb) => cb());

    assert.strictEqual(btn.textContent, 'copy', 'Should restore original text');
    assert.strictEqual(btn.style.color, '', 'Should clear color');

    window.setTimeout = origSetTimeout;
  });

  it('should handle empty dimension as (empty)', async () => {
    createFacetCard('empty-facet', {
      title: 'Empty Test',
      data: [
        {
          dim: '', cnt: 10, cnt_ok: 10, cnt_4xx: 0, cnt_5xx: 0,
        },
      ],
      mode: 'count',
    });

    const result = await copyFacetAsTsv('empty-facet');
    assert.strictEqual(result, true, 'Copy should succeed');

    const lines = lastCopiedText.split('\n');
    assert.strictEqual(lines[1], '(empty)\t10\t10\t0\t0', 'Should show (empty) for blank dimension');
  });
});
