// Shared UI and query constants

/**
 * Ordered time range definitions used across UI, caching, and query generation.
 *
 * @typedef {Object} TimeRangeDefinition
 * @property {string} label - Full UI label.
 * @property {string} shortLabel - Compact UI label.
 * @property {string} interval - ClickHouse interval literal.
 * @property {string} bucket - ClickHouse bucket expression.
 * @property {number} periodMs - Duration in milliseconds.
 * @property {number} cacheTtl - Query cache TTL in seconds.
 */

/** @type {string[]} */
export const TIME_RANGE_ORDER = ['15m', '1h', '12h', '24h', '7d'];

/** @type {Record<string, TimeRangeDefinition>} */
export const TIME_RANGES = {
  '15m': {
    label: 'Last 15 minutes',
    shortLabel: '15m',
    interval: 'INTERVAL 15 MINUTE',
    bucket: 'toStartOfInterval(timestamp, INTERVAL 5 SECOND)',
    periodMs: 15 * 60 * 1000,
    cacheTtl: 60
  },
  '1h': {
    label: 'Last hour',
    shortLabel: '1h',
    interval: 'INTERVAL 1 HOUR',
    bucket: 'toStartOfInterval(timestamp, INTERVAL 10 SECOND)',
    periodMs: 60 * 60 * 1000,
    cacheTtl: 300
  },
  '12h': {
    label: 'Last 12 hours',
    shortLabel: '12h',
    interval: 'INTERVAL 12 HOUR',
    bucket: 'toStartOfMinute(timestamp)',
    periodMs: 12 * 60 * 60 * 1000,
    cacheTtl: 600
  },
  '24h': {
    label: 'Last 24 hours',
    shortLabel: '24h',
    interval: 'INTERVAL 24 HOUR',
    bucket: 'toStartOfFiveMinutes(timestamp)',
    periodMs: 24 * 60 * 60 * 1000,
    cacheTtl: 900
  },
  '7d': {
    label: 'Last 7 days',
    shortLabel: '7d',
    interval: 'INTERVAL 7 DAY',
    bucket: 'toStartOfTenMinutes(timestamp)',
    periodMs: 7 * 24 * 60 * 60 * 1000,
    cacheTtl: 1800
  }
};

/** @type {string} */
export const DEFAULT_TIME_RANGE = '1h';

/** @type {number[]} */
export const TOP_N_OPTIONS = [5, 10, 20, 50, 100];

/** @type {number} */
export const DEFAULT_TOP_N = 5;

