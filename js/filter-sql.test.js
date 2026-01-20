import { describe, it } from 'node:test';
import assert from 'node:assert';
import { compileFilters, isFilterSuperset } from './filter-sql.js';

describe('compileFilters', () => {
  it('builds SQL for simple include filters', () => {
    const filters = [{ col: '`request.host`', value: 'example.com', exclude: false }];
    const { sql } = compileFilters(filters);
    assert.ok(sql.includes("`request.host` = 'example.com'"));
  });

  it('builds SQL with include + exclude for same column', () => {
    const filters = [
      { col: '`request.method`', value: 'GET', exclude: false },
      { col: '`request.method`', value: 'POST', exclude: true },
    ];
    const { sql } = compileFilters(filters);
    assert.ok(sql.includes("`request.method` = 'GET'"));
    assert.ok(sql.includes("`request.method` != 'POST'"));
  });

  it('uses numeric comparison when filterValue is a number', () => {
    const filters = [
      {
        col: "concat(toString(`client.asn`), ' ', dictGet('asn', 'name', `client.asn`))",
        value: '15169 Google',
        exclude: false,
        filterCol: '`client.asn`',
        filterValue: 15169,
      },
    ];
    const { sql } = compileFilters(filters);
    assert.ok(sql.includes('`client.asn` = 15169'));
    assert.ok(!sql.includes("'15169'"));
  });
});

describe('isFilterSuperset', () => {
  it('treats identical filters as superset', () => {
    const filters = [
      { col: '`request.host`', value: 'example.com', exclude: false },
      { col: '`request.host`', value: 'bad.com', exclude: true },
    ];
    const { map } = compileFilters(filters);
    assert.ok(isFilterSuperset(map, map));
  });

  it('requires cached filters to be present in current', () => {
    const cached = compileFilters([{ col: '`request.host`', value: 'example.com', exclude: false }]).map;
    const current = compileFilters([
      { col: '`request.host`', value: 'example.com', exclude: false },
      { col: '`request.method`', value: 'GET', exclude: false },
    ]).map;
    assert.ok(isFilterSuperset(current, cached));
  });

  it('fails when cached exclude is missing', () => {
    const cached = compileFilters([{ col: '`request.host`', value: 'example.com', exclude: true }]).map;
    const current = compileFilters([{ col: '`request.host`', value: 'example.com', exclude: false }]).map;
    assert.strictEqual(isFilterSuperset(current, cached), false);
  });
});
