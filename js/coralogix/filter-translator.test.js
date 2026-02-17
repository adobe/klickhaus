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
import {
  getFieldPath,
  escapeValue,
  translateFilter,
  translateHostFilter,
  translateFacetFilters,
  buildFilterClause,
  translateOperator,
  translateFilterWithOperator,
  translateInFilter,
} from './filter-translator.js';

describe('filter-translator', () => {
  describe('getFieldPath', () => {
    it('should convert simple column to Data Prime path', () => {
      assert.strictEqual(getFieldPath('`request.host`'), '$l.request.host');
    });

    it('should use $l namespace for request fields', () => {
      assert.strictEqual(getFieldPath('`request.method`'), '$l.request.method');
      assert.strictEqual(getFieldPath('`request.url`'), '$l.request.url');
    });

    it('should use $l namespace for response fields', () => {
      assert.strictEqual(getFieldPath('`response.status`'), '$l.response.status');
    });

    it('should use $l namespace for CDN fields', () => {
      assert.strictEqual(getFieldPath('`cdn.cache_status`'), '$l.cdn.cache_status');
      assert.strictEqual(getFieldPath('`cdn.datacenter`'), '$l.cdn.datacenter');
    });

    it('should use $l namespace for client fields', () => {
      assert.strictEqual(getFieldPath('`client.country_name`'), '$l.client.country_name');
      assert.strictEqual(getFieldPath('`client.asn`'), '$l.client.asn');
    });

    it('should use $m namespace for timestamp', () => {
      assert.strictEqual(getFieldPath('`timestamp`'), '$m.timestamp');
    });

    it('should default to $d namespace for unknown fields', () => {
      assert.strictEqual(getFieldPath('`custom.field`'), '$d.custom.field');
      assert.strictEqual(getFieldPath('`helix.request_type`'), '$d.helix.request_type');
    });

    it('should handle fields without backticks', () => {
      assert.strictEqual(getFieldPath('request.host'), '$l.request.host');
    });

    it('should handle header fields', () => {
      assert.strictEqual(getFieldPath('`request.headers.referer`'), '$d.request.headers.referer');
      assert.strictEqual(getFieldPath('`response.headers.content_type`'), '$d.response.headers.content_type');
    });
  });

  describe('escapeValue', () => {
    it('should return numbers as strings', () => {
      assert.strictEqual(escapeValue(200), '200');
      assert.strictEqual(escapeValue(0), '0');
      assert.strictEqual(escapeValue(-1), '-1');
    });

    it('should quote string values', () => {
      assert.strictEqual(escapeValue('example.com'), "'example.com'");
      assert.strictEqual(escapeValue('test'), "'test'");
    });

    it('should escape single quotes in strings', () => {
      assert.strictEqual(escapeValue("it's"), "'it\\'s'");
      assert.strictEqual(escapeValue("'quoted'"), "'\\'quoted\\''");
    });

    it('should handle null and undefined', () => {
      assert.strictEqual(escapeValue(null), 'null');
      assert.strictEqual(escapeValue(undefined), 'null');
    });

    it('should handle empty strings', () => {
      assert.strictEqual(escapeValue(''), "''");
    });

    it('should handle strings with special characters', () => {
      // Newlines are preserved as-is (not escaped) in Data Prime
      assert.strictEqual(escapeValue('hello\nworld'), "'hello\nworld'");
      assert.strictEqual(escapeValue('path/to/file'), "'path/to/file'");
    });
  });

  describe('translateFilter', () => {
    it('should translate basic include filter', () => {
      const filter = {
        col: '`request.host`',
        value: 'example.com',
        exclude: false,
      };
      assert.strictEqual(translateFilter(filter), "$l.request.host == 'example.com'");
    });

    it('should translate basic exclude filter', () => {
      const filter = {
        col: '`request.host`',
        value: 'example.com',
        exclude: true,
      };
      assert.strictEqual(translateFilter(filter), "$l.request.host != 'example.com'");
    });

    it('should handle numeric values', () => {
      const filter = {
        col: '`response.status`',
        value: 200,
        exclude: false,
      };
      assert.strictEqual(translateFilter(filter), '$l.response.status == 200');
    });

    it('should handle numeric exclude', () => {
      const filter = {
        col: '`response.status`',
        value: 404,
        exclude: true,
      };
      assert.strictEqual(translateFilter(filter), '$l.response.status != 404');
    });

    it('should use filterCol override', () => {
      const filter = {
        col: '`display.name`',
        value: 'test',
        exclude: false,
        filterCol: '`actual.column`',
      };
      assert.strictEqual(translateFilter(filter), "$d.actual.column == 'test'");
    });

    it('should use filterValue override', () => {
      const filter = {
        col: '`request.host`',
        value: 'display-value',
        exclude: false,
        filterValue: 'actual-value',
      };
      assert.strictEqual(translateFilter(filter), "$l.request.host == 'actual-value'");
    });

    it('should handle LIKE operator', () => {
      const filter = {
        col: '`request.url`',
        value: '%/api/%',
        exclude: false,
        filterOp: 'LIKE',
      };
      assert.strictEqual(translateFilter(filter), "$l.request.url.contains('/api/')");
    });

    it('should handle LIKE operator with exclude', () => {
      const filter = {
        col: '`request.url`',
        value: '%/admin%',
        exclude: true,
        filterOp: 'LIKE',
      };
      assert.strictEqual(translateFilter(filter), "!$l.request.url.contains('/admin')");
    });

    it('should handle empty values', () => {
      const filter = {
        col: '`request.headers.referer`',
        value: '',
        exclude: false,
      };
      assert.strictEqual(translateFilter(filter), "$d.request.headers.referer == ''");
    });

    it('should escape quotes in values', () => {
      const filter = {
        col: '`custom.field`',
        value: "O'Reilly",
        exclude: false,
      };
      assert.strictEqual(translateFilter(filter), "$d.custom.field == 'O\\'Reilly'");
    });
  });

  describe('translateHostFilter', () => {
    it('should translate host include filter', () => {
      assert.strictEqual(translateHostFilter('example.com'), "$l.request.host == 'example.com'");
    });

    it('should translate host exclude filter', () => {
      assert.strictEqual(translateHostFilter('example.com', true), "$l.request.host != 'example.com'");
    });

    it('should default exclude to false', () => {
      assert.strictEqual(translateHostFilter('test.com'), "$l.request.host == 'test.com'");
    });
  });

  describe('translateFacetFilters', () => {
    it('should return empty string for no filters', () => {
      assert.strictEqual(translateFacetFilters([]), '');
      assert.strictEqual(translateFacetFilters(null), '');
      assert.strictEqual(translateFacetFilters(undefined), '');
    });

    it('should translate single filter', () => {
      const filters = [
        { col: '`request.host`', value: 'example.com', exclude: false },
      ];
      assert.strictEqual(translateFacetFilters(filters), "$l.request.host == 'example.com'");
    });

    it('should combine multiple filters with AND', () => {
      const filters = [
        { col: '`request.host`', value: 'example.com', exclude: false },
        { col: '`response.status`', value: 200, exclude: false },
      ];
      assert.strictEqual(
        translateFacetFilters(filters),
        "($l.request.host == 'example.com') && ($l.response.status == 200)",
      );
    });

    it('should handle mix of include and exclude filters', () => {
      const filters = [
        { col: '`request.host`', value: 'example.com', exclude: false },
        { col: '`response.status`', value: 404, exclude: true },
      ];
      assert.strictEqual(
        translateFacetFilters(filters),
        "($l.request.host == 'example.com') && ($l.response.status != 404)",
      );
    });

    it('should handle three or more filters', () => {
      const filters = [
        { col: '`request.host`', value: 'example.com', exclude: false },
        { col: '`response.status`', value: 200, exclude: false },
        { col: '`cdn.cache_status`', value: 'HIT', exclude: false },
      ];
      assert.strictEqual(
        translateFacetFilters(filters),
        "($l.request.host == 'example.com') && ($l.response.status == 200) && ($l.cdn.cache_status == 'HIT')",
      );
    });
  });

  describe('buildFilterClause', () => {
    it('should return empty string for no filters', () => {
      assert.strictEqual(buildFilterClause([]), '');
    });

    it('should build complete filter clause', () => {
      const filters = [
        { col: '`request.host`', value: 'example.com', exclude: false },
      ];
      assert.strictEqual(buildFilterClause(filters), "| filter $l.request.host == 'example.com'");
    });

    it('should build filter clause with multiple filters', () => {
      const filters = [
        { col: '`request.host`', value: 'example.com', exclude: false },
        { col: '`response.status`', value: 200, exclude: false },
      ];
      assert.strictEqual(
        buildFilterClause(filters),
        "| filter ($l.request.host == 'example.com') && ($l.response.status == 200)",
      );
    });
  });

  describe('translateOperator', () => {
    it('should translate equality operators', () => {
      assert.strictEqual(translateOperator('=', '$d.field', 'value'), "$d.field == 'value'");
      assert.strictEqual(translateOperator('==', '$d.field', 'value'), "$d.field == 'value'");
      assert.strictEqual(translateOperator('!=', '$d.field', 'value'), "$d.field != 'value'");
    });

    it('should translate comparison operators', () => {
      assert.strictEqual(translateOperator('>', '$d.field', 100), '$d.field > 100');
      assert.strictEqual(translateOperator('<', '$d.field', 100), '$d.field < 100');
      assert.strictEqual(translateOperator('>=', '$d.field', 100), '$d.field >= 100');
      assert.strictEqual(translateOperator('<=', '$d.field', 100), '$d.field <= 100');
    });

    it('should translate string methods', () => {
      assert.strictEqual(translateOperator('contains', '$d.field', 'value'), "$d.field.contains('value')");
      assert.strictEqual(translateOperator('startsWith', '$d.field', 'prefix'), "$d.field.startsWith('prefix')");
    });

    it('should translate LIKE to contains', () => {
      assert.strictEqual(translateOperator('LIKE', '$d.field', '%pattern%'), "$d.field.contains('pattern')");
    });

    it('should fallback to equality for unknown operators', () => {
      assert.strictEqual(translateOperator('unknown', '$d.field', 'value'), "$d.field == 'value'");
    });
  });

  describe('translateFilterWithOperator', () => {
    it('should translate filter with operator', () => {
      assert.strictEqual(
        translateFilterWithOperator('`request.host`', '==', 'example.com'),
        "$l.request.host == 'example.com'",
      );
    });

    it('should translate filter with comparison operator', () => {
      assert.strictEqual(
        translateFilterWithOperator('`response.status`', '>', 400),
        '$l.response.status > 400',
      );
    });

    it('should translate filter with contains', () => {
      assert.strictEqual(
        translateFilterWithOperator('`request.url`', 'contains', '/api/'),
        "$l.request.url.contains('/api/')",
      );
    });

    it('should negate expression when exclude is true', () => {
      assert.strictEqual(
        translateFilterWithOperator('`request.host`', '==', 'example.com', true),
        "!($l.request.host == 'example.com')",
      );
    });

    it('should negate contains when exclude is true', () => {
      assert.strictEqual(
        translateFilterWithOperator('`request.url`', 'contains', '/admin', true),
        "!($l.request.url.contains('/admin'))",
      );
    });
  });

  describe('translateInFilter', () => {
    it('should return empty string for empty array', () => {
      assert.strictEqual(translateInFilter('`field`', []), '');
      assert.strictEqual(translateInFilter('`field`', null), '');
    });

    it('should use equality for single value', () => {
      assert.strictEqual(
        translateInFilter('`request.host`', ['example.com']),
        "$l.request.host == 'example.com'",
      );
    });

    it('should use inequality for single value with exclude', () => {
      assert.strictEqual(
        translateInFilter('`request.host`', ['example.com'], true),
        "$l.request.host != 'example.com'",
      );
    });

    it('should use .in() for multiple values', () => {
      assert.strictEqual(
        translateInFilter('`request.host`', ['example.com', 'test.com']),
        "$l.request.host.in(['example.com', 'test.com'])",
      );
    });

    it('should expand to multiple != conditions for exclude (NOT IN)', () => {
      assert.strictEqual(
        translateInFilter('`request.host`', ['example.com', 'test.com'], true),
        "$l.request.host != 'example.com' && $l.request.host != 'test.com'",
      );
    });

    it('should handle numeric values in list', () => {
      assert.strictEqual(
        translateInFilter('`response.status`', [200, 201, 204]),
        '$l.response.status.in([200, 201, 204])',
      );
    });

    it('should handle mixed string and number values', () => {
      assert.strictEqual(
        translateInFilter('`field`', ['value', 123, 'other']),
        "$d.field.in(['value', 123, 'other'])",
      );
    });

    it('should escape quotes in list values', () => {
      assert.strictEqual(
        translateInFilter('`field`', ["O'Reilly", 'Test']),
        "$d.field.in(['O\\'Reilly', 'Test'])",
      );
    });
  });

  describe('complex filter scenarios', () => {
    it('should handle filter with all override fields', () => {
      const filter = {
        col: '`display.column`',
        value: 'display-value',
        exclude: false,
        filterCol: '`actual.column`',
        filterValue: 'actual-value',
        filterOp: 'LIKE',
      };
      assert.strictEqual(translateFilter(filter), "$d.actual.column.contains('actual-value')");
    });

    it('should translate complex multi-filter scenario', () => {
      const filters = [
        { col: '`request.host`', value: 'example.com', exclude: false },
        { col: '`response.status`', value: 404, exclude: true },
        { col: '`cdn.cache_status`', value: 'MISS', exclude: true },
        { col: '`request.method`', value: 'GET', exclude: false },
      ];

      assert.strictEqual(
        translateFacetFilters(filters),
        "($l.request.host == 'example.com') && "
          + '($l.response.status != 404) && '
          + "($l.cdn.cache_status != 'MISS') && "
          + "($l.request.method == 'GET')",
      );
    });

    it('should build complete query clause for complex filters', () => {
      const filters = [
        { col: '`request.host`', value: 'example.com', exclude: false },
        {
          col: '`request.url`', value: '%/api/%', exclude: false, filterOp: 'LIKE',
        },
      ];

      assert.strictEqual(
        buildFilterClause(filters),
        "| filter ($l.request.host == 'example.com') && ($l.request.url.contains('/api/'))",
      );
    });
  });
});
