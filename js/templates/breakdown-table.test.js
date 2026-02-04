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
import { formatNumber } from '../format.js';
import {
  formatDimWithPrefix,
  buildDimParts,
  buildBreakdownRow,
  buildOtherRow,
} from './breakdown-table.js';

describe('formatDimWithPrefix', () => {
  it('returns escaped dim when no prefixes', () => {
    const result = formatDimWithPrefix('example.com', undefined, undefined);
    assert.strictEqual(result, 'example.com');
  });

  it('returns escaped dim when prefixes array is empty', () => {
    const result = formatDimWithPrefix('example.com', [], undefined);
    assert.strictEqual(result, 'example.com');
  });

  it('dims matching prefix', () => {
    const result = formatDimWithPrefix(
      'https://www.example.com',
      ['https://www.', 'https://'],
      undefined,
    );
    assert.include(result, 'dim-prefix');
    assert.include(result, 'https://www.');
    assert.include(result, 'example.com');
  });

  it('uses custom format function when provided', () => {
    const fn = (dim) => `<em>${dim}</em>`;
    const result = formatDimWithPrefix('val', ['prefix'], fn);
    assert.strictEqual(result, '<em>val</em>');
  });

  it('escapes HTML in dim and prefix', () => {
    const result = formatDimWithPrefix(
      '<b>bold</b>',
      [],
      undefined,
    );
    assert.include(result, '&lt;b&gt;');
    assert.notInclude(result, '<b>');
  });

  it('returns escaped dim when no prefix matches', () => {
    const result = formatDimWithPrefix('value', ['other/'], undefined);
    assert.strictEqual(result, 'value');
  });
});

describe('buildDimParts', () => {
  it('returns formatted dim and no link for basic row', () => {
    const { formattedDim, linkUrl } = buildDimParts({
      row: { dim: 'example.com' },
      dim: 'example.com',
      col: '`request.host`',
      linkPrefix: undefined,
      linkSuffix: undefined,
      linkFn: undefined,
      dimPrefixes: undefined,
      dimFormatFn: undefined,
    });
    assert.include(formattedDim, 'example.com');
    assert.isNull(linkUrl);
  });

  it('builds link from linkPrefix', () => {
    const { linkUrl } = buildDimParts({
      row: { dim: 'example.com' },
      dim: 'example.com',
      col: '`request.host`',
      linkPrefix: 'https://',
      linkSuffix: '',
      linkFn: undefined,
      dimPrefixes: undefined,
      dimFormatFn: undefined,
    });
    assert.strictEqual(linkUrl, 'https://example.com');
  });

  it('builds link from linkFn', () => {
    const { linkUrl } = buildDimParts({
      row: { dim: '/page' },
      dim: '/page',
      col: '`request.url`',
      linkPrefix: undefined,
      linkSuffix: undefined,
      linkFn: (val) => `https://host${val}`,
      dimPrefixes: undefined,
      dimFormatFn: undefined,
    });
    assert.strictEqual(linkUrl, 'https://host/page');
  });

  it('blocks unsafe schemes', () => {
    const unsafeScheme = ['java', 'script:alert(1)'].join('');
    const { linkUrl } = buildDimParts({
      row: { dim: 'evil' },
      dim: 'evil',
      col: '`request.headers.referer`',
      linkPrefix: undefined,
      linkSuffix: undefined,
      linkFn: () => unsafeScheme,
      dimPrefixes: undefined,
      dimFormatFn: undefined,
    });
    assert.isNull(linkUrl);
  });

  it('sanitizes and encodes URLs', () => {
    const { linkUrl } = buildDimParts({
      row: { dim: 'encoded' },
      dim: 'encoded',
      col: '`request.url`',
      linkPrefix: undefined,
      linkSuffix: undefined,
      linkFn: () => 'https://example.com/path?q="test"&x=1',
      dimPrefixes: undefined,
      dimFormatFn: undefined,
    });
    assert.strictEqual(linkUrl, 'https://example.com/path?q=%22test%22&x=1');
  });

  it('wraps synthetic buckets in dim-prefix span', () => {
    const { formattedDim } = buildDimParts({
      row: { dim: '(empty)' },
      dim: '(empty)',
      col: '`request.host`',
      linkPrefix: undefined,
      linkSuffix: undefined,
      linkFn: undefined,
      dimPrefixes: undefined,
      dimFormatFn: undefined,
    });
    assert.include(formattedDim, 'dim-prefix');
  });

  it('does not link synthetic buckets', () => {
    const { linkUrl } = buildDimParts({
      row: { dim: '(other)' },
      dim: '(other)',
      col: '`request.host`',
      linkPrefix: 'https://',
      linkSuffix: '',
      linkFn: undefined,
      dimPrefixes: undefined,
      dimFormatFn: undefined,
    });
    assert.isNull(linkUrl);
  });
});

describe('buildBreakdownRow', () => {
  const baseParams = {
    col: '`request.host`',
    maxCount: 1000,
    columnFilters: [],
    valueFormatter: formatNumber,
    linkPrefix: undefined,
    linkSuffix: undefined,
    linkFn: undefined,
    dimPrefixes: undefined,
    dimFormatFn: undefined,
    filterCol: undefined,
    filterValueFn: undefined,
    filterOp: undefined,
    rowIndex: 0,
  };

  it('renders a basic row with bar segments', () => {
    const html = buildBreakdownRow({
      ...baseParams,
      row: {
        dim: 'example.com', cnt: '500', cnt_ok: '400', cnt_4xx: '80', cnt_5xx: '20',
      },
    });
    assert.include(html, '<tr');
    assert.include(html, 'example.com');
    assert.include(html, 'bar-5xx');
    assert.include(html, 'bar-4xx');
    assert.include(html, 'bar-ok');
    assert.include(html, '</tr>');
  });

  it('calculates correct bar width', () => {
    const html = buildBreakdownRow({
      ...baseParams,
      maxCount: 500,
      row: {
        dim: 'host', cnt: '250', cnt_ok: '250', cnt_4xx: '0', cnt_5xx: '0',
      },
    });
    assert.include(html, 'width: 50%');
  });

  it('renders included filter state', () => {
    const html = buildBreakdownRow({
      ...baseParams,
      columnFilters: [{ value: 'example.com', exclude: false }],
      row: {
        dim: 'example.com', cnt: '100', cnt_ok: '100', cnt_4xx: '0', cnt_5xx: '0',
      },
    });
    assert.include(html, 'filter-included');
    assert.include(html, '\u2713');
  });

  it('renders excluded filter state', () => {
    const html = buildBreakdownRow({
      ...baseParams,
      columnFilters: [{ value: 'bad.com', exclude: true }],
      row: {
        dim: 'bad.com', cnt: '50', cnt_ok: '0', cnt_4xx: '50', cnt_5xx: '0',
      },
    });
    assert.include(html, 'filter-excluded');
    assert.include(html, '\u00D7');
  });

  it('renders synthetic row class', () => {
    const html = buildBreakdownRow({
      ...baseParams,
      row: {
        dim: '(empty)', cnt: '10', cnt_ok: '10', cnt_4xx: '0', cnt_5xx: '0',
      },
    });
    assert.include(html, 'synthetic-row');
  });

  it('handles empty dim', () => {
    const html = buildBreakdownRow({
      ...baseParams,
      row: {
        dim: '', cnt: '10', cnt_ok: '10', cnt_4xx: '0', cnt_5xx: '0',
      },
    });
    assert.include(html, '(empty)');
  });

  it('renders link when linkPrefix provided', () => {
    const html = buildBreakdownRow({
      ...baseParams,
      linkPrefix: 'https://',
      row: {
        dim: 'example.com', cnt: '100', cnt_ok: '100', cnt_4xx: '0', cnt_5xx: '0',
      },
    });
    assert.include(html, 'href="https://example.com"');
    assert.include(html, 'target="_blank"');
  });

  it('escapes href attributes when rendering links', () => {
    const html = buildBreakdownRow({
      ...baseParams,
      linkFn: () => 'https://example.com/path?q="test"&x=1',
      row: {
        dim: 'encoded', cnt: '100', cnt_ok: '100', cnt_4xx: '0', cnt_5xx: '0',
      },
    });
    assert.include(html, 'href="https://example.com/path?q=%22test%22&amp;x=1"');
  });

  it('includes filter data attributes', () => {
    const html = buildBreakdownRow({
      ...baseParams,
      filterCol: 'custom_col',
      filterOp: 'LIKE',
      row: {
        dim: 'val', cnt: '10', cnt_ok: '10', cnt_4xx: '0', cnt_5xx: '0',
      },
    });
    assert.include(html, 'data-filter-col="custom_col"');
    assert.include(html, 'data-filter-op="LIKE"');
  });

  it('uses filterValueFn when provided', () => {
    const html = buildBreakdownRow({
      ...baseParams,
      filterValueFn: (v) => `%${v}%`,
      row: {
        dim: 'val', cnt: '10', cnt_ok: '10', cnt_4xx: '0', cnt_5xx: '0',
      },
    });
    assert.include(html, 'data-filter-value="%val%"');
  });

  it('sets aria-selected and role attributes', () => {
    const html = buildBreakdownRow({
      ...baseParams,
      row: {
        dim: 'x', cnt: '1', cnt_ok: '1', cnt_4xx: '0', cnt_5xx: '0',
      },
      rowIndex: 5,
    });
    assert.include(html, 'role="option"');
    assert.include(html, 'aria-selected="false"');
    assert.include(html, 'data-value-index="5"');
  });
});

describe('buildOtherRow', () => {
  const baseParams = {
    maxCount: 1000,
    rowIndex: 10,
    col: '`request.host`',
    id: 'hosts',
    title: 'Hosts',
    filterCol: undefined,
    valueFormatter: formatNumber,
  };

  it('renders continuous more row', () => {
    const html = buildOtherRow({
      ...baseParams,
      otherRow: null,
      nextN: 20,
      isContinuous: true,
    });
    assert.include(html, 'other-row');
    assert.include(html, '(more)');
    assert.include(html, 'increase-topn');
    assert.include(html, 'show 20 buckets');
  });

  it('renders other row with count and bar', () => {
    const html = buildOtherRow({
      ...baseParams,
      otherRow: {
        cnt: 500, cnt_ok: 400, cnt_4xx: 80, cnt_5xx: 20,
      },
      nextN: 20,
      isContinuous: false,
    });
    assert.include(html, 'other-row');
    assert.include(html, 'other-link');
    assert.include(html, 'facet-search-link');
    assert.include(html, 'bar-5xx');
    assert.include(html, 'show top 20');
  });

  it('returns empty when no other row and not continuous', () => {
    const html = buildOtherRow({
      ...baseParams,
      otherRow: null,
      nextN: 20,
      isContinuous: false,
    });
    assert.strictEqual(html, '');
  });

  it('returns empty when otherRow count is zero', () => {
    const html = buildOtherRow({
      ...baseParams,
      otherRow: {
        cnt: 0, cnt_ok: 0, cnt_4xx: 0, cnt_5xx: 0,
      },
      nextN: 20,
      isContinuous: false,
    });
    assert.strictEqual(html, '');
  });

  it('returns empty when no nextN', () => {
    const html = buildOtherRow({
      ...baseParams,
      otherRow: {
        cnt: 100, cnt_ok: 100, cnt_4xx: 0, cnt_5xx: 0,
      },
      nextN: null,
      isContinuous: false,
    });
    assert.strictEqual(html, '');
  });

  it('adds overflow class when count exceeds maxCount', () => {
    const html = buildOtherRow({
      ...baseParams,
      maxCount: 100,
      otherRow: {
        cnt: 500, cnt_ok: 400, cnt_4xx: 80, cnt_5xx: 20,
      },
      nextN: 20,
      isContinuous: false,
    });
    assert.include(html, 'bar-overflow');
    assert.include(html, 'width: 100%');
  });

  it('includes search link with data attributes', () => {
    const html = buildOtherRow({
      ...baseParams,
      filterCol: 'custom_col',
      otherRow: {
        cnt: 100, cnt_ok: 100, cnt_4xx: 0, cnt_5xx: 0,
      },
      nextN: 20,
      isContinuous: false,
    });
    assert.include(html, 'open-facet-search');
    assert.include(html, 'data-facet-id="hosts"');
    assert.include(html, 'data-filter-col="custom_col"');
  });
});
