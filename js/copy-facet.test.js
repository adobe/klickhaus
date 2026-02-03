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
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock DOM environment
globalThis.document = {
  getElementById: (id) => {
    if (id === 'test-facet') {
      return {
        dataset: {
          facetData: JSON.stringify({
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
          }),
        },
        querySelector: mock.fn(() => ({
          textContent: 'copy',
          style: {},
        })),
      };
    }
    if (id === 'bytes-facet') {
      return {
        dataset: {
          facetData: JSON.stringify({
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
          }),
        },
        querySelector: mock.fn(() => ({
          textContent: 'copy',
          style: {},
        })),
      };
    }
    return null;
  },
};

// Mock navigator.clipboard
Object.defineProperty(globalThis, 'navigator', {
  value: {
    clipboard: {
      writeText: mock.fn(async (text) => {
        globalThis.lastCopiedText = text;
      }),
    },
  },
  writable: true,
});

// Import module after mocking
const { copyFacetAsTsv } = await import('./copy-facet.js');

describe('copyFacetAsTsv', () => {
  it('should copy facet data as TSV with headers', async () => {
    const result = await copyFacetAsTsv('test-facet');

    assert.equal(result, true, 'Copy should succeed');
    assert.ok(globalThis.lastCopiedText, 'Should have copied text');

    const lines = globalThis.lastCopiedText.split('\n');
    assert.equal(lines[0], 'Value\tCount\tOK (2xx/3xx)\t4xx\t5xx', 'Should have correct headers');
    assert.equal(lines[1], 'value1\t100\t90\t5\t5', 'Should have first data row');
    assert.equal(lines[2], 'value2\t50\t48\t1\t1', 'Should have second data row');
  });

  it('should handle bytes mode', async () => {
    const result = await copyFacetAsTsv('bytes-facet');

    assert.equal(result, true, 'Copy should succeed');

    const lines = globalThis.lastCopiedText.split('\n');
    assert.equal(lines[1], 'large.jpg\t1048576\t1048576\t0\t0', 'Should preserve raw byte values');
  });

  it('should return false for non-existent facet', async () => {
    const result = await copyFacetAsTsv('non-existent');

    assert.equal(result, false, 'Should return false for missing facet');
  });

  it('should handle empty dimension as (empty)', async () => {
    globalThis.document.getElementById = (id) => {
      if (id === 'empty-facet') {
        return {
          dataset: {
            facetData: JSON.stringify({
              title: 'Empty Test',
              data: [
                {
                  dim: '', cnt: 10, cnt_ok: 10, cnt_4xx: 0, cnt_5xx: 0,
                },
              ],
              mode: 'count',
            }),
          },
          querySelector: mock.fn(() => ({
            textContent: 'copy',
            style: {},
          })),
        };
      }
      return null;
    };

    const result = await copyFacetAsTsv('empty-facet');
    assert.equal(result, true, 'Copy should succeed');

    const lines = globalThis.lastCopiedText.split('\n');
    assert.equal(lines[1], '(empty)\t10\t10\t0\t0', 'Should show (empty) for blank dimension');
  });
});
