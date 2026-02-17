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

/**
 * Data Prime Query Builder for Klickhaus
 *
 * Generates Coralogix Data Prime queries from parameters.
 * Maps ClickHouse fields to Data Prime field paths with appropriate prefixes.
 */

// Field path prefix mapping
const FIELD_PREFIX = {
  DATA: '$d', // Data fields (logs/spans/metrics)
  METADATA: '$m', // Metadata fields (timestamp, severity, etc.)
  LABELS: '$l', // Labels/dimensions
};

/**
 * Maps ClickHouse field names to Data Prime field paths.
 *
 * Field path format: prefix.path
 * - $d.* for data fields (request.host, response.status, etc.)
 * - $m.timestamp for timestamp metadata
 * - $l.subsystemname for source labels (cloudflare/fastly)
 */
const FIELD_MAPPING = {
  // Core fields
  timestamp: `${FIELD_PREFIX.METADATA}.timestamp`,
  source: `${FIELD_PREFIX.LABELS}.subsystemname`,

  // Request fields
  'request.host': `${FIELD_PREFIX.DATA}.request.host`,
  'request.url': `${FIELD_PREFIX.DATA}.request.url`,
  'request.method': `${FIELD_PREFIX.DATA}.request.method`,

  // Response fields
  'response.status': `${FIELD_PREFIX.DATA}.response.status`,
  'response.body_size': `${FIELD_PREFIX.DATA}.response.body_size`,

  // CDN fields
  'cdn.cache_status': `${FIELD_PREFIX.DATA}.cdn.cache_status`,
  'cdn.datacenter': `${FIELD_PREFIX.DATA}.cdn.datacenter`,
  'cdn.time_elapsed_msec': `${FIELD_PREFIX.DATA}.cdn.time_elapsed_msec`,

  // Client fields
  'client.ip': `${FIELD_PREFIX.DATA}.client.ip`,
  'client.country_name': `${FIELD_PREFIX.DATA}.client.country_name`,
  'client.asn': `${FIELD_PREFIX.DATA}.client.asn`,

  // Helix fields
  'helix.request_type': `${FIELD_PREFIX.DATA}.helix.request_type`,
  'helix.backend_type': `${FIELD_PREFIX.DATA}.helix.backend_type`,
};

/**
 * Maps a ClickHouse field name to its Data Prime field path.
 * If no mapping exists, assumes it's a data field and adds $d. prefix.
 *
 * @param {string} field - ClickHouse field name (e.g., 'response.status')
 * @returns {string} Data Prime field path (e.g., '$d.response.status')
 */
function mapFieldPath(field) {
  if (FIELD_MAPPING[field]) {
    return FIELD_MAPPING[field];
  }
  // Default to data field prefix for unmapped fields
  return `${FIELD_PREFIX.DATA}.${field}`;
}

/**
 * Escapes and formats a value for use in Data Prime queries.
 * Strings are quoted and escaped, numbers and booleans are not quoted.
 *
 * @param {string|number|boolean|Array} value - Value to format
 * @param {string} [fieldType] - Optional field type hint ('STRING', 'NUM', 'BOOL')
 * @returns {string} Formatted value
 */
function formatValue(value, fieldType) {
  if (Array.isArray(value)) {
    return `[${value.map((v) => formatValue(v, fieldType)).join(', ')}]`;
  }

  // Use fieldType hint if provided
  if (fieldType) {
    if (fieldType === 'STRING') {
      const strValue = String(value);
      return `'${strValue.replace(/'/g, "\\'")}'`;
    }
    if (fieldType === 'NUM' || fieldType === 'BOOL') {
      return String(value);
    }
  }

  // Fallback: infer from value type
  if (typeof value === 'string') {
    return `'${value.replace(/'/g, "\\'")}'`;
  }

  return String(value);
}

/**
 * Builds a single filter condition expression.
 *
 * Supported operators:
 * - Comparison: ==, !=, >, <, >=, <=
 * - String: contains, startsWith
 * - Set: in
 * - Null checks: isNull, isNotNull
 *
 * @param {Object} condition - Filter condition
 * @param {string} condition.field - ClickHouse field name
 * @param {string} condition.operator - Filter operator
 * @param {*} [condition.value] - Filter value
 * @param {string} [condition.fieldType] - Field type hint
 * @returns {string} Data Prime filter expression
 */
function buildFilterExpression(condition) {
  const {
    field, operator, value, fieldType,
  } = condition;
  const dpField = mapFieldPath(field);

  // Null checks
  if (operator === 'isNull') {
    return `${dpField} == null`;
  }
  if (operator === 'isNotNull') {
    return `${dpField} != null`;
  }

  // String functions
  if (operator === 'contains') {
    return `${dpField}.contains(${formatValue(value, fieldType)})`;
  }
  if (operator === 'startsWith') {
    return `${dpField}.startsWith(${formatValue(value, fieldType)})`;
  }

  // Set membership
  if (operator === 'in') {
    return `${dpField} in ${formatValue(value, fieldType)}`;
  }

  // Comparison operators
  return `${dpField} ${operator} ${formatValue(value, fieldType)}`;
}

/**
 * Builds the complete filter clause from multiple conditions.
 * Joins conditions with AND or OR based on logicalOperator.
 *
 * @param {Array<Object>} conditions - Array of filter conditions
 * @returns {string} Data Prime filter clause (without 'filter' keyword)
 */
function buildFilterClause(conditions) {
  if (conditions.length === 0) {
    return '';
  }

  if (conditions.length === 1) {
    return buildFilterExpression(conditions[0]);
  }

  // Use the logicalOperator from the first condition, default to AND
  const operator = conditions[0].logicalOperator || 'AND';
  const separator = operator === 'AND' ? ' && ' : ' || ';

  return conditions.map(buildFilterExpression).join(separator);
}

/**
 * Builds a time range expression for the source clause.
 *
 * Formats:
 * - Relative: between now(-10m) and now(-1m)
 * - Absolute: between @'2025-11-21T00:00:00' and @'2025-11-22T00:00:00'
 *
 * @param {Object} timeRange - Time range specification
 * @param {string} timeRange.type - 'relative' or 'absolute'
 * @param {string} timeRange.from - Start time
 * @param {string} timeRange.to - End time
 * @returns {string} Data Prime time range expression
 */
function buildTimeRangeExpression(timeRange) {
  if (timeRange.type === 'relative') {
    const fromExpr = timeRange.from === '0' || timeRange.from === '0m' || timeRange.from === ''
      ? 'now()'
      : `now(${timeRange.from})`;
    const toExpr = timeRange.to === '0' || timeRange.to === '0m' || timeRange.to === ''
      ? 'now()'
      : `now(${timeRange.to})`;
    return `between ${fromExpr} and ${toExpr}`;
  }

  // Absolute time with @'timestamp' syntax
  return `between @'${timeRange.from}' and @'${timeRange.to}'`;
}

/**
 * Builds a group by field expression with optional bucketing.
 *
 * Supports:
 * - bucket(interval) for time bucketing
 * - toLowerCase/toUpperCase for string transforms
 * - alias for renaming
 *
 * @param {Object} field - Group by field configuration
 * @param {string} field.field - ClickHouse field name
 * @param {string} [field.transform] - Transform function name
 * @param {Object} [field.transformParams] - Transform parameters
 * @param {string} [field.alias] - Field alias
 * @returns {string} Data Prime group by expression
 */
function buildGroupByExpression(field) {
  let expression = mapFieldPath(field.field);

  // Apply transform if present
  if (field.transform) {
    if (field.transform === 'bucket' && field.transformParams?.interval) {
      expression = `${expression}.bucket(${field.transformParams.interval})`;
    } else if (field.transform === 'toLowerCase') {
      expression = `${expression}.toLowerCase()`;
    } else if (field.transform === 'toUpperCase') {
      expression = `${expression}.toUpperCase()`;
    }
  }

  // Add alias if present
  if (field.alias) {
    expression = `${expression} as ${field.alias}`;
  }

  return expression;
}

/**
 * Builds the group by clause from multiple fields.
 *
 * @param {Array<Object>} fields - Array of group by fields
 * @returns {string} Data Prime groupby clause (without 'groupby' keyword)
 */
function buildGroupByClause(fields) {
  if (fields.length === 0) {
    return '';
  }

  const expressions = fields.map(buildGroupByExpression);
  return expressions.join(', ');
}

/**
 * Builds a percentile aggregation expression.
 *
 * @param {string} dpField - Mapped Data Prime field path
 * @param {Object} [params] - Percentile parameters
 * @param {number} [params.percentile=0.99] - Percentile value
 * @param {number} [params.precision] - Optional precision parameter
 * @returns {string} Data Prime percentile expression
 */
function buildPercentileExpression(dpField, params) {
  if (!dpField) {
    throw new Error('percentile requires a field');
  }
  const percentileValue = params?.percentile ?? 0.99;
  const precision = params?.precision;
  if (precision !== undefined) {
    return `percentile(${percentileValue}, ${dpField}, ${precision})`;
  }
  return `percentile(${percentileValue}, ${dpField})`;
}

/**
 * Builds an aggregation function expression.
 *
 * Supported aggregations:
 * - count() / count(field)
 * - distinct_count(field)
 * - avg(field), max(field), min(field), sum(field)
 * - percentile(value, field, precision)
 *
 * @param {Object} func - Aggregation function configuration
 * @param {string} func.type - Aggregation type
 * @param {string} [func.field] - Field to aggregate (optional for count)
 * @param {Object} [func.params] - Function parameters (e.g., percentile value)
 * @param {string} func.alias - Result alias
 * @returns {string} Data Prime aggregation expression
 */
function buildAggregationExpression(func) {
  let expression;
  const dpField = func.field ? mapFieldPath(func.field) : undefined;

  switch (func.type) {
    case 'count':
      expression = dpField ? `count(${dpField})` : 'count()';
      break;

    case 'distinct_count':
      if (!dpField) {
        throw new Error('distinct_count requires a field');
      }
      expression = `distinct_count(${dpField})`;
      break;

    case 'percentile':
      expression = buildPercentileExpression(dpField, func.params);
      break;

    case 'avg':
    case 'max':
    case 'min':
    case 'sum':
      if (!dpField) {
        throw new Error(`${func.type} requires a field`);
      }
      expression = `${func.type}(${dpField})`;
      break;

    default:
      throw new Error(`Unknown aggregation type: ${func.type}`);
  }

  return `${expression} as ${func.alias}`;
}

/**
 * Builds the aggregate clause from multiple aggregation functions.
 *
 * @param {Array<Object>} functions - Array of aggregation functions
 * @returns {string} Data Prime aggregate clause (without 'aggregate' keyword)
 */
function buildAggregateClause(functions) {
  if (functions.length === 0) {
    return '';
  }

  const expressions = functions.map(buildAggregationExpression);
  return expressions.join(', ');
}

/**
 * Builds a time series query with bucketing.
 *
 * Example output:
 * source logs between now(-10m) and now() |
 * filter $d.request.host == 'example.com' |
 * groupby $m.timestamp.bucket(1m) as bucket |
 * aggregate count() as requests
 *
 * @param {Object} params - Query parameters
 * @param {Object} params.timeRange - Time range specification
 * @param {string} params.interval - Bucket interval (e.g., '1m', '5m')
 * @param {Array<Object>} [params.filters] - Filter conditions
 * @param {string} [params.hostFilter] - Quick host filter
 * @returns {string} Complete Data Prime query
 */
function buildTimeSeriesQuery(params) {
  const {
    timeRange, interval, filters = [], hostFilter,
  } = params;
  const parts = [];

  // Source with time range
  const timeRangeExpr = buildTimeRangeExpression(timeRange);
  parts.push(`source logs ${timeRangeExpr}`);

  // Build filters
  const allFilters = [...filters];
  if (hostFilter) {
    allFilters.push({
      field: 'request.host',
      operator: '==',
      value: hostFilter,
      fieldType: 'STRING',
    });
  }

  if (allFilters.length > 0) {
    const filterExpr = buildFilterClause(allFilters);
    parts.push(`filter ${filterExpr}`);
  }

  // Group by time bucket
  const groupByExpr = buildGroupByExpression({
    field: 'timestamp',
    transform: 'bucket',
    transformParams: { interval },
    alias: 'bucket',
  });
  parts.push(`groupby ${groupByExpr}`);

  // Aggregate
  const aggregateExpr = buildAggregationExpression({
    type: 'count',
    alias: 'requests',
  });
  parts.push(`aggregate ${aggregateExpr}`);

  return parts.join(' | ');
}

/**
 * Builds a breakdown query with grouping and aggregations.
 *
 * Example output:
 * source logs between now(-1h) and now() |
 * filter $d.response.status >= 400 |
 * groupby $d.response.status as status |
 * aggregate count() as cnt, avg($d.cdn.time_elapsed_msec) as avg_time |
 * limit 10
 *
 * @param {Object} params - Query parameters
 * @param {string} params.dimension - Field to group by
 * @param {number} [params.topN=10] - Number of top results
 * @param {Array<Object>} [params.filters] - Filter conditions
 * @param {Array<Object>} [params.aggregations] - Custom aggregations
 * @param {Object} [params.timeRange] - Optional time range
 * @returns {string} Complete Data Prime query
 */
function buildBreakdownQuery(params) {
  const {
    dimension,
    topN = 10,
    filters = [],
    aggregations,
    timeRange,
  } = params;
  const parts = [];

  // Source with optional time range
  if (timeRange) {
    const timeRangeExpr = buildTimeRangeExpression(timeRange);
    parts.push(`source logs ${timeRangeExpr}`);
  } else {
    parts.push('source logs');
  }

  // Filters
  if (filters.length > 0) {
    const filterExpr = buildFilterClause(filters);
    parts.push(`filter ${filterExpr}`);
  }

  // Group by dimension
  const groupByExpr = buildGroupByExpression({
    field: dimension,
    alias: 'dim',
  });
  parts.push(`groupby ${groupByExpr}`);

  // Aggregations
  const defaultAggregations = [
    { type: 'count', alias: 'cnt' },
  ];
  const aggs = aggregations || defaultAggregations;
  const aggregateExpr = buildAggregateClause(aggs);
  parts.push(`aggregate ${aggregateExpr}`);

  // Limit
  if (topN > 0) {
    parts.push(`limit ${topN}`);
  }

  return parts.join(' | ');
}

/**
 * Builds a logs query with filtering, sorting, and limits.
 *
 * Example output:
 * source logs between now(-1h) and now() |
 * filter $d.response.status >= 500 |
 * limit 100
 *
 * @param {Object} params - Query parameters
 * @param {Array<Object>} [params.filters] - Filter conditions
 * @param {number} [params.limit=100] - Maximum results
 * @param {Object} [params.sort] - Sort configuration (not yet supported in Data Prime)
 * @param {Object} [params.timeRange] - Optional time range
 * @returns {string} Complete Data Prime query
 */
function buildLogsQuery(params) {
  const {
    filters = [],
    limit = 100,
    timeRange,
  } = params;
  const parts = [];

  // Source with optional time range
  if (timeRange) {
    const timeRangeExpr = buildTimeRangeExpression(timeRange);
    parts.push(`source logs ${timeRangeExpr}`);
  } else {
    parts.push('source logs');
  }

  // Filters
  if (filters.length > 0) {
    const filterExpr = buildFilterClause(filters);
    parts.push(`filter ${filterExpr}`);
  }

  // Limit
  if (limit > 0) {
    parts.push(`limit ${limit}`);
  }

  return parts.join(' | ');
}

// Export public API
export {
  buildTimeSeriesQuery,
  buildBreakdownQuery,
  buildLogsQuery,
  formatValue,
  buildFilterExpression,
  buildFilterClause,
  buildGroupByExpression,
  buildGroupByClause,
  buildAggregationExpression,
  buildAggregateClause,
  buildTimeRangeExpression,
  mapFieldPath,
  FIELD_MAPPING,
  FIELD_PREFIX,
};
