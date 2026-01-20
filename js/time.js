// Time range helpers
import { state } from './state.js';
import { TIME_RANGES, TIME_RANGE_ORDER } from './constants.js';

// Query timestamp for deterministic/cacheable queries
export let queryTimestamp = null;

export function setQueryTimestamp(ts) {
  queryTimestamp = ts;
}

// Custom time range for zoom feature (null = use predefined periods)
export let customTimeRange = null; // { start: Date, end: Date }

export function setCustomTimeRange(start, end) {
  // Round to full minutes for projection compatibility
  const roundedStart = new Date(Math.floor(start.getTime() / 60000) * 60000);
  const roundedEnd = new Date(Math.ceil(end.getTime() / 60000) * 60000);

  // Enforce minimum 3-minute window
  const minDuration = 3 * 60 * 1000;
  const duration = roundedEnd - roundedStart;
  if (duration < minDuration) {
    const midpoint = (roundedStart.getTime() + roundedEnd.getTime()) / 2;
    customTimeRange = {
      start: new Date(midpoint - minDuration / 2),
      end: new Date(midpoint + minDuration / 2),
    };
  } else {
    customTimeRange = { start: roundedStart, end: roundedEnd };
  }
  // Set query timestamp to end of range
  queryTimestamp = customTimeRange.end;
}

export function clearCustomTimeRange() {
  customTimeRange = null;
}

export function isCustomTimeRange() {
  return customTimeRange !== null;
}

export function getCustomTimeRange() {
  return customTimeRange;
}

export function getTable() {
  return 'cdn_requests_v2';
}

export function getInterval() {
  // Custom time range doesn't use interval (uses explicit timestamps)
  if (customTimeRange) {
    const durationMs = customTimeRange.end - customTimeRange.start;
    const minutes = Math.ceil(durationMs / 60000);
    return `INTERVAL ${minutes} MINUTE`;
  }

  return TIME_RANGES[state.timeRange]?.interval;
}

export function getTimeBucket() {
  // For custom time range, calculate appropriate bucket based on duration
  if (customTimeRange) {
    const durationMs = customTimeRange.end - customTimeRange.start;
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

export function getTimeFilter() {
  // For custom time range, use explicit start/end timestamps
  if (customTimeRange) {
    const startIso = customTimeRange.start.toISOString().replace('T', ' ').slice(0, 19);
    const endIso = customTimeRange.end.toISOString().replace('T', ' ').slice(0, 19);
    return `toStartOfMinute(timestamp) BETWEEN toStartOfMinute(toDateTime('${startIso}')) AND toStartOfMinute(toDateTime('${endIso}'))`;
  }

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
  if (customTimeRange) {
    return customTimeRange.end - customTimeRange.start;
  }

  return TIME_RANGES[state.timeRange]?.periodMs;
}

// Zoom out to next larger predefined period, centered on current midpoint
export function zoomOut() {
  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Calculate current midpoint
  let midpoint;
  if (customTimeRange) {
    midpoint = new Date((customTimeRange.start.getTime() + customTimeRange.end.getTime()) / 2);
  } else {
    const ts = queryTimestamp || now;
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
  customTimeRange = null;
  state.timeRange = nextPeriod.key;
  queryTimestamp = newEnd;

  return { timeRange: nextPeriod.key, queryTimestamp: newEnd };
}
