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
 * NDJSON parser for Coralogix Data Prime responses.
 * Parses newline-delimited JSON responses and transforms them to klickhaus format.
 *
 * Reference: /Users/yoni/trace-agg/src/app/services/data-explorer/ndjson-parser.ts
 *
 * Coralogix response format:
 * {"queryId": {"queryId": "abc123"}}
 * {"result": {"results": [{"metadata": [...], "labels": [...], "userData": "..."}]}}
 * {"result": {"results": [...]}}
 */

/**
 * Parse a single result object from a Coralogix result line.
 *
 * @param {Object} result - Single result object
 * @param {Array<{key: string, value: string}>} result.metadata - Metadata
 * @param {Array<{key: string, value: string}>} result.labels - Labels
 * @param {string} result.userData - JSON string containing the actual data
 * @returns {Object|null} - Parsed result object or null if invalid
 *
 * @example
 * const result = {
 *   metadata: [{ key: 'timestamp', value: '2024-01-15T10:00:00Z' }],
 *   labels: [{ key: 'serviceName', value: 'api' }],
 *   userData: '{"status": 200, "duration": 123}'
 * };
 *
 * const parsed = parseResultLine(result);
 * // { status: 200, duration: 123,
 * //   _metadata: { timestamp: '...' }, _labels: { serviceName: 'api' } }
 */
export function parseResultLine(result) {
  if (!result || !result.userData) {
    return null;
  }

  try {
    const userData = JSON.parse(result.userData);

    // Convert metadata array to object
    const metadataObj = {};
    if (result.metadata && Array.isArray(result.metadata)) {
      for (const kv of result.metadata) {
        metadataObj[kv.key] = kv.value;
      }
    }

    // Convert labels array to object
    const labelsObj = {};
    if (result.labels && Array.isArray(result.labels)) {
      for (const kv of result.labels) {
        labelsObj[kv.key] = kv.value;
      }
    }

    // Combine userData with metadata and labels
    // eslint-disable-next-line no-underscore-dangle
    return {
      ...userData,
      _metadata: metadataObj,
      _labels: labelsObj,
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Skipping malformed userData:', e.message);
    return null;
  }
}

/**
 * Process a single parsed NDJSON line, extracting queryId and results.
 *
 * @param {Object} parsed - Parsed JSON object from an NDJSON line
 * @param {Array<Object>} results - Array to push parsed results into
 * @returns {string|null} queryId if found in this line, null otherwise
 */
function processNDJSONLine(parsed, results, errors) {
  let foundQueryId = null;

  // Extract queryId if present
  if (parsed.queryId && parsed.queryId.queryId) {
    foundQueryId = parsed.queryId.queryId;
  }

  // Detect inline error responses
  if (parsed.error) {
    errors.push(parsed.error.message || JSON.stringify(parsed.error));
  }

  // Extract results if present
  if (parsed.result && parsed.result.results) {
    for (const queryResult of parsed.result.results) {
      const parsedResult = parseResultLine(queryResult);
      if (parsedResult) {
        results.push(parsedResult);
      }
    }
  }

  return foundQueryId;
}

/**
 * Parse a complete NDJSON response from Coralogix.
 *
 * @param {string} text - Raw NDJSON response string
 * @returns {{ queryId: string|null, results: Array<Object> }}
 *          Parsed response with queryId and results
 *
 * @example
 * const response = `{"queryId": {"queryId": "abc123"}}
 * {"result": {"results": [{"metadata": [], "labels": [],
 *                          "userData": "{\\"count\\": 42}"}]}}`;
 *
 * const { queryId, results } = parseNDJSON(response);
 * // queryId: "abc123"
 * // results: [{ count: 42, _metadata: {}, _labels: {} }]
 */
export function parseNDJSON(text) {
  if (!text || typeof text !== 'string') {
    return { queryId: null, results: [] };
  }

  const lines = text.trim().split('\n');
  let queryId = null;
  const results = [];
  const errors = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        const foundId = processNDJSONLine(parsed, results, errors);
        if (foundId) {
          queryId = foundId;
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('Skipping malformed NDJSON line:', e.message);
      }
    }
  }

  return { queryId, results, errors };
}

/**
 * Extract and parse userData from a result object.
 *
 * @param {Object} result - Single result object
 * @param {string} result.userData - JSON string containing the actual data
 * @returns {Object|null} - Parsed userData object or null if invalid
 *
 * @example
 * const result = { userData: '{"count": 42, "status": "ok"}' };
 * const data = extractUserData(result);
 * // { count: 42, status: "ok" }
 */
export function extractUserData(result) {
  if (!result || !result.userData) {
    return null;
  }

  try {
    return JSON.parse(result.userData);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Failed to parse userData:', e.message);
    return null;
  }
}

/**
 * Transform Coralogix results to klickhaus format.
 * Handles field prefix mapping and flattens nested structures.
 *
 * Field mapping:
 * - $m.<field> → _metadata.<field> (e.g., $m.severity → _metadata.severity)
 * - $l.<field> → _labels.<field>
 *   (e.g., $l.applicationname → _labels.applicationname)
 * - $d.<field> → root level field
 *   (e.g., $d.kubernetes.pod.name → kubernetes.pod.name)
 * - <field> (no prefix) → root level field
 *
 * @param {Array<Object>} coralogixResults - Array of parsed Coralogix results
 * @returns {Array<Object>} - Transformed results in klickhaus format
 *
 * @example
 * const coralogixResults = [
 *   {
 *     status: 200,
 *     duration: 123,
 *     _metadata: { timestamp: '2024-01-15T10:00:00Z', severity: 'INFO' },
 *     _labels: { serviceName: 'api', region: 'us-east-1' }
 *   }
 * ];
 *
 * const klickhausData = transformToKlickhausFormat(coralogixResults);
 * // Results are already in klickhaus format with _metadata and _labels
 */
export function transformToKlickhausFormat(coralogixResults) {
  if (!Array.isArray(coralogixResults)) {
    return [];
  }

  // The results from parseNDJSON are already in klickhaus format
  // with _metadata and _labels properly structured
  return coralogixResults.map((result) => ({
    ...result,
  }));
}

/**
 * Get nested value from an object using a dot-notation path.
 *
 * @param {Object} obj - Object to traverse
 * @param {string} path - Dot-notation path (e.g., 'kubernetes.pod.name')
 * @returns {*} - Value at the path or undefined
 *
 * @example
 * const obj = { kubernetes: { pod: { name: 'frontend-123' } } };
 * const name = getNestedValue(obj, 'kubernetes.pod.name');
 * // 'frontend-123'
 */
export function getNestedValue(obj, path) {
  if (!obj || !path) return undefined;

  const keys = path.split('.');
  let value = obj;

  for (const key of keys) {
    if (value === null || value === undefined) {
      return undefined;
    }
    value = value[key];
  }

  return value;
}

/**
 * Get a value from a klickhaus record using a DataPrime path.
 * Handles prefix mapping:
 * - $m.<field> → _metadata.<field>
 * - $l.<field> → _labels.<field>
 * - $d.<field> → root level field (userData)
 * - <field> (no prefix) → root level field (userData)
 *
 * @param {Object} record - Klickhaus record with _metadata and _labels
 * @param {string} dataprimePath - DataPrime path
 *        (e.g., '$m.severity', '$l.serviceName', '$d.duration')
 * @returns {*} - Value at the specified path
 *
 * @example
 * const record = {
 *   duration: 123,
 *   kubernetes: { pod: { name: 'frontend-123' } },
 *   _metadata: { severity: 'INFO', timestamp: '2024-01-15T10:00:00Z' },
 *   _labels: { serviceName: 'api', region: 'us-east-1' }
 * };
 *
 * getValueByDataprimePath(record, '$m.severity'); // 'INFO'
 * getValueByDataprimePath(record, '$l.serviceName'); // 'api'
 * getValueByDataprimePath(record, '$d.duration'); // 123
 * getValueByDataprimePath(record, '$d.kubernetes.pod.name'); // 'frontend-123'
 */
export function getValueByDataprimePath(record, dataprimePath) {
  if (!record || !dataprimePath) {
    return undefined;
  }

  if (dataprimePath.startsWith('$m.')) {
    // Metadata field - simple key lookup
    const key = dataprimePath.slice(3);
    // eslint-disable-next-line no-underscore-dangle
    return record._metadata?.[key];
  }
  if (dataprimePath.startsWith('$l.')) {
    // Labels field - simple key lookup
    const key = dataprimePath.slice(3);
    // eslint-disable-next-line no-underscore-dangle
    return record._labels?.[key];
  }
  if (dataprimePath.startsWith('$d.')) {
    // User data field - may have nested paths
    const path = dataprimePath.slice(3);
    return getNestedValue(record, path);
  }
  // No prefix - treat as root level field
  return getNestedValue(record, dataprimePath);
}
