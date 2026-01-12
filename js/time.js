// Time range helpers
import { state } from './state.js';
import { DATABASE } from './config.js';

// Query timestamp for deterministic/cacheable queries
export let queryTimestamp = null;

export function setQueryTimestamp(ts) {
  queryTimestamp = ts;
}

export function getTable() {
  return 'cdn_requests_v2';
}

export function getInterval() {
  const intervals = {
    '15m': 'INTERVAL 15 MINUTE',
    '1h': 'INTERVAL 1 HOUR',
    '12h': 'INTERVAL 12 HOUR',
    '24h': 'INTERVAL 24 HOUR',
    '7d': 'INTERVAL 7 DAY'
  };
  return intervals[state.timeRange];
}

export function getTimeBucket() {
  const buckets = {
    '15m': 'toStartOfInterval(timestamp, INTERVAL 30 SECOND)',
    '1h': 'toStartOfMinute(timestamp)',
    '12h': 'toStartOfTenMinutes(timestamp)',
    '24h': 'toStartOfFifteenMinutes(timestamp)',
    '7d': 'toStartOfHour(timestamp)'
  };
  return buckets[state.timeRange];
}

export function getTimeFilter() {
  // Use fixed timestamp instead of now() for deterministic/cacheable queries
  const ts = queryTimestamp || new Date();
  // Format as 'YYYY-MM-DD HH:MM:SS' (no milliseconds)
  const isoTimestamp = ts.toISOString().replace('T', ' ').slice(0, 19);
  // Use minute-aligned filtering to enable projection usage
  // This gives up to 1 minute of imprecision but enables 10-100x faster queries
  return `toStartOfMinute(timestamp) BETWEEN toStartOfMinute(toDateTime('${isoTimestamp}') - ${getInterval()}) AND toStartOfMinute(toDateTime('${isoTimestamp}'))`;
}

export function getHostFilter() {
  if (!state.hostFilter) return '';
  const escaped = state.hostFilter.replace(/'/g, "\\'");
  return `AND (\`request.host\` LIKE '%${escaped}%' OR \`request.headers.x_forwarded_host\` LIKE '%${escaped}%')`;
}

// Get period duration in milliseconds
export function getPeriodMs() {
  const periods = {
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '12h': 12 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000
  };
  return periods[state.timeRange];
}
