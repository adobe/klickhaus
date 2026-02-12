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
 * Ordered time range definitions used across UI, caching, and query generation.
 *
 * @typedef {Object} TimeRangeDefinition
 * @property {string} label - Full UI label.
 * @property {string} shortLabel - Compact UI label.
 * @property {string} interval - ClickHouse interval literal.
 * @property {string} bucket - ClickHouse bucket expression.
 * @property {number} periodMs - Duration in milliseconds.
 * @property {string} step - ClickHouse interval for WITH FILL STEP.
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
    step: 'INTERVAL 5 SECOND',
    periodMs: 15 * 60 * 1000,
    cacheTtl: 60,
  },
  '1h': {
    label: 'Last hour',
    shortLabel: '1h',
    interval: 'INTERVAL 1 HOUR',
    bucket: 'toStartOfInterval(timestamp, INTERVAL 10 SECOND)',
    step: 'INTERVAL 10 SECOND',
    periodMs: 60 * 60 * 1000,
    cacheTtl: 300,
  },
  '12h': {
    label: 'Last 12 hours',
    shortLabel: '12h',
    interval: 'INTERVAL 12 HOUR',
    bucket: 'toStartOfMinute(timestamp)',
    step: 'INTERVAL 1 MINUTE',
    periodMs: 12 * 60 * 60 * 1000,
    cacheTtl: 600,
  },
  '24h': {
    label: 'Last 24 hours',
    shortLabel: '24h',
    interval: 'INTERVAL 24 HOUR',
    bucket: 'toStartOfFiveMinutes(timestamp)',
    step: 'INTERVAL 5 MINUTE',
    periodMs: 24 * 60 * 60 * 1000,
    cacheTtl: 900,
  },
  '7d': {
    label: 'Last 7 days',
    shortLabel: '7d',
    interval: 'INTERVAL 7 DAY',
    bucket: 'toStartOfTenMinutes(timestamp)',
    step: 'INTERVAL 10 MINUTE',
    periodMs: 7 * 24 * 60 * 60 * 1000,
    cacheTtl: 1800,
  },
};

/** @type {string} */
export const DEFAULT_TIME_RANGE = '7d';

/** @type {number[]} */
export const TOP_N_OPTIONS = [5, 10, 20, 50, 100];

/** @type {number} */
export const DEFAULT_TOP_N = 5;
