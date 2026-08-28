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
import { state } from './state.js';
import { rowsToCsv, rowsToJson, exportLogs } from './export-logs.js';

describe('export-logs', () => {
  let savedPinned;
  let savedUserOrder;
  let savedLogOrder;

  beforeEach(() => {
    savedPinned = state.pinnedColumns;
    savedUserOrder = state.userLogColumnOrder;
    savedLogOrder = state.logColumnOrder;
    state.pinnedColumns = [];
    state.userLogColumnOrder = null;
    state.logColumnOrder = null;
  });

  afterEach(() => {
    state.pinnedColumns = savedPinned;
    state.userLogColumnOrder = savedUserOrder;
    state.logColumnOrder = savedLogOrder;
  });

  describe('rowsToCsv', () => {
    it('produces a header row followed by data rows', () => {
      const rows = [
        { 'response.status': 200, 'request.url': '/index.html' },
        { 'response.status': 404, 'request.url': '/missing' },
      ];
      const csv = rowsToCsv(rows);
      const lines = csv.split('\r\n');
      assert.strictEqual(lines.length, 3);
      assert.include(lines[0], 'response.status');
      assert.include(lines[0], 'request.url');
      assert.include(lines[1], '200');
      assert.include(lines[2], '404');
    });

    it('quotes and escapes values containing commas, quotes, and newlines', () => {
      const rows = [{ 'request.url': 'a,b', 'response.headers.x_error': 'say "hi"' }];
      const csv = rowsToCsv(rows);
      const dataLine = csv.split('\r\n')[1];
      assert.include(dataLine, '"a,b"');
      assert.include(dataLine, '"say ""hi"""');
    });

    it('renders empty for null/undefined and JSON-stringifies objects', () => {
      const rows = [{ a: null, b: undefined, c: { x: 1 } }];
      const csv = rowsToCsv(rows);
      const dataLine = csv.split('\r\n')[1];
      // a and b are empty, c is JSON (quoted because it contains a comma-free but
      // still object-serialized string with quotes around keys)
      assert.strictEqual(dataLine, ',,"{""x"":1}"');
    });

    it('respects pinned columns first', () => {
      state.pinnedColumns = ['request.url'];
      const rows = [{ 'response.status': 200, 'request.url': '/a' }];
      const csv = rowsToCsv(rows);
      const header = csv.split('\r\n')[0];
      assert.isTrue(header.startsWith('request.url'));
    });
  });

  describe('rowsToJson', () => {
    it('nests dot-notation keys into objects', () => {
      const rows = [{ 'response.status': 200, 'request.url': '/a' }];
      const parsed = JSON.parse(rowsToJson(rows));
      assert.isArray(parsed);
      assert.strictEqual(parsed[0].response.status, 200);
      assert.strictEqual(parsed[0].request.url, '/a');
    });

    it('skips empty values', () => {
      const rows = [{ 'response.status': 200, 'response.headers.x_error': '' }];
      const parsed = JSON.parse(rowsToJson(rows));
      assert.strictEqual(parsed[0].response.status, 200);
      assert.notProperty(parsed[0].response.headers || {}, 'x_error');
    });
  });

  describe('exportLogs', () => {
    let savedLogsData;
    let originalClick;
    let lastDownload;

    beforeEach(() => {
      savedLogsData = state.logsData;
      lastDownload = null;
      originalClick = HTMLAnchorElement.prototype.click;
      // Intercept the download so no real navigation/file save happens.
      HTMLAnchorElement.prototype.click = function click() {
        if (this.download) {
          lastDownload = { name: this.download, href: this.href };
        }
      };
    });

    afterEach(() => {
      HTMLAnchorElement.prototype.click = originalClick;
      state.logsData = savedLogsData;
      document.getElementById('export-feedback')?.remove();
    });

    it('downloads a .csv file and shows a toast for csv', () => {
      state.logsData = [{ 'response.status': 200, 'request.url': '/a' }];
      exportLogs('csv');
      assert.isNotNull(lastDownload);
      assert.match(lastDownload.name, /^delivery-logs-.*\.csv$/);
      assert.match(lastDownload.href, /^blob:/);
      assert.strictEqual(
        document.getElementById('export-feedback').textContent,
        'Exported 1 row as CSV',
      );
    });

    it('downloads a .json file for json', () => {
      state.logsData = [
        { 'response.status': 200, 'request.url': '/a' },
        { 'response.status': 404, 'request.url': '/b' },
      ];
      exportLogs('json');
      assert.isNotNull(lastDownload);
      assert.match(lastDownload.name, /^delivery-logs-.*\.json$/);
      assert.strictEqual(
        document.getElementById('export-feedback').textContent,
        'Exported 2 rows as JSON',
      );
    });

    it('does not download and warns when there are no rows', () => {
      state.logsData = [];
      exportLogs('csv');
      assert.isNull(lastDownload);
      assert.include(
        document.getElementById('export-feedback').textContent,
        'No logs to export',
      );
    });

    it('does not download when logsData is null', () => {
      state.logsData = null;
      exportLogs('json');
      assert.isNull(lastDownload);
    });
  });
});
