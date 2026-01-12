// Unified color lookup system
import { colorRules } from './definitions.js';
import { isSyntheticBucket } from '../utils.js';

// Build lookup map: pattern -> rule
const patternToRule = new Map();
for (const [ruleName, rule] of Object.entries(colorRules)) {
  for (const pattern of rule.patterns) {
    patternToRule.set(pattern, { ...rule, name: ruleName });
  }
}

/**
 * Get color for a column value by matching column name against patterns
 * @param {string} col - Column name (e.g., '`response.status`', 'request.host')
 * @param {string} value - The dimension value
 * @returns {string} CSS color variable or empty string
 */
export function getColorForColumn(col, value) {
  if (!value) return '';

  // Synthetic buckets like (same), (empty), (other) don't get colors
  if (isSyntheticBucket(value)) return '';

  // Find matching rule by checking if col includes any pattern
  for (const [pattern, rule] of patternToRule.entries()) {
    if (col.includes(pattern)) {
      const transformedValue = rule.transform ? rule.transform(value) : value;
      return rule.getColor(transformedValue);
    }
  }
  return '';
}

/**
 * Generate HTML for color indicator span
 * @param {string} col - Column name
 * @param {string} value - The dimension value
 * @param {string} className - CSS class for the span (default: 'status-color')
 * @returns {string} HTML string or empty string
 */
export function getColorIndicatorHtml(col, value, className = 'status-color') {
  const color = getColorForColumn(col, value);
  if (!color) return '';
  return `<span class="${className}" style="background:${color}"></span>`;
}

// Export individual color functions for backward compatibility
// These can be removed once all code uses the unified system

export function getStatusColor(status) {
  return colorRules.status.getColor(status);
}

export function getHostColor(host) {
  return colorRules.host.getColor(host);
}

export function getContentTypeColor(contentType) {
  return colorRules.contentType.getColor(contentType);
}

export function getCacheStatusColor(status) {
  return colorRules.cacheStatus.getColor(status);
}

export function getRequestTypeColor(type) {
  return colorRules.requestType.getColor(type);
}

export function getBackendTypeColor(type) {
  return colorRules.backendType.getColor(type);
}

export function getMethodColor(method) {
  return colorRules.method.getColor(method);
}

export function getAsnColor(asn) {
  return colorRules.asn.getColor(asn);
}

export function getErrorColor(error) {
  return colorRules.error.getColor(error);
}

export function getIPColor(ip) {
  return colorRules.ip.getColor(ip);
}

export function getUserAgentColor(ua) {
  return colorRules.userAgent.getColor(ua);
}

export function getRefererColor(referer) {
  return colorRules.referer.getColor(referer);
}

export function getPathColor(path) {
  return colorRules.path.getColor(path);
}

export function getAcceptColor(accept) {
  return colorRules.accept.getColor(accept);
}

export function getAcceptEncodingColor(encoding) {
  return colorRules.acceptEncoding.getColor(encoding);
}

export function getCacheControlColor(cacheControl) {
  return colorRules.cacheControl.getColor(cacheControl);
}

export function getByoCdnColor(cdn) {
  return colorRules.byoCdn.getColor(cdn);
}

export function getLocationColor(location) {
  return colorRules.location.getColor(location);
}
