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
import {
  formatLogCell,
  buildLogCellHtml,
  buildLogRowHtml,
  buildLogTableHeaderHtml,
  buildGapRowHtml,
} from './logs-table.js';

describe('formatLogCell', () => {
  it('formats timestamp column', () => {
    const { displayValue, cellClass } = formatLogCell(
      'timestamp',
      '2025-01-15T10:30:00Z',
    );
    assert.strictEqual(cellClass, 'timestamp');
    assert.ok(displayValue.length > 0);
  });

  it('formats 2xx status', () => {
    const { displayValue, cellClass } = formatLogCell('response.status', '200');
    assert.strictEqual(displayValue, '200');
    assert.strictEqual(cellClass, 'status-ok');
  });

  it('formats 4xx status', () => {
    const { displayValue, cellClass } = formatLogCell('response.status', '404');
    assert.strictEqual(displayValue, '404');
    assert.strictEqual(cellClass, 'status-4xx');
  });

  it('formats 5xx status', () => {
    const { displayValue, cellClass } = formatLogCell('response.status', '503');
    assert.strictEqual(displayValue, '503');
    assert.strictEqual(cellClass, 'status-5xx');
  });

  it('formats body size as bytes', () => {
    const { displayValue } = formatLogCell('response.body_size', '1048576');
    assert.ok(displayValue.length > 0);
    // formatBytes should produce human-readable output
    assert.notStrictEqual(displayValue, '1048576');
  });

  it('formats request method', () => {
    const { displayValue, cellClass } = formatLogCell('request.method', 'GET');
    assert.strictEqual(displayValue, 'GET');
    assert.strictEqual(cellClass, 'method');
  });

  it('handles null/empty values', () => {
    const { displayValue } = formatLogCell('request.url', null);
    assert.strictEqual(displayValue, '');
  });

  it('handles empty string values', () => {
    const { displayValue } = formatLogCell('request.url', '');
    assert.strictEqual(displayValue, '');
  });

  it('stringifies objects', () => {
    const { displayValue } = formatLogCell('custom', { key: 'value' });
    assert.strictEqual(displayValue, '{"key":"value"}');
  });

  it('converts other values to string', () => {
    const { displayValue } = formatLogCell('custom', 42);
    assert.strictEqual(displayValue, '42');
  });

  it('returns color indicator for values with color rules', () => {
    const { colorIndicator } = formatLogCell('response.status', '500');
    assert.include(colorIndicator, 'log-color');
  });

  it('returns empty color indicator for null values', () => {
    const { colorIndicator } = formatLogCell('response.status', null);
    assert.strictEqual(colorIndicator, '');
  });
});

describe('buildLogCellHtml', () => {
  it('builds a basic cell', () => {
    const html = buildLogCellHtml({
      col: 'request.url',
      value: '/page',
      pinned: [],
      pinnedOffsets: {},
    });
    assert.include(html, '<td');
    assert.include(html, '/page');
    assert.include(html, 'title=');
  });

  it('adds pinned class and offset', () => {
    const html = buildLogCellHtml({
      col: 'timestamp',
      value: '2025-01-15T10:30:00Z',
      pinned: ['timestamp'],
      pinnedOffsets: { timestamp: 42 },
    });
    assert.include(html, 'pinned');
    assert.include(html, 'left: 42px');
  });

  it('does not add pinned class for unpinned column', () => {
    const html = buildLogCellHtml({
      col: 'request.url',
      value: '/page',
      pinned: ['timestamp'],
      pinnedOffsets: { timestamp: 0 },
    });
    assert.notInclude(html, 'pinned');
  });
});

describe('buildLogRowHtml', () => {
  it('builds a row with multiple cells', () => {
    const row = {
      'request.url': '/page',
      'response.status': '200',
    };
    const html = buildLogRowHtml({
      row,
      columns: ['request.url', 'response.status'],
      rowIdx: 3,
      pinned: [],
      pinnedOffsets: {},
    });
    assert.include(html, '<tr');
    assert.include(html, 'data-row-idx="3"');
    assert.include(html, '/page');
    assert.include(html, '200');
    assert.include(html, '</tr>');
  });
});

describe('buildLogTableHeaderHtml', () => {
  it('builds header cells', () => {
    const html = buildLogTableHeaderHtml(
      ['timestamp', 'request.url'],
      [],
      {},
    );
    assert.include(html, '<th');
    assert.include(html, 'toggle-pinned-column');
  });

  it('adds pinned class to pinned columns', () => {
    const html = buildLogTableHeaderHtml(
      ['timestamp'],
      ['timestamp'],
      { timestamp: 0 },
    );
    assert.include(html, 'pinned');
    assert.include(html, 'left: 0px');
  });

  it('uses short labels when available', () => {
    // response.status has shortLabel 'status' in LOG_COLUMN_SHORT_LABELS
    const html = buildLogTableHeaderHtml(
      ['response.status'],
      [],
      {},
    );
    assert.include(html, 'title="response.status"');
    assert.include(html, '>status</th>');
  });
});

describe('buildGapRowHtml', () => {
  it('renders a gap row with time range', () => {
    const gap = {
      isGap: true,
      gapStart: '2026-02-12 10:00:00.000',
      gapEnd: '2026-02-12 06:00:00.000',
      gapLoading: false,
    };
    const html = buildGapRowHtml({
      gap, rowIdx: 5, colCount: 8,
    });
    assert.include(html, 'logs-gap-row');
    assert.include(html, 'data-row-idx="5"');
    assert.include(html, 'data-gap="true"');
    assert.include(html, 'colspan="8"');
    assert.include(html, 'load-gap');
    assert.include(html, 'data-gap-idx="5"');
    assert.include(html, '4h gap');
  });

  it('renders loading state', () => {
    const gap = {
      isGap: true,
      gapStart: '2026-02-12 10:00:00.000',
      gapEnd: '2026-02-12 09:30:00.000',
      gapLoading: true,
    };
    const html = buildGapRowHtml({
      gap, rowIdx: 2, colCount: 5,
    });
    assert.include(html, 'loading');
    assert.include(html, 'logs-gap-spinner');
    assert.include(html, 'Loading');
  });

  it('shows minutes for short gaps', () => {
    const gap = {
      isGap: true,
      gapStart: '2026-02-12 10:30:00.000',
      gapEnd: '2026-02-12 10:00:00.000',
      gapLoading: false,
    };
    const html = buildGapRowHtml({
      gap, rowIdx: 0, colCount: 3,
    });
    assert.include(html, '30m gap');
  });

  it('shows days for multi-day gaps', () => {
    const gap = {
      isGap: true,
      gapStart: '2026-02-12 10:00:00.000',
      gapEnd: '2026-02-09 10:00:00.000',
      gapLoading: false,
    };
    const html = buildGapRowHtml({
      gap, rowIdx: 0, colCount: 3,
    });
    assert.include(html, '3d gap');
  });
});
