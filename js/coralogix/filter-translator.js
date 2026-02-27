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

/**
 * Filter Translation Layer - Klickhaus to Data Prime
 *
 * Converts Klickhaus filter format to Coralogix Data Prime query syntax.
 *
 * Klickhaus filter format:
 * {
 *   col: '`request.host`',
 *   value: 'example.com',
 *   exclude: false,
 *   filterCol: '`request.host`',  // optional override
 *   filterValue: 'example.com',   // optional override
 *   filterOp: '='                  // optional: '=' or 'LIKE'
 * }
 *
 * Data Prime filter format:
 * $d.request.host == 'example.com'
 * $d.request.host != 'example.com'  // if exclude=true
 */

/**
 * Column to Data Prime namespace mapping.
 * Maps ClickHouse column patterns to Data Prime prefixes ($d, $l, $m).
 */
/** Columns that map to a namespace prefix (prefix + column name). */
const NAMESPACE_MAP = {
  // Metadata namespace ($m) - system fields only
  timestamp: '$m',

  // Data namespace ($d) - ALL CDN log fields go to $d by default
  // request.*, response.*, cdn.*, client.*, helix.*
  // Everything falls through to $d prefix
};

/** Columns whose Data Prime path differs entirely from the ClickHouse name. */
const FULL_PATH_MAP = {
  source: '$l.subsystemname',
  'client.asn': '$d.cdn.originating_ip_geoip.asn.number',
};

/**
 * Get the Data Prime namespace prefix for a ClickHouse column.
 * @param {string} clickhouseColumn - Column name with backticks (e.g., `request.host`)
 * @returns {string} Data Prime prefix ($d, $l, or $m)
 */
function getNamespacePrefix(clickhouseColumn) {
  // Remove backticks
  const cleanCol = clickhouseColumn.replace(/`/g, '');

  // Check explicit mappings
  if (NAMESPACE_MAP[cleanCol]) {
    return NAMESPACE_MAP[cleanCol];
  }

  // Default to $d (data namespace) for everything else
  return '$d';
}

/**
 * Try to extract the column from a toString() wrapper.
 * toString(`response.status`) -> response.status
 * @param {string} expr - Cleaned expression (no backticks)
 * @returns {string|null} Extracted column or null if not a toString() call
 */
function extractFromToString(expr) {
  if (!expr.match(/^toString\(/)) {
    return null;
  }
  const match = expr.match(/toString\(([^)]+)\)/);
  return match ? match[1].replace(/`/g, '') : null;
}

/**
 * Try to extract the column from an upper() wrapper.
 * upper(`cdn.cache_status`) -> cdn.cache_status
 * @param {string} expr - Cleaned expression (no backticks)
 * @returns {string|null} Extracted column or null if not an upper() call
 */
function extractFromUpper(expr) {
  if (!expr.match(/^upper\(/)) {
    return null;
  }
  const match = expr.match(/upper\(([^)]+)\)/);
  return match ? match[1].replace(/`/g, '') : null;
}

/**
 * Try to extract the column from a REGEXP_REPLACE() call.
 * REGEXP_REPLACE(`response.headers.x_error`, ...) -> response.headers.x_error
 * @param {string} expr - Cleaned expression (no backticks)
 * @returns {string|null} Extracted column or null
 */
function extractFromRegexpReplace(expr) {
  if (!expr.match(/^REGEXP_REPLACE\(/i)) {
    return null;
  }
  const match = expr.match(/REGEXP_REPLACE\(([^,]+),/i);
  return match ? match[1].replace(/`/g, '').trim() : null;
}

/**
 * Try to extract the column from an if() conditional.
 * Extracts the second argument (the column when condition is true).
 * @param {string} expr - Cleaned expression (no backticks)
 * @returns {string|null} Extracted column or null
 */
function extractFromIfConditional(expr) {
  if (!expr.match(/^if\(/i)) {
    return null;
  }
  const match = expr.match(/if\([^,]+,\s*([^,]+),/i);
  return match ? match[1].replace(/`/g, '').trim() : null;
}

/**
 * Try to extract a column reference from a concat() call.
 * concat(toString(intDiv(`response.status`, 100)), 'xx') -> response.status
 * @param {string} expr - Cleaned expression (no backticks)
 * @returns {string|null} Extracted column or null
 */
function extractFromConcat(expr) {
  if (!expr.match(/^concat\(/i)) {
    return null;
  }
  const colMatch = expr.match(/([a-z._]+\.[a-z._]+)/i);
  return colMatch ? colMatch[1] : null;
}

/**
 * Extract the base column from a ClickHouse expression.
 * Handles functions like toString(), upper(), REGEXP_REPLACE(), etc.
 * @param {string} expression - ClickHouse expression
 * @returns {string} Base column name
 */
function extractBaseColumn(expression) {
  // Remove backticks first
  const cleaned = expression.replace(/`/g, '');

  // Try each extraction pattern in order
  return extractFromToString(cleaned)
    || extractFromUpper(cleaned)
    || extractFromRegexpReplace(cleaned)
    || extractFromIfConditional(cleaned)
    || extractFromConcat(cleaned)
    || cleaned;
}

/**
 * Convert a ClickHouse column reference to a Data Prime field path.
 * @param {string} clickhouseColumn - Column name with backticks (e.g., `request.host`)
 * @returns {string} Data Prime field path (e.g., $d.request.host)
 */
export function getFieldPath(clickhouseColumn) {
  // Extract base column from any ClickHouse expression
  const baseCol = extractBaseColumn(clickhouseColumn);

  // Check full-path mappings first (column name differs entirely in Data Prime)
  if (FULL_PATH_MAP[baseCol]) {
    return FULL_PATH_MAP[baseCol];
  }

  // Get the appropriate namespace prefix
  const prefix = getNamespacePrefix(`\`${baseCol}\``);

  // Simple dot-separated path
  return `${prefix}.${baseCol}`;
}

/**
 * Escape and quote a filter value for Data Prime syntax.
 * @param {string|number} value - The value to escape
 * @returns {string} Properly escaped and quoted value
 */
export function escapeValue(value) {
  // Numeric values don't need quotes
  if (typeof value === 'number') {
    return String(value);
  }

  // Null/undefined
  if (value === null || value === undefined) {
    return 'null';
  }

  // String values - escape single quotes and wrap in single quotes
  const stringValue = String(value);
  const escaped = stringValue.replace(/'/g, "\\'");
  return `'${escaped}'`;
}

/**
 * Translate a single Klickhaus filter to Data Prime syntax.
 * @param {Object} filter - Klickhaus filter object
 * @param {string} filter.col - Facet column expression (e.g., `request.host`)
 * @param {string|number} filter.value - Filter value
 * @param {boolean} filter.exclude - Whether this is an exclusion filter
 * @param {string} [filter.filterCol] - Optional override column for filtering
 * @param {string|number} [filter.filterValue] - Optional override value for filtering
 * @param {string} [filter.filterOp] - Optional operator ('=' or 'LIKE')
 * @returns {string} Data Prime filter expression
 */
export function translateFilter(filter) {
  // Use filterCol/filterValue if provided, otherwise use col/value
  const column = filter.filterCol || filter.col;
  const value = filter.filterValue ?? filter.value;
  const operator = filter.filterOp || '=';

  // Use the full expression translator so filter expressions always match the
  // groupby expression produced by translateColExpression (e.g. intDiv → floor).
  // eslint-disable-next-line no-use-before-define
  const fieldPath = translateColExpression(column);
  // Empty string means "no value" — compare against null in Data Prime rather
  // than '' so it works correctly for any expression, including complex ones.
  const escapedValue = value === '' ? 'null' : escapeValue(value);

  // Handle different operators
  if (operator === 'LIKE') {
    // LIKE operator becomes 'contains' in Data Prime
    // Extract the pattern (remove % wildcards for contains)
    const pattern = String(value).replace(/%/g, '');
    const escapedPattern = escapeValue(pattern);

    // NOTE: Data Prime may not support ! operator in all contexts
    // If this causes errors, we'll need to find an alternative for NOT LIKE
    if (filter.exclude) {
      return `!${fieldPath}.contains(${escapedPattern})`;
    }
    return `${fieldPath}.contains(${escapedPattern})`;
  }

  // Standard equality/comparison operators
  if (filter.exclude) {
    return `${fieldPath} != ${escapedValue}`;
  }

  return `${fieldPath} == ${escapedValue}`;
}

/**
 * Translate a host filter to Data Prime syntax.
 * Convenience method for filtering by request.host.
 * @param {string} host - Host value to filter
 * @param {boolean} [exclude=false] - Whether to exclude this host
 * @returns {string} Data Prime filter expression
 */
export function translateHostFilter(host, exclude = false) {
  return translateFilter({
    col: '`request.host`',
    value: host,
    exclude,
  });
}

/**
 * Combine multiple filters with AND logic.
 * @param {string[]} filterExpressions - Array of Data Prime filter expressions
 * @returns {string} Combined filter expression
 */
function combineFilters(filterExpressions) {
  if (filterExpressions.length === 0) {
    return '';
  }

  if (filterExpressions.length === 1) {
    return filterExpressions[0];
  }

  // Wrap each expression in parentheses and join with &&
  return filterExpressions.map((expr) => `(${expr})`).join(' && ');
}

/**
 * Translate an array of Klickhaus filters to a combined Data Prime filter expression.
 * @param {Array<Object>} filters - Array of Klickhaus filter objects
 * @returns {string} Combined Data Prime filter expression (empty string if no filters)
 */
export function translateFacetFilters(filters) {
  if (!filters || filters.length === 0) {
    return '';
  }

  const expressions = filters.map((filter) => translateFilter(filter));
  return combineFilters(expressions);
}

/**
 * Build a Data Prime filter clause from Klickhaus filters.
 * Returns a complete "| filter ..." clause ready to append to a query.
 * @param {Array<Object>} filters - Array of Klickhaus filter objects
 * @returns {string} Data Prime filter clause (e.g., "| filter $d.request.host == 'example.com'")
 */
export function buildFilterClause(filters) {
  const filterExpression = translateFacetFilters(filters);

  if (!filterExpression) {
    return '';
  }

  return `| filter ${filterExpression}`;
}

/**
 * Map of comparison operators to their Data Prime equivalents.
 * Used by translateOperator to avoid a large switch statement.
 */
const COMPARISON_OPERATORS = {
  '=': '==',
  '==': '==',
  '!=': '!=',
  '>': '>',
  '<': '<',
  '>=': '>=',
  '<=': '<=',
};

/**
 * Translate a method-style operator (contains, startsWith)
 * to Data Prime syntax.
 * @param {string} operator - 'contains', 'startsWith', or 'LIKE'
 * @param {string} fieldPath - Data Prime field path
 * @param {string|number} value - Filter value
 * @returns {string|null} Data Prime expression or null if not a method operator
 */
function translateMethodOperator(operator, fieldPath, value) {
  if (operator === 'contains') {
    return `${fieldPath}.contains(${escapeValue(value)})`;
  }
  if (operator === 'startsWith') {
    return `${fieldPath}.startsWith(${escapeValue(value)})`;
  }
  if (operator === 'LIKE') {
    // LIKE with % wildcards -> contains
    const pattern = String(value).replace(/%/g, '');
    return `${fieldPath}.contains(${escapeValue(pattern)})`;
  }
  return null;
}

/**
 * Translate operator shortcuts to Data Prime syntax.
 * @param {string} operator - Operator string
 *   ('=', '!=', '>', '<', '>=', '<=', 'LIKE', 'contains', 'startsWith')
 * @param {string} fieldPath - Data Prime field path
 * @param {string|number} value - Filter value
 * @returns {string} Data Prime expression
 */
export function translateOperator(operator, fieldPath, value) {
  // Check method-style operators first (contains, startsWith, LIKE)
  const methodResult = translateMethodOperator(operator, fieldPath, value);
  if (methodResult) {
    return methodResult;
  }

  // Look up comparison operator, defaulting to equality
  const dpOperator = COMPARISON_OPERATORS[operator] || '==';
  return `${fieldPath} ${dpOperator} ${escapeValue(value)}`;
}

/**
 * Translate a filter with explicit operator support.
 * @param {string} column - ClickHouse column name (e.g., `request.host`)
 * @param {string} operator - Operator ('=', '!=', '>', '<', 'contains', etc.)
 * @param {string|number} value - Filter value
 * @param {boolean} [exclude=false] - Whether to negate the expression
 * @returns {string} Data Prime filter expression
 */
export function translateFilterWithOperator(column, operator, value, exclude = false) {
  const fieldPath = getFieldPath(column);
  const expression = translateOperator(operator, fieldPath, value);

  if (exclude) {
    // NOTE: Data Prime may not support ! operator in all contexts
    // If this causes errors, we need to negate the operator instead
    return `!(${expression})`;
  }

  return expression;
}

/**
 * Translate an "IN" list filter to Data Prime syntax.
 * @param {string} column - ClickHouse column name
 * @param {Array<string|number>} values - Array of values
 * @param {boolean} [exclude=false] - Whether to use NOT IN
 * @returns {string} Data Prime filter expression
 */
export function translateInFilter(column, values, exclude = false) {
  if (!values || values.length === 0) {
    return '';
  }

  const fieldPath = getFieldPath(column);

  if (values.length === 1) {
    // Single value - use equality
    const escapedValue = escapeValue(values[0]);
    return exclude ? `${fieldPath} != ${escapedValue}` : `${fieldPath} == ${escapedValue}`;
  }

  if (exclude) {
    // NOT IN: expand to multiple != conditions joined with &&
    // Data Prime doesn't support ! operator, so we can't use !field.in([...])
    const conditions = values.map((v) => `${fieldPath} != ${escapeValue(v)}`);
    return conditions.join(' && ');
  }

  // Multiple values - use .in() method
  const escapedValues = values.map((v) => escapeValue(v)).join(', ');
  return `${fieldPath}.in([${escapedValues}])`;
}

// ---------------------------------------------------------------------------
// Full ClickHouse expression → Data Prime expression translation
// ---------------------------------------------------------------------------

/** Split a string by commas, respecting quoted substrings. */
function splitRespectingQuotes(str) {
  const parts = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if ((ch === "'" || ch === '"') && (i === 0 || str[i - 1] !== '\\')) {
      if (!inQuote) {
        inQuote = true;
        quoteChar = ch;
      } else if (ch === quoteChar) {
        inQuote = false;
      }
    }
    if (ch === ',' && !inQuote) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current.trim());
  return parts;
}

/** Parse condition/label pairs from the parts of a multiIf expression. */
function parseMultiIfConditions(parts) {
  const conditions = [];
  let i = 0;
  while (i < parts.length - 1) {
    const condition = parts[i];
    const label = parts[i + 1].replace(/^['"]|['"]$/g, '');
    const ltMatch = condition.match(/`[^`]+`\s*<\s*(\d+)/);
    const eqMatch = condition.match(/`[^`]+`\s*=\s*(\d+)/);
    if (ltMatch) {
      conditions.push({ op: '<', threshold: ltMatch[1], label });
      i += 2;
    } else if (eqMatch) {
      conditions.push({ op: '==', threshold: eqMatch[1], label });
      i += 2;
    } else { break; }
  }
  return conditions;
}

/** Convert ClickHouse multiIf() to Data Prime case_lessthan or case. */
function convertMultiIfToCaseLessThan(multiIfExpr) {
  const fieldMatch = multiIfExpr.match(/multiIf\s*\(\s*`([^`]+)`/i);
  if (!fieldMatch) {
    throw new Error(`Cannot extract field from multiIf: ${multiIfExpr}`);
  }
  const dpField = getFieldPath(`\`${fieldMatch[1]}\``);
  const inner = multiIfExpr.replace(/^multiIf\s*\(/i, '').replace(/\)$/, '');
  const parts = splitRespectingQuotes(inner);
  const conditions = parseMultiIfConditions(parts);
  const fallback = parts[parts.length - 1].replace(/^['"]|['"]$/g, '');

  if (conditions.some((c) => c.op === '==')) {
    const cases = conditions.map((c) => (c.op === '=='
      ? `${dpField}:num == ${c.threshold} -> '${c.label}'`
      : `${dpField}:num < ${c.threshold} -> '${c.label}'`));
    return `case { ${cases.join(', ')}, _ -> '${fallback}' }`;
  }
  const list = conditions.map((c) => `${c.threshold} -> '${c.label}'`);
  return `case_lessthan { ${dpField}:num, ${list.join(', ')}, _ -> '${fallback}' }`;
}

/**
 * Translate a full ClickHouse column/expression to its Data Prime equivalent.
 * This is the single source of truth used by both the groupby (top) clause and
 * filter expressions, guaranteeing they always produce the same string so that
 * filter comparisons are valid.
 *
 * @param {string} col - ClickHouse expression (e.g. col from breakdown definition)
 * @returns {string} Data Prime expression
 */
export function translateColExpression(col) {
  const cleanExpr = col.replace(/`/g, '');

  if (cleanExpr === 'client.asn') {
    return "concat($d.cdn.originating_ip_geoip.asn.number, ' - ',"
      + ' $d.cdn.originating_ip_geoip.asn.organization)';
  }
  if (cleanExpr.includes('intDiv') && cleanExpr.includes('response.status')) {
    return 'if($d.response.status != null, `{floor($d.response.status:num/100)}xx`, null)';
  }
  if (cleanExpr.match(/^toString\(/)) {
    return `${getFieldPath(col)}:string`;
  }
  if (cleanExpr.match(/^upper\(/)) return getFieldPath(col);
  if (cleanExpr.match(/^REGEXP_REPLACE\(/i)) return getFieldPath(col);
  if (cleanExpr.match(/^if\(/i)) {
    if (cleanExpr.includes('x_forwarded_for')) {
      return '$d.request.headers.x_forwarded_for';
    }
    const m = cleanExpr.match(/if\([^,]+,\s*([^,]+),/i);
    if (m) return getFieldPath(`\`${m[1].replace(/`/g, '').trim()}\``);
  }
  if (cleanExpr.match(/^multiIf\(/i)) {
    return convertMultiIfToCaseLessThan(col);
  }
  return getFieldPath(col);
}
