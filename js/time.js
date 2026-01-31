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
  return 'cdn_requests_v2';
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

export function getTimeBucketStep() {
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

export function getTimeFilter() {
  // For custom time range, use explicit start/end timestamps
  if (timeState.customTimeRange) {
    const startIso = timeState.customTimeRange.start.toISOString().replace('T', ' ').slice(0, 19);
    const endIso = timeState.customTimeRange.end.toISOString().replace('T', ' ').slice(0, 19);
    return `toStartOfMinute(timestamp) BETWEEN toStartOfMinute(toDateTime('${startIso}')) AND toStartOfMinute(toDateTime('${endIso}'))`;
  }

  // Use fixed timestamp instead of now() for deterministic/cacheable queries
  const ts = timeState.queryTimestamp || new Date();
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
  if (timeState.customTimeRange) {
    return timeState.customTimeRange.end - timeState.customTimeRange.start;
  }

  return TIME_RANGES[state.timeRange]?.periodMs;
}

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
