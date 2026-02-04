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
import { state } from './state.js';
import { TIME_RANGES, TIME_RANGE_ORDER } from './constants.js';

// Query timestamp for deterministic/cacheable queries
const timeState = {
  queryTimestamp: null,
  customTimeRange: null, // { start: Date, end: Date }
};

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const BASE_TABLE = 'cdn_requests_v2';
const SAMPLED_TABLE_10 = 'cdn_requests_v2_sampled_10';
const SAMPLED_TABLE_1 = 'cdn_requests_v2_sampled_1';

function floorToInterval(date, intervalMs) {
  return new Date(Math.floor(date.getTime() / intervalMs) * intervalMs);
}

function parseIntervalToMs(interval) {
  const match = interval.match(/INTERVAL\s+(\d+)\s+(\w+)/i);
  if (!match) return MINUTE_MS;
  const amount = parseInt(match[1], 10);
  const unit = match[2].toUpperCase().replace(/S$/, '');
  const multipliers = {
    SECOND: SECOND_MS,
    MINUTE: MINUTE_MS,
    HOUR: HOUR_MS,
    DAY: DAY_MS,
  };
  return amount * (multipliers[unit] || MINUTE_MS);
}

function formatSqlDateTime(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

// Get period duration in milliseconds (moved up to avoid use-before-define)
function getPeriodMs() {
  if (timeState.customTimeRange) {
    return timeState.customTimeRange.end - timeState.customTimeRange.start;
  }
  return TIME_RANGES[state.timeRange]?.periodMs;
}

// Get time bucket step (moved up to avoid use-before-define)
function getTimeBucketStep() {
  if (timeState.customTimeRange) {
    const durationMs = timeState.customTimeRange.end - timeState.customTimeRange.start;
    const durationMinutes = durationMs / 60000;
    if (durationMinutes <= 15) return 'INTERVAL 5 SECOND';
    if (durationMinutes <= 60) return 'INTERVAL 10 SECOND';
    if (durationMinutes <= 720) return 'INTERVAL 1 MINUTE';
    if (durationMinutes <= 1440) return 'INTERVAL 5 MINUTE';
    return 'INTERVAL 10 MINUTE';
  }
  return TIME_RANGES[state.timeRange]?.step;
}

export function getSelectedRange() {
  if (timeState.customTimeRange) {
    return {
      start: new Date(timeState.customTimeRange.start),
      end: new Date(timeState.customTimeRange.end),
    };
  }

  const end = timeState.queryTimestamp || new Date();
  const start = new Date(end.getTime() - getPeriodMs());
  return { start, end };
}

function getTimeFilterBounds() {
  const { start, end } = getSelectedRange();
  return {
    start: floorToInterval(start, MINUTE_MS),
    end: floorToInterval(end, MINUTE_MS),
  };
}

function getFillBounds() {
  const { start, end } = getTimeFilterBounds();
  const stepMs = parseIntervalToMs(getTimeBucketStep());
  const alignedStart = floorToInterval(start, stepMs);
  const endInclusive = new Date(end.getTime() + MINUTE_MS - 1);
  const alignedEnd = floorToInterval(endInclusive, stepMs);

  return {
    start: alignedStart,
    end: alignedEnd,
    stepMs,
  };
}

// Getter functions for time state
export function queryTimestamp() {
  return timeState.queryTimestamp;
}

export function customTimeRange() {
  return timeState.customTimeRange;
}

export function setQueryTimestamp(ts) {
  timeState.queryTimestamp = ts;
}

export function setCustomTimeRange(start, end) {
  // Round to full minutes for projection compatibility
  const roundedStart = new Date(Math.floor(start.getTime() / 60000) * 60000);
  const roundedEnd = new Date(Math.ceil(end.getTime() / 60000) * 60000);

  // Enforce minimum 3-minute window
  const minDuration = 3 * 60 * 1000;
  const duration = roundedEnd - roundedStart;
  if (duration < minDuration) {
    const midpoint = (roundedStart.getTime() + roundedEnd.getTime()) / 2;
    timeState.customTimeRange = {
      start: new Date(midpoint - minDuration / 2),
      end: new Date(midpoint + minDuration / 2),
    };
  } else {
    timeState.customTimeRange = { start: roundedStart, end: roundedEnd };
  }
  // Set query timestamp to end of range
  timeState.queryTimestamp = timeState.customTimeRange.end;
}

export function clearCustomTimeRange() {
  timeState.customTimeRange = null;
}

export function isCustomTimeRange() {
  return timeState.customTimeRange !== null;
}

export function getCustomTimeRange() {
  return timeState.customTimeRange;
}

export function getTable() {
  return BASE_TABLE;
}

export function getSampledTable(sampleRate) {
  if (!sampleRate || sampleRate >= 1) return BASE_TABLE;
  if (sampleRate <= 0.01) return SAMPLED_TABLE_1;
  if (sampleRate <= 0.1) return SAMPLED_TABLE_10;
  return BASE_TABLE;
}

export function getInterval() {
  // Custom time range doesn't use interval (uses explicit timestamps)
  if (timeState.customTimeRange) {
    const durationMs = timeState.customTimeRange.end - timeState.customTimeRange.start;
    const minutes = Math.ceil(durationMs / 60000);
    return `INTERVAL ${minutes} MINUTE`;
  }

  return TIME_RANGES[state.timeRange]?.interval;
}

export function getTimeBucket() {
  // For custom time range, calculate appropriate bucket based on duration
  if (timeState.customTimeRange) {
    const durationMs = timeState.customTimeRange.end - timeState.customTimeRange.start;
    const durationMinutes = durationMs / 60000;

    // Match bucket sizes to similar predefined periods:
    // < 15 min: 5 second buckets
    // 15 min - 1 hour: 10 second buckets
    // 1-12 hours: 1 minute buckets
    // 12-24 hours: 5 minute buckets
    // > 24 hours: 10 minute buckets
    if (durationMinutes <= 15) {
      return 'toStartOfInterval(timestamp, INTERVAL 5 SECOND)';
    } else if (durationMinutes <= 60) {
      return 'toStartOfInterval(timestamp, INTERVAL 10 SECOND)';
    } else if (durationMinutes <= 720) {
      return 'toStartOfMinute(timestamp)';
    } else if (durationMinutes <= 1440) {
      return 'toStartOfFiveMinutes(timestamp)';
    } else {
      return 'toStartOfTenMinutes(timestamp)';
    }
  }

  return TIME_RANGES[state.timeRange]?.bucket;
}

// Re-export getTimeBucketStep for external use
export { getTimeBucketStep };

export function getTimeFilter() {
  const { start, end } = getTimeFilterBounds();
  const startIso = formatSqlDateTime(start);
  const endIso = formatSqlDateTime(end);
  return `toStartOfMinute(timestamp) BETWEEN toStartOfMinute(toDateTime('${startIso}')) AND toStartOfMinute(toDateTime('${endIso}'))`;
}

export function getHostFilter() {
  if (!state.hostFilter) return '';
  const escaped = state.hostFilter.replace(/'/g, "\\'");
  return `AND (\`request.host\` LIKE '%${escaped}%' OR \`request.headers.x_forwarded_host\` LIKE '%${escaped}%')`;
}

// Get aligned time range for chart rendering and WITH FILL bounds
export function getTimeRangeBounds() {
  const { start, end } = getFillBounds();
  return { start, end };
}

// Get start time for WITH FILL FROM clause
export function getTimeRangeStart() {
  const { start } = getFillBounds();
  return `toDateTime('${formatSqlDateTime(start)}')`;
}

// Get end time for WITH FILL TO clause
export function getTimeRangeEnd() {
  const { end } = getFillBounds();
  return `toDateTime('${formatSqlDateTime(end)}')`;
}

// Re-export getPeriodMs for external use
export { getPeriodMs };

// Zoom out to next larger predefined period, centered on current midpoint
export function zoomOut() {
  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Calculate current midpoint
  let midpoint;
  if (timeState.customTimeRange) {
    const range = timeState.customTimeRange;
    midpoint = new Date((range.start.getTime() + range.end.getTime()) / 2);
  } else {
    const ts = timeState.queryTimestamp || now;
    const periodMs = getPeriodMs();
    midpoint = new Date(ts.getTime() - periodMs / 2);
  }

  // Determine current duration and next larger period
  const currentDurationMs = getPeriodMs();
  const periods = TIME_RANGE_ORDER.map((key) => ({ key, ms: TIME_RANGES[key].periodMs }));

  // Find next larger period
  const nextPeriod = periods.find((p) => p.ms > currentDurationMs);
  if (!nextPeriod) {
    // Already at 7d, can't zoom out further
    return null;
  }

  // Calculate new range centered on midpoint
  let newStart = new Date(midpoint.getTime() - nextPeriod.ms / 2);
  let newEnd = new Date(midpoint.getTime() + nextPeriod.ms / 2);

  // Apply constraints: can't go into future
  if (newEnd > now) {
    newEnd = now;
    newStart = new Date(now.getTime() - nextPeriod.ms);
  }

  // Apply constraints: can't exceed 2-week retention
  if (newStart < twoWeeksAgo) {
    newStart = twoWeeksAgo;
    newEnd = new Date(twoWeeksAgo.getTime() + nextPeriod.ms);
    // But still can't go into future
    if (newEnd > now) {
      newEnd = now;
    }
  }

  // Clear custom range and set predefined period
  timeState.customTimeRange = null;
  state.timeRange = nextPeriod.key;
  timeState.queryTimestamp = newEnd;

  return { timeRange: nextPeriod.key, queryTimestamp: newEnd };
}
