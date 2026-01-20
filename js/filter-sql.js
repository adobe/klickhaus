// Shared filter SQL compilation and analysis helpers

/**
 * @typedef {Object} Filter
 * @property {string} col - Facet column expression.
 * @property {string} value - Filter value.
 * @property {boolean} exclude - Whether filter is exclusion.
 * @property {string} [filterCol] - Optional override column for SQL filtering.
 * @property {string|number} [filterValue] - Optional override value for SQL filtering.
 */

/**
 * @typedef {Object} FilterGroup
 * @property {string} sqlCol
 * @property {(string|number)[]} includes
 * @property {(string|number)[]} excludes
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
    if (!byColumn[sqlCol]) {
      byColumn[sqlCol] = { sqlCol, includes: [], excludes: [] };
    }
    if (filter.exclude) {
      byColumn[sqlCol].excludes.push(sqlValue);
    } else {
      byColumn[sqlCol].includes.push(sqlValue);
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

  const map = buildFilterMap(filters);
  const columnClauses = [];

  for (const group of Object.values(map)) {
    const parts = [];
    const { sqlCol, includes, excludes } = group;

    if (includes.length > 0) {
      const includeParts = includes.map((value) => {
        const isNumeric = typeof value === 'number';
        const escaped = isNumeric ? value : String(value).replace(/'/g, "\\'");
        const comparison = isNumeric ? escaped : `'${escaped}'`;
        return `${sqlCol} = ${comparison}`;
      });
      parts.push(includeParts.length === 1 ? includeParts[0] : `(${includeParts.join(' OR ')})`);
    }

    if (excludes.length > 0) {
      const excludeParts = excludes.map((value) => {
        const isNumeric = typeof value === 'number';
        const escaped = isNumeric ? value : String(value).replace(/'/g, "\\'");
        const comparison = isNumeric ? escaped : `'${escaped}'`;
        return `${sqlCol} != ${comparison}`;
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

    const currentIncludes = new Set(currentGroup.includes.map(String));
    const currentExcludes = new Set(currentGroup.excludes.map(String));

    for (const value of cachedGroup.includes || []) {
      if (!currentIncludes.has(String(value))) return false;
    }
    for (const value of cachedGroup.excludes || []) {
      if (!currentExcludes.has(String(value))) return false;
    }
  }
  return true;
}
