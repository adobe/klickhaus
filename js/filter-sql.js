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
import { state } from './state.js';
import { allBreakdowns } from './breakdowns/definitions.js';
import { COLUMN_DEFS } from './columns.js';

/**
 * @typedef {Object} Filter
 * @property {string} col - Facet column expression.
 * @property {string} value - Filter value.
 * @property {boolean} exclude - Whether filter is exclusion.
 * @property {string} [filterCol] - Optional override column for SQL filtering.
 * @property {string|number} [filterValue] - Optional override value for SQL filtering.
 * @property {'=' | 'LIKE'} [filterOp] - Comparison operator (default: '=').
 */

/** @type {Set<string>|null} */
let allowedColumnsCache = null;

/**
 * Build the set of valid SQL column expressions from breakdowns and column definitions.
 * Lazy-initialized and cached.
 * @returns {Set<string>}
 */
export function getAllowedColumns() {
  if (allowedColumnsCache) return allowedColumnsCache;
  const cols = new Set();
  const breakdowns = state.breakdowns?.length ? state.breakdowns : allBreakdowns;
  for (const b of breakdowns) {
    if (typeof b.col === 'string') cols.add(b.col);
    if (b.filterCol) cols.add(b.filterCol);
  }
  for (const def of Object.values(COLUMN_DEFS)) {
    if (def.facetCol) cols.add(def.facetCol);
  }
  allowedColumnsCache = cols;
  return cols;
}

const ALLOWED_OPS = new Set(['=', 'LIKE']);

/**
 * Check if a column expression is in the allowlist.
 * @param {string} col
 * @returns {boolean}
 */
export function isValidFilterColumn(col) {
  return getAllowedColumns().has(col);
}

/**
 * Check if a filter operator is valid.
 * @param {string} op
 * @returns {boolean}
 */
export function isValidFilterOp(op) {
  return ALLOWED_OPS.has(op);
}

/**
 * @typedef {Object} FilterEntry
 * @property {string|number} value
 * @property {'=' | 'LIKE'} op
 */

/**
 * @typedef {Object} FilterGroup
 * @property {string} sqlCol
 * @property {FilterEntry[]} includes
 * @property {FilterEntry[]} excludes
 */

/**
 * Normalize filters into a SQL-ready group map keyed by SQL column.
 * @param {Filter[]} filters
 * @returns {Record<string, FilterGroup>}
 */
export function buildFilterMap(filters) {
  /** @type {Record<string, FilterGroup>} */
  const byColumn = {};
  for (const filter of filters) {
    const sqlCol = filter.filterCol || filter.col;
    const sqlValue = filter.filterValue ?? filter.value;
    const sqlOp = filter.filterOp || '=';
    if (!byColumn[sqlCol]) {
      byColumn[sqlCol] = { sqlCol, includes: [], excludes: [] };
    }
    const entry = { value: sqlValue, op: sqlOp };
    if (filter.exclude) {
      byColumn[sqlCol].excludes.push(entry);
    } else {
      byColumn[sqlCol].includes.push(entry);
    }
  }
  return byColumn;
}

/**
 * Compile filters into SQL and a structured filter map.
 * @param {Filter[]} filters
 * @returns {{ sql: string, map: Record<string, FilterGroup> }}
 */
export function compileFilters(filters) {
  if (!filters || filters.length === 0) {
    return { sql: '', map: {} };
  }

  const safeFilters = filters.filter((f) => {
    const sqlCol = f.filterCol || f.col;
    const sqlOp = f.filterOp || '=';
    if (!isValidFilterColumn(sqlCol)) {
      // eslint-disable-next-line no-console
      console.warn(`Filter rejected: invalid column "${sqlCol}"`);
      return false;
    }
    if (!isValidFilterOp(sqlOp)) {
      // eslint-disable-next-line no-console
      console.warn(`Filter rejected: invalid operator "${sqlOp}"`);
      return false;
    }
    return true;
  });

  if (safeFilters.length === 0) {
    return { sql: '', map: {} };
  }

  const map = buildFilterMap(safeFilters);
  const columnClauses = [];

  for (const group of Object.values(map)) {
    const parts = [];
    const { sqlCol, includes, excludes } = group;

    if (includes.length > 0) {
      const includeParts = includes.map((entry) => {
        const { value, op } = entry;
        const isNumeric = typeof value === 'number';
        const escaped = isNumeric ? value : String(value).replace(/'/g, "\\'");
        const comparison = isNumeric ? escaped : `'${escaped}'`;
        return `${sqlCol} ${op} ${comparison}`;
      });
      parts.push(includeParts.length === 1 ? includeParts[0] : `(${includeParts.join(' OR ')})`);
    }

    if (excludes.length > 0) {
      const excludeParts = excludes.map((entry) => {
        const { value, op } = entry;
        const isNumeric = typeof value === 'number';
        const escaped = isNumeric ? value : String(value).replace(/'/g, "\\'");
        const comparison = isNumeric ? escaped : `'${escaped}'`;
        const notOp = op === 'LIKE' ? 'NOT LIKE' : '!=';
        return `${sqlCol} ${notOp} ${comparison}`;
      });
      parts.push(excludeParts.join(' AND '));
    }

    if (parts.length === 1) {
      columnClauses.push(parts[0]);
    } else if (parts.length > 1) {
      columnClauses.push(`(${parts.join(' AND ')})`);
    }
  }

  const sql = columnClauses.map((clause) => `AND ${clause}`).join(' ');
  return { sql, map };
}

/**
 * Check if current filter map is a superset of cached filters.
 * @param {Record<string, FilterGroup>} current
 * @param {Record<string, FilterGroup>} cached
 * @returns {boolean}
 */
export function isFilterSuperset(current, cached) {
  for (const [sqlCol, cachedGroup] of Object.entries(cached || {})) {
    const currentGroup = current[sqlCol];
    if (!currentGroup) return false;

    // Create string keys for comparison (value + op)
    const entryKey = (e) => `${e.value}|${e.op}`;
    const currentIncludes = new Set(currentGroup.includes.map(entryKey));
    const currentExcludes = new Set(currentGroup.excludes.map(entryKey));

    for (const entry of cachedGroup.includes || []) {
      if (!currentIncludes.has(entryKey(entry))) return false;
    }
    for (const entry of cachedGroup.excludes || []) {
      if (!currentExcludes.has(entryKey(entry))) return false;
    }
  }
  return true;
}
