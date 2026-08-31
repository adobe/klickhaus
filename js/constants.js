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
export const TIME_RANGE_ORDER = ['15m', '1h', '12h', '24h', '3d', '7d', '14d'];

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
  '3d': {
    label: 'Last 3 days',
    shortLabel: '3d',
    interval: 'INTERVAL 3 DAY',
    bucket: 'toStartOfInterval(timestamp, INTERVAL 30 MINUTE)',
    step: 'INTERVAL 30 MINUTE',
    periodMs: 3 * 24 * 60 * 60 * 1000,
    cacheTtl: 1800,
  },
  '7d': {
    label: 'Last week',
    shortLabel: '7d',
    interval: 'INTERVAL 7 DAY',
    bucket: 'toStartOfTenMinutes(timestamp)',
    step: 'INTERVAL 10 MINUTE',
    periodMs: 7 * 24 * 60 * 60 * 1000,
    cacheTtl: 1800,
  },
  '14d': {
    label: 'Last 2 weeks',
    shortLabel: '14d',
    interval: 'INTERVAL 14 DAY',
    bucket: 'toStartOfInterval(timestamp, INTERVAL 20 MINUTE)',
    step: 'INTERVAL 20 MINUTE',
    periodMs: 14 * 24 * 60 * 60 * 1000,
    cacheTtl: 1800,
  },
  // Month-scale ranges — only offered by long-retention views (e.g. delivery_archive,
  // 18-month TTL). Not in TIME_RANGE_ORDER, so the 2-week-TTL views never show them.
  // Steps use HOUR/DAY units because parseIntervalToMs() (js/time.js) understands those
  // but not MONTH; periodMs uses approximate month lengths for the rolling window bound.
  '1mo': {
    label: 'Last month',
    shortLabel: '1mo',
    interval: 'INTERVAL 1 MONTH',
    bucket: 'toStartOfInterval(timestamp, INTERVAL 4 HOUR)',
    step: 'INTERVAL 4 HOUR',
    periodMs: 30 * 24 * 60 * 60 * 1000,
    cacheTtl: 3600,
  },
  '3mo': {
    label: 'Last 3 months',
    shortLabel: '3mo',
    interval: 'INTERVAL 3 MONTH',
    bucket: 'toStartOfInterval(timestamp, INTERVAL 12 HOUR)',
    step: 'INTERVAL 12 HOUR',
    periodMs: 90 * 24 * 60 * 60 * 1000,
    cacheTtl: 3600,
  },
  '6mo': {
    label: 'Last 6 months',
    shortLabel: '6mo',
    interval: 'INTERVAL 6 MONTH',
    bucket: 'toStartOfDay(timestamp)',
    step: 'INTERVAL 1 DAY',
    periodMs: 180 * 24 * 60 * 60 * 1000,
    cacheTtl: 3600,
  },
  '12mo': {
    label: 'Last 12 months',
    shortLabel: '12mo',
    interval: 'INTERVAL 12 MONTH',
    bucket: 'toStartOfInterval(timestamp, INTERVAL 2 DAY)',
    step: 'INTERVAL 2 DAY',
    periodMs: 365 * 24 * 60 * 60 * 1000,
    cacheTtl: 3600,
  },
  '18mo': {
    label: 'Last 18 months',
    shortLabel: '18mo',
    interval: 'INTERVAL 18 MONTH',
    bucket: 'toStartOfInterval(timestamp, INTERVAL 3 DAY)',
    step: 'INTERVAL 3 DAY',
    periodMs: 548 * 24 * 60 * 60 * 1000,
    cacheTtl: 3600,
  },
};

/** @type {string} */
export const DEFAULT_TIME_RANGE = '7d';

/**
 * Time-range set for long-retention archive views (delivery_archive, 18-month TTL).
 * @type {string[]}
 */
export const ARCHIVE_TIME_RANGE_ORDER = ['1mo', '3mo', '6mo', '12mo', '18mo'];

/** @type {string} */
export const ARCHIVE_DEFAULT_TIME_RANGE = '1mo';

/** @type {number[]} */
export const TOP_N_OPTIONS = [5, 10, 20, 50, 100];

/** @type {number} */
export const DEFAULT_TOP_N = 5;
