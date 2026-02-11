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
 * Data plane for chart - handles state management, navigation logic, and time calculations.
 * UI concerns (rendering, event handling) are in chart.js.
 */

import { addFilter } from './filters.js';
import {
  getPeriodMs,
  queryTimestamp,
  setCustomTimeRange,
  setQueryTimestamp,
} from './time.js';
import { saveStateToURL } from './url-state.js';

// Status range column for filtering
export const STATUS_RANGE_COL = "concat(toString(intDiv(`response.status`, 100)), 'xx')";

// Navigation callback
let onNavigate = null;

// Chart state - anomaly and step detection
let lastAnomalyBoundsList = []; // Array of { left, right, startTime, endTime, rank }
let lastChartData = null; // Store data for timestamp lookups
let lastDetectedSteps = []; // Store detected steps for investigation

// Ship positions for tooltip hit-testing
let lastShipPositions = null;

// Chart layout info (set during render)
let chartLayout = null;

// Pending selection state
// { startTime, endTime } - persists after drag until clicked or cleared
let pendingSelection = null;

/**
 * Set the navigation callback
 * @param {Function} callback - Navigation callback function
 */
export function setNavigationCallback(callback) {
  onNavigate = callback;
}

/**
 * Get the navigation callback
 * @returns {Function|null} Navigation callback
 */
export function getNavigationCallback() {
  return onNavigate;
}

/**
 * Navigate time by a fraction of the current period
 * @param {number} fraction - Fraction to shift (negative = back, positive = forward)
 */
export function navigateTime(fraction) {
  const periodMs = getPeriodMs();
  const shiftMs = periodMs * fraction;
  const currentTs = queryTimestamp() || new Date();
  const newTs = new Date(currentTs.getTime() + shiftMs);

  // Don't go into the future
  const now = new Date();
  if (newTs > now) {
    setQueryTimestamp(now);
  } else {
    setQueryTimestamp(newTs);
  }

  if (onNavigate) onNavigate();
}

/**
 * Set chart layout info
 * @param {Object} layout - Layout dimensions { width, height, padding, chartWidth, chartHeight }
 */
export function setChartLayout(layout) {
  chartLayout = layout;
}

/**
 * Get chart layout info
 * @returns {Object|null} Chart layout
 */
export function getChartLayout() {
  return chartLayout;
}

/**
 * Set last chart data
 * @param {Array} data - Chart data points
 */
export function setLastChartData(data) {
  lastChartData = data;
}

/**
 * Get last chart data
 * @returns {Array|null} Chart data
 */
export function getLastChartData() {
  return lastChartData;
}

/**
 * Set detected anomaly bounds list
 * @param {Array} bounds - Array of anomaly bounds
 */
export function setAnomalyBoundsList(bounds) {
  lastAnomalyBoundsList = bounds;
}

/**
 * Get detected anomaly bounds list
 * @returns {Array} Anomaly bounds
 */
export function getAnomalyBoundsList() {
  return lastAnomalyBoundsList;
}

/**
 * Add an anomaly bounds entry
 * @param {Object} bounds - Anomaly bounds { left, right, startTime, endTime, rank }
 */
export function addAnomalyBounds(bounds) {
  lastAnomalyBoundsList.push(bounds);
}

/**
 * Reset anomaly bounds list
 */
export function resetAnomalyBounds() {
  lastAnomalyBoundsList = [];
}

/**
 * Set detected steps from step detection
 * @param {Array} steps - Detected steps with metadata
 */
export function setDetectedSteps(steps) {
  lastDetectedSteps = steps;
}

/**
 * Get detected steps
 * @returns {Array} Detected steps
 */
export function getDetectedSteps() {
  return lastDetectedSteps;
}

/**
 * Set ship positions for tooltip hit-testing
 * @param {Array|null} positions - Ship positions or null
 */
export function setShipPositions(positions) {
  lastShipPositions = positions;
}

/**
 * Get ship positions
 * @returns {Array|null} Ship positions
 */
export function getShipPositions() {
  return lastShipPositions;
}

/**
 * Set pending selection state
 * @param {Object|null} selection - Selection { startTime, endTime } or null
 */
export function setPendingSelection(selection) {
  pendingSelection = selection;
}

/**
 * Get pending selection state
 * @returns {Object|null} Pending selection
 */
export function getPendingSelection() {
  return pendingSelection;
}

/**
 * Get the count of detected anomalies
 * @returns {number} Anomaly count
 */
export function getAnomalyCount() {
  return lastAnomalyBoundsList.length;
}

/**
 * Get the time range of an anomaly by rank (1-5)
 * @param {number} rank - Anomaly rank
 * @returns {Object|null} Time range { start, end } or null
 */
export function getAnomalyTimeRange(rank = 1) {
  const bounds = lastAnomalyBoundsList.find((b) => b.rank === rank);
  if (!bounds) return null;
  return {
    start: bounds.startTime,
    end: bounds.endTime,
  };
}

/**
 * Get all detected anomalies with time bounds (for investigation)
 * @returns {Array} Anomalies with time bounds
 */
export function getDetectedAnomalies() {
  return lastAnomalyBoundsList.map((bounds) => ({
    rank: bounds.rank,
    startTime: bounds.startTime,
    endTime: bounds.endTime,
    // Find matching step info from last detection
    ...lastDetectedSteps.find((s) => s.rank === bounds.rank),
  }));
}

/**
 * Parse timestamp as UTC (ClickHouse returns UTC times without Z suffix)
 * @param {string|Date} timestamp - Timestamp to parse
 * @returns {Date} Parsed date
 */
export function parseUTC(timestamp) {
  const str = String(timestamp);
  // If already has Z suffix, parse directly
  if (str.endsWith('Z')) {
    return new Date(str);
  }
  // Otherwise, normalize and append Z to treat as UTC
  return new Date(`${str.replace(' ', 'T')}Z`);
}

/**
 * Get the time range for the most recent section (last 20% of timeline)
 * @returns {Object|null} Time range { start, end } or null
 */
export function getMostRecentTimeRange() {
  if (!lastChartData || lastChartData.length < 2) return null;
  const len = lastChartData.length;
  // Last 20% of the timeline
  const startIdx = Math.floor(len * 0.8);
  return {
    start: parseUTC(lastChartData[startIdx].t),
    end: parseUTC(lastChartData[len - 1].t),
  };
}

/**
 * Check if x position is within any anomaly region
 * @param {number} x - X coordinate
 * @returns {Object|null} Matching anomaly bounds or null
 */
export function getAnomalyAtX(x) {
  for (const bounds of lastAnomalyBoundsList) {
    if (x >= bounds.left && x <= bounds.right) {
      return bounds;
    }
  }
  return null;
}

/**
 * Get time at x position on chart
 * @param {number} x - X coordinate
 * @returns {Date|null} Time at position or null
 */
export function getTimeAtX(x) {
  if (!chartLayout) return null;
  const {
    padding, chartWidth, intendedStartTime, intendedEndTime,
  } = chartLayout;
  const xRatio = (x - padding.left) / chartWidth;
  if (xRatio < 0 || xRatio > 1) return null;

  if (Number.isFinite(intendedStartTime)
    && Number.isFinite(intendedEndTime)
    && intendedEndTime > intendedStartTime) {
    return new Date(intendedStartTime + xRatio * (intendedEndTime - intendedStartTime));
  }

  if (!lastChartData || lastChartData.length < 2) return null;
  const startTime = parseUTC(lastChartData[0].t).getTime();
  const endTime = parseUTC(lastChartData[lastChartData.length - 1].t).getTime();
  const time = new Date(startTime + xRatio * (endTime - startTime));
  return time;
}

/**
 * Get x position on chart for a given time (inverse of getTimeAtX)
 * @param {Date|number} time - Time as Date or milliseconds
 * @returns {number} X coordinate
 */
export function getXAtTime(time) {
  if (!chartLayout) return 0;
  const {
    padding, chartWidth, intendedStartTime, intendedEndTime,
  } = chartLayout;
  const timeMs = time instanceof Date ? time.getTime() : time;
  const ratio = (timeMs - intendedStartTime) / (intendedEndTime - intendedStartTime);
  return padding.left + ratio * chartWidth;
}

/**
 * Calculate status bar inner element left position with edge easing.
 * @param {number} x - Target center X coordinate
 * @param {number} statusWidth - Status bar width
 * @param {number} innerWidth - Inner content width
 * @param {number} chartWidth - Full chart width
 * @param {number} pad - CSS padding (default 24)
 * @returns {number} Left margin value
 */
export function calcStatusBarLeft(x, statusWidth, innerWidth, chartWidth, pad = 24) {
  const targetLeft = x - innerWidth / 2;
  const minLeft = pad;
  const maxLeft = statusWidth - innerWidth - pad;
  const edgeZone = innerWidth / 2 + pad;
  let finalLeft;
  if (x < edgeZone) {
    const t = x / edgeZone;
    finalLeft = minLeft + (targetLeft - minLeft) * t;
  } else if (x > chartWidth - edgeZone) {
    const t = (chartWidth - x) / edgeZone;
    finalLeft = maxLeft + (targetLeft - maxLeft) * t;
  } else {
    finalLeft = targetLeft;
  }
  return Math.max(minLeft, Math.min(maxLeft, finalLeft));
}

/**
 * Format time for scrubber display
 * @param {Date} time - Time to format
 * @returns {Object} Formatted time { timeStr, relativeStr }
 */
export function formatScrubberTime(time) {
  const now = new Date();
  const diffMs = now - time;
  const diffMinutes = Math.floor(diffMs / 60000);

  // Format like x-axis: HH:MM:SS UTC, with weekday prefix if > 24h ago
  const hms = time.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
  const diffHours = diffMs / (60 * 60 * 1000);
  const timeStr = diffHours > 24
    ? `${time.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} ${hms}`
    : hms;

  // Add relative time if < 120 minutes ago
  let relativeStr = '';
  if (diffMinutes >= 0 && diffMinutes < 120) {
    if (diffMinutes === 0) {
      relativeStr = 'just now';
    } else if (diffMinutes === 1) {
      relativeStr = '1 min ago';
    } else {
      relativeStr = `${diffMinutes} min ago`;
    }
  }

  return { timeStr, relativeStr };
}

/**
 * Format anomaly duration
 * @param {Date} startTime - Start time
 * @param {Date} endTime - End time
 * @returns {string} Formatted duration
 */
export function formatDuration(startTime, endTime) {
  const durationMs = endTime - startTime;
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

/**
 * Zoom to anomaly by rank (1 = most prominent)
 * @param {number} rank - Anomaly rank
 * @returns {boolean} True if zoomed, false if anomaly not found
 */
export function zoomToAnomalyByRank(rank) {
  const range = getAnomalyTimeRange(rank);
  if (!range) return false;

  // Get the anomaly ID for this rank (set during investigation)
  const anomalyId = window.anomalyIdsByRank?.[rank] || null;

  // Get the anomaly category and add corresponding status filter
  const step = lastDetectedSteps.find((s) => s.rank === rank);
  if (step?.category) {
    // Map category to status range filter values
    // red = 5xx errors, yellow = 4xx client errors, green = 2xx success
    const statusFilters = {
      red: ['5xx'],
      yellow: ['4xx'],
      green: ['2xx'], // Focus on successful requests for green anomalies
    };
    const values = statusFilters[step.category];
    if (values) {
      for (const value of values) {
        // Skip reload - we'll reload once after setting time range
        addFilter(STATUS_RANGE_COL, value, false, undefined, undefined, undefined, true);
      }
    }
  }

  setCustomTimeRange(range.start, range.end);
  // Save all state atomically in one history entry (time + filters + anomaly ID)
  saveStateToURL(anomalyId);

  if (onNavigate) onNavigate();
  return true;
}

/**
 * Zoom to the most prominent anomaly, or most recent section if none
 * @returns {boolean} True if zoomed
 */
export function zoomToAnomaly() {
  // Try most prominent anomaly first
  if (lastAnomalyBoundsList.length > 0) {
    return zoomToAnomalyByRank(1);
  }

  // Fall back to most recent section
  const range = getMostRecentTimeRange();
  if (!range) return false;

  setCustomTimeRange(range.start, range.end);
  saveStateToURL();

  if (onNavigate) onNavigate();
  return true;
}

/**
 * Get ship near x position (with padding for easier hover)
 * @param {number} x - X coordinate
 * @param {number} padding - Hit-test padding (default 20)
 * @returns {Object|null} Ship at position or null
 */
export function getShipNearX(x, padding = 20) {
  if (!lastShipPositions) return null;
  for (const ship of lastShipPositions) {
    if (Math.abs(x - ship.x) <= padding) {
      return ship;
    }
  }
  return null;
}

/**
 * Convert hex color to rgba
 * @param {string} hex - Hex color (e.g., '#ff0000')
 * @param {number} alpha - Alpha value (0-1)
 * @returns {string} RGBA color string
 */
export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Round value to nice number for axis labels
 * @param {number} val - Value to round
 * @returns {number} Rounded nice number (always an integer)
 */
export function roundToNice(val) {
  if (val === 0) return 0;
  if (val < 1) return Math.ceil(val);

  const magnitude = 10 ** Math.floor(Math.log10(val));
  const normalized = val / magnitude;
  let nice;
  if (normalized <= 1.5) nice = 1;
  else if (normalized <= 2.25) nice = 2;
  else if (normalized <= 3.5) nice = 2.5;
  else if (normalized <= 7.5) nice = 5;
  else nice = 10;

  const result = nice * magnitude;

  // If the result is less than 10, always return an integer
  // This ensures small scales (1, 2, 3, etc.) never have decimals like 2.5
  if (result < 10) {
    return Math.round(result);
  }

  return result;
}
