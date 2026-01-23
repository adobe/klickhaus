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
 * UI plane for chart - handles rendering and event handling.
 * State management and navigation logic are in chart-state.js.
 */

import { query } from './api.js';
import { getFacetFilters } from './breakdowns/index.js';
import { DATABASE } from './config.js';
import { formatNumber } from './format.js';
import { state } from './state.js';
import { detectSteps } from './step-detection.js';
import {
  getHostFilter,
  getTable,
  getTimeBucket,
  getTimeFilter,
  setCustomTimeRange,
} from './time.js';
import { saveStateToURL } from './url-state.js';
import {
  getReleasesInRange, renderReleaseShips, getShipAtPoint, showReleaseTooltip, hideReleaseTooltip,
} from './releases.js';
import { investigateTimeRange, clearSelectionHighlights } from './anomaly-investigation.js';
import {
  setNavigationCallback,
  getNavigationCallback,
  navigateTime,
  setChartLayout,
  getChartLayout,
  setLastChartData,
  getLastChartData,
  addAnomalyBounds,
  resetAnomalyBounds,
  setDetectedSteps,
  getDetectedSteps,
  setShipPositions,
  getShipPositions,
  setPendingSelection,
  getPendingSelection,
  getAnomalyAtX,
  getTimeAtX,
  formatScrubberTime,
  formatDuration,
  zoomToAnomalyByRank,
  getShipNearX,
  hexToRgba,
  roundToNice,
  parseUTC,
} from './chart-state.js';

// Re-export state functions for external use
export {
  getAnomalyCount,
  getAnomalyTimeRange,
  getDetectedAnomalies,
  getLastChartData,
  getMostRecentTimeRange,
  zoomToAnomalyByRank,
  zoomToAnomaly,
} from './chart-state.js';

// UI elements and drag state
let scrubberLine = null;
let scrubberStatusBar = null;
let selectionOverlay = null;
let navOverlay = null;
let isDragging = false;
let dragStartX = null;
let justCompletedDrag = false;

export function renderChart(data) {
  // Store data for zoom functionality and reset anomaly/ship bounds
  setLastChartData(data);
  resetAnomalyBounds();
  setShipPositions(null);
  hideReleaseTooltip();
  const canvas = document.getElementById('chart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  // Set canvas size
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const { width } = rect;
  const { height } = rect;
  const padding = {
    top: 20, right: 0, bottom: 40, left: 0,
  };
  const labelInset = 24; // Match main element padding for alignment with breakdowns
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Store layout for scrubber
  setChartLayout({
    width, height, padding, chartWidth, chartHeight,
  });

  // Clear
  ctx.clearRect(0, 0, width, height);

  // Get CSS variables for theming
  const styles = getComputedStyle(document.documentElement);
  const cssVar = (name) => styles.getPropertyValue(name).trim();

  if (data.length === 0) {
    ctx.fillStyle = cssVar('--text-secondary');
    ctx.textAlign = 'center';
    ctx.fillText('No data', width / 2, height / 2);
    return;
  }

  // Parse data into stacked values
  const series = {
    ok: data.map((d) => parseInt(d.cnt_ok, 10) || 0),
    client: data.map((d) => parseInt(d.cnt_4xx, 10) || 0),
    server: data.map((d) => parseInt(d.cnt_5xx, 10) || 0),
  };

  // Calculate stacked totals for max value
  const totals = data.map((_, i) => series.ok[i] + series.client[i] + series.server[i]);
  const maxValue = Math.max(...totals);
  const minValue = 0;

  // Colors from CSS variables
  const okColor = cssVar('--status-ok');
  const clientColor = cssVar('--status-client-error');
  const serverColor = cssVar('--status-server-error');

  const colors = {
    ok: { line: okColor, fill: hexToRgba(okColor, 0.3) },
    client: { line: clientColor, fill: hexToRgba(clientColor, 0.3) },
    server: { line: serverColor, fill: hexToRgba(serverColor, 0.3) },
  };

  // Draw axes
  ctx.strokeStyle = cssVar('--axis-line');
  ctx.lineWidth = 1;

  // X axis
  ctx.beginPath();
  ctx.moveTo(padding.left, height - padding.bottom);
  ctx.lineTo(width - padding.right, height - padding.bottom);
  ctx.stroke();

  // Y axis labels (inside chart, above grid lines, skip zero)
  ctx.fillStyle = cssVar('--text-secondary');
  ctx.font = '11px -apple-system, sans-serif';
  ctx.textAlign = 'left';

  for (let i = 1; i <= 4; i += 1) {
    const rawVal = minValue + (maxValue - minValue) * (i / 4);
    // Keep top value exact, round others to nice numbers
    const val = (i === 4) ? Math.round(rawVal) : roundToNice(rawVal);
    const y = height - padding.bottom - ((chartHeight * i) / 4);

    // Grid line
    ctx.strokeStyle = cssVar('--grid-line');
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();

    // Label inside chart, above grid line
    ctx.fillStyle = cssVar('--text-secondary');
    ctx.fillText(formatNumber(val), padding.left + labelInset, y - 4);
  }

  // X axis labels - fewer on mobile (first, middle, last)
  ctx.fillStyle = cssVar('--text-secondary');
  const isMobile = width < 500;
  const tickIndices = isMobile
    ? [0, Math.floor((data.length - 1) / 2), data.length - 1]
    : Array.from({ length: 6 }, (_, idx) => Math.round((idx * (data.length - 1)) / 5));

  for (const i of tickIndices) {
    if (i < data.length) {
      let x = padding.left + ((chartWidth * i) / (data.length - 1));
      const time = parseUTC(data[i].t);
      let label = time.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
      });
      // Align first label left, last label right, others center
      if (i === 0) {
        ctx.textAlign = 'left';
        x += labelInset;
      } else if (i === data.length - 1) {
        ctx.textAlign = 'right';
        x -= labelInset;
        label += ' (UTC)';
      } else {
        ctx.textAlign = 'center';
      }
      ctx.fillText(label, x, height - padding.bottom + 20);
    }
  }

  // Helper function to get Y coordinate
  const getY = (value) => height - padding.bottom - ((chartHeight * value) / (maxValue || 1));
  const getX = (idx) => padding.left + ((chartWidth * idx) / (data.length - 1 || 1));

  // Calculate cumulative values for stacking (reversed order: 5xx at bottom)
  const stackedServer = series.server.slice();
  const stackedClient = series.server.map((v, i) => v + series.client[i]);
  const stackedOk = series.server.map((v, i) => v + series.client[i] + series.ok[i]);

  // Draw 1xx-3xx area (top layer - green)
  if (series.ok.some((v) => v > 0)) {
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(stackedClient[0]));
    for (let i = 0; i < data.length; i += 1) {
      ctx.lineTo(getX(i), getY(stackedOk[i]));
    }
    for (let i = data.length - 1; i >= 0; i -= 1) {
      ctx.lineTo(getX(i), getY(stackedClient[i]));
    }
    ctx.closePath();
    ctx.fillStyle = colors.ok.fill;
    ctx.fill();

    // Draw line on top
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(stackedOk[0]));
    for (let i = 1; i < data.length; i += 1) {
      ctx.lineTo(getX(i), getY(stackedOk[i]));
    }
    ctx.strokeStyle = colors.ok.line;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Draw 4xx area (middle layer - yellow/orange)
  if (series.client.some((v) => v > 0)) {
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(stackedServer[0]));
    for (let i = 0; i < data.length; i += 1) {
      ctx.lineTo(getX(i), getY(stackedClient[i]));
    }
    for (let i = data.length - 1; i >= 0; i -= 1) {
      ctx.lineTo(getX(i), getY(stackedServer[i]));
    }
    ctx.closePath();
    ctx.fillStyle = colors.client.fill;
    ctx.fill();

    // Draw line on top
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(stackedClient[0]));
    for (let i = 1; i < data.length; i += 1) {
      ctx.lineTo(getX(i), getY(stackedClient[i]));
    }
    ctx.strokeStyle = colors.client.line;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Draw 5xx area (bottom layer - red)
  if (series.server.some((v) => v > 0)) {
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(0));
    for (let i = 0; i < data.length; i += 1) {
      ctx.lineTo(getX(i), getY(stackedServer[i]));
    }
    ctx.lineTo(getX(data.length - 1), getY(0));
    ctx.closePath();
    ctx.fillStyle = colors.server.fill;
    ctx.fill();

    // Draw line on top
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(stackedServer[0]));
    for (let i = 1; i < data.length; i += 1) {
      ctx.lineTo(getX(i), getY(stackedServer[i]));
    }
    ctx.strokeStyle = colors.server.line;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Detect and highlight up to 5 anomaly regions (spikes or dips)
  // Skip anomaly detection for time ranges less than 5 minutes
  const timeRangeMs = data.length >= 2
    ? parseUTC(data[data.length - 1].t) - parseUTC(data[0].t)
    : 0;
  const minTimeRangeMs = 5 * 60 * 1000; // 5 minutes
  const steps = timeRangeMs >= minTimeRangeMs ? detectSteps(series, 5) : [];

  // Store detected steps for investigation (with additional metadata)
  const stepsWithTime = steps.map((s) => ({
    ...s,
    startTime: data[s.startIndex]?.t ? parseUTC(data[s.startIndex].t) : null,
    endTime: data[s.endIndex]?.t ? parseUTC(data[s.endIndex].t) : null,
  }));
  setDetectedSteps(stepsWithTime);

  // Debug: show detected anomalies in console
  if (steps.length > 0) {
    // eslint-disable-next-line no-console
    console.table(steps.map((s) => ({
      rank: s.rank,
      type: s.type,
      category: s.category,
      startIndex: s.startIndex,
      endIndex: s.endIndex,
      startTime: data[s.startIndex]?.t,
      endTime: data[s.endIndex]?.t,
      magnitude: `${Math.round(s.magnitude * 100)}%`,
      score: s.score.toFixed(2),
    })));
  }

  for (const step of steps) {
    const startX = getX(step.startIndex);
    const endX = getX(step.endIndex);
    // Wider minimum band for better visibility
    const minBandWidth = Math.max((chartWidth / data.length) * 2, 16);

    // Calculate band edges with padding on both sides
    const bandPadding = minBandWidth / 2;
    const bandLeft = startX - bandPadding;
    const bandRight = step.startIndex === step.endIndex
      ? startX + bandPadding
      : endX + bandPadding;

    // Store anomaly bounds for click detection and zoom
    const startTime = parseUTC(data[step.startIndex].t);
    const endTime = parseUTC(data[step.endIndex].t);
    addAnomalyBounds({
      left: bandLeft,
      right: bandRight,
      startTime,
      endTime,
      rank: step.rank,
    });

    // Color coding matches the traffic category: red (5xx), yellow (4xx), green (2xx/3xx)
    // Use slightly lower opacity for lower-ranked anomalies, but keep them clearly visible
    // Labels and lines always use full opacity for readability
    const opacityMultiplier = step.rank === 1 ? 1 : 0.7;
    let highlightFill;
    let highlightStroke;
    let labelColor;

    if (step.category === 'red') {
      // Red for 5xx anomalies
      highlightFill = `rgba(240, 68, 56, ${0.35 * opacityMultiplier})`;
      highlightStroke = 'rgba(240, 68, 56, 0.8)';
      labelColor = 'rgb(240, 68, 56)';
    } else if (step.category === 'yellow') {
      // Orange/amber for 4xx anomalies
      highlightFill = `rgba(247, 144, 9, ${0.35 * opacityMultiplier})`;
      highlightStroke = 'rgba(247, 144, 9, 0.8)';
      labelColor = 'rgb(247, 144, 9)';
    } else {
      // Green for 2xx/3xx anomalies
      highlightFill = `rgba(18, 183, 106, ${0.35 * opacityMultiplier})`;
      highlightStroke = 'rgba(18, 183, 106, 0.8)';
      labelColor = 'rgb(18, 183, 106)';
    }

    // Determine the data range for this anomaly band
    const startIdx = step.startIndex;
    const endIdx = step.endIndex;

    // Get the top and bottom curves for this category
    let getSeriesTop;
    let getSeriesBottom;
    if (step.category === 'red') {
      // Red: from x-axis (0) to stackedServer
      getSeriesTop = (i) => getY(stackedServer[i]);
      getSeriesBottom = () => getY(0);
    } else if (step.category === 'yellow') {
      // Yellow: from stackedServer to stackedClient
      getSeriesTop = (i) => getY(stackedClient[i]);
      getSeriesBottom = (i) => getY(stackedServer[i]);
    } else {
      // Green: from stackedClient to stackedOk
      getSeriesTop = (i) => getY(stackedOk[i]);
      getSeriesBottom = (i) => getY(stackedClient[i]);
    }

    // Draw shaded region as a direct polygon (no clipping)
    // Build array of points for debugging
    const points = [];

    // Top edge: trace from startIdx to endIdx along the series top
    for (let i = startIdx; i <= endIdx; i += 1) {
      points.push({ x: getX(i), y: getSeriesTop(i), label: `top[${i}]` });
    }
    // Bottom edge: trace back from endIdx to startIdx along the series bottom
    for (let i = endIdx; i >= startIdx; i -= 1) {
      points.push({ x: getX(i), y: getSeriesBottom(i), label: `bot[${i}]` });
    }

    // Draw filled polygon for the anomaly region
    ctx.fillStyle = highlightFill;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
    ctx.fill();

    // Draw dashed vertical lines at band edges (full height for visibility)
    ctx.strokeStyle = highlightStroke;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);

    // Left edge line
    ctx.beginPath();
    ctx.moveTo(bandLeft, padding.top);
    ctx.lineTo(bandLeft, height - padding.bottom);
    ctx.stroke();

    // Right edge line
    ctx.beginPath();
    ctx.moveTo(bandRight, padding.top);
    ctx.lineTo(bandRight, height - padding.bottom);
    ctx.stroke();

    ctx.setLineDash([]); // Reset dash

    // Draw indicator label at top center of the region
    const centerX = (bandLeft + bandRight) / 2;
    const arrowY = padding.top + 12;
    const arrow = step.type === 'spike' ? '▲' : '▼';

    // Format magnitude: use multiplier (2x, 3.5x) instead of percentage for large values
    let magnitudeLabel;
    if (step.magnitude >= 1) {
      const multiplier = step.magnitude;
      magnitudeLabel = multiplier >= 10
        ? `${Math.round(multiplier)}x`
        : `${multiplier.toFixed(1).replace(/\.0$/, '')}x`;
    } else {
      magnitudeLabel = `${Math.round(step.magnitude * 100)}%`;
    }

    // Show rank number + arrow + magnitude (e.g., "1 ▲ 2x")
    ctx.font = 'bold 11px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = labelColor;
    ctx.fillText(`${step.rank} ${arrow} ${magnitudeLabel}`, centerX, arrowY);
  }

  // Draw blue selection band if there's a pending selection
  const pendingSelection = getPendingSelection();
  if (pendingSelection) {
    const { startTime: selStart, endTime: selEnd } = pendingSelection;
    const dataStart = parseUTC(data[0].t);
    const dataEnd = parseUTC(data[data.length - 1].t);
    const timeRange = dataEnd - dataStart;

    if (timeRange > 0) {
      // Convert selection times to x coordinates
      const selStartX = padding.left + ((selStart - dataStart) / timeRange) * chartWidth;
      const selEndX = padding.left + ((selEnd - dataStart) / timeRange) * chartWidth;

      // Clamp to chart bounds
      const bandLeft = Math.max(padding.left, Math.min(selStartX, selEndX));
      const bandRight = Math.min(width - padding.right, Math.max(selStartX, selEndX));

      // Blue selection colors
      const selectionFill = 'rgba(59, 130, 246, 0.15)';
      const selectionStroke = 'rgba(59, 130, 246, 0.8)';

      // Draw filled rectangle for selection
      ctx.fillStyle = selectionFill;
      ctx.fillRect(bandLeft, padding.top, bandRight - bandLeft, chartHeight);

      // Draw dashed vertical lines at edges
      ctx.strokeStyle = selectionStroke;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);

      ctx.beginPath();
      ctx.moveTo(bandLeft, padding.top);
      ctx.lineTo(bandLeft, height - padding.bottom);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(bandRight, padding.top);
      ctx.lineTo(bandRight, height - padding.bottom);
      ctx.stroke();

      ctx.setLineDash([]);
    }
  }

  // Fetch and render release ships asynchronously
  const startTime = parseUTC(data[0].t);
  const endTime = parseUTC(data[data.length - 1].t);
  getReleasesInRange(startTime, endTime).then((releases) => {
    if (releases.length > 0) {
      const chartDimensions = {
        width, height, padding, chartWidth,
      };
      setShipPositions(renderReleaseShips(ctx, releases, data, chartDimensions));
    } else {
      setShipPositions(null);
    }
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to render releases:', err);
    setShipPositions(null);
  });
}

export function setupChartNavigation(callback) {
  setNavigationCallback(callback);
  const canvas = document.getElementById('chart');
  const container = canvas.parentElement;

  // Create navigation overlay element
  navOverlay = document.createElement('div');
  navOverlay.className = 'chart-nav-overlay';
  navOverlay.innerHTML = `
    <div class="chart-nav-zone chart-nav-left"><span class="chart-nav-arrow">\u25C0</span></div>
    <div class="chart-nav-zone chart-nav-right"><span class="chart-nav-arrow">\u25B6</span></div>
  `;
  container.appendChild(navOverlay);

  // Create scrubber elements
  scrubberLine = document.createElement('div');
  scrubberLine.className = 'chart-scrubber-line';
  container.appendChild(scrubberLine);

  scrubberStatusBar = document.createElement('div');
  scrubberStatusBar.className = 'chart-scrubber-status';
  container.appendChild(scrubberStatusBar);

  // Create drag selection overlay
  selectionOverlay = document.createElement('div');
  selectionOverlay.className = 'chart-selection-overlay';
  container.appendChild(selectionOverlay);

  // Drag selection helper functions
  function updateSelectionOverlay(startX, endX) {
    const chartLayout = getChartLayout();
    if (!chartLayout) return;
    const { padding, height } = chartLayout;
    const left = Math.min(startX, endX);
    const width = Math.abs(endX - startX);

    selectionOverlay.style.left = `${left}px`;
    selectionOverlay.style.top = `${padding.top}px`;
    selectionOverlay.style.width = `${width}px`;
    selectionOverlay.style.height = `${height - padding.top - padding.bottom}px`;
    selectionOverlay.classList.add('visible');
  }

  function hideSelectionOverlay() {
    selectionOverlay.classList.remove('visible');
    selectionOverlay.classList.remove('confirmed');
    setPendingSelection(null);
    // Clear blue highlights when selection is cleared
    clearSelectionHighlights();
    // Redraw chart to remove blue band
    const lastData = getLastChartData();
    if (lastData) {
      requestAnimationFrame(() => {
        renderChart(lastData);
      });
    }
  }

  // Click on selection overlay to navigate to the selected time range
  selectionOverlay.addEventListener('click', () => {
    const pendingSelection = getPendingSelection();
    if (pendingSelection) {
      const { startTime, endTime } = pendingSelection;
      hideSelectionOverlay();
      setCustomTimeRange(startTime, endTime);
      saveStateToURL();
      const onNavigate = getNavigationCallback();
      if (onNavigate) onNavigate();
    }
  });

  // Touch swipe support
  let touchStartX = null;
  const minSwipeDistance = 50;

  container.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });

  container.addEventListener('touchend', (e) => {
    if (touchStartX === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const deltaX = touchEndX - touchStartX;
    touchStartX = null;

    if (Math.abs(deltaX) >= minSwipeDistance) {
      // Swipe right = go back in time, swipe left = go forward
      navigateTime(deltaX > 0 ? -2 / 3 : 2 / 3);
    }
  }, { passive: true });

  // Double-tap to toggle logs
  let lastTap = 0;
  container.addEventListener('touchend', (_) => {
    const now = Date.now();
    const timeSinceLastTap = now - lastTap;
    if (timeSinceLastTap < 300 && timeSinceLastTap > 0) {
      // Double tap detected
      if (typeof window.toggleLogsViewMobile === 'function') {
        window.toggleLogsViewMobile();
      }
      lastTap = 0;
    } else {
      lastTap = now;
    }
  }, { passive: true });

  // Update scrubber position and content
  function updateScrubber(x, _) {
    const chartLayout = getChartLayout();
    if (!chartLayout) return;

    const { padding, width, height } = chartLayout;

    // Position the scrubber line
    scrubberLine.style.left = `${x}px`;
    scrubberLine.style.top = `${padding.top}px`;
    scrubberLine.style.height = `${height - padding.top - padding.bottom}px`;

    // Get time at position
    const time = getTimeAtX(x);
    if (!time) {
      scrubberStatusBar.innerHTML = '';
      return;
    }

    // Build status bar content in two rows
    const { timeStr, relativeStr } = formatScrubberTime(time);

    // Row 1: Time
    let row1 = `<span class="scrubber-time">${timeStr} UTC</span>`;
    if (relativeStr) {
      row1 += `<span class="scrubber-relative">${relativeStr}</span>`;
    }

    // Row 2: Anomaly and/or release info
    const row2Parts = [];

    // Check for anomaly
    const anomaly = getAnomalyAtX(x);
    if (anomaly) {
      const detectedSteps = getDetectedSteps();
      const step = detectedSteps.find((s) => s.rank === anomaly.rank);
      const duration = formatDuration(anomaly.startTime, anomaly.endTime);
      const typeLabel = step?.type === 'spike' ? 'Spike' : 'Dip';
      let categoryLabel = '2xx';
      if (step?.category === 'red') categoryLabel = '5xx';
      else if (step?.category === 'yellow') categoryLabel = '4xx';
      let magnitudeLabel;
      if (step?.magnitude >= 1) {
        magnitudeLabel = step.magnitude >= 10
          ? `${Math.round(step.magnitude)}x`
          : `${step.magnitude.toFixed(1).replace(/\.0$/, '')}x`;
      } else {
        magnitudeLabel = `${Math.round((step?.magnitude || 0) * 100)}%`;
      }
      row2Parts.push(`<span class="scrubber-anomaly scrubber-anomaly-${step?.category || 'red'}">${typeLabel} #${anomaly.rank}: ${categoryLabel} ${magnitudeLabel} over ${duration}</span>`);
    }

    // Check for ship (with padding)
    const ship = getShipNearX(x);
    if (ship) {
      const { release } = ship;
      const isConfigChange = release.repo === 'aem-certificate-rotation';

      if (isConfigChange) {
        // Config change - show with config styling
        row2Parts.push(`<span class="scrubber-release scrubber-release-config">Config: ${release.repo}</span>`);
      } else {
        // Determine release type from semver:
        // x.0.0 = breaking (red), x.y.0 = feature (yellow), else patch
        const versionMatch = release.tag.match(/v?(\d+)\.(\d+)\.(\d+)/);
        let releaseType = 'patch';
        if (versionMatch) {
          const [, , minor, patch] = versionMatch;
          if (minor === '0' && patch === '0') {
            releaseType = 'breaking';
          } else if (patch === '0') {
            releaseType = 'feature';
          }
        }
        row2Parts.push(`<span class="scrubber-release scrubber-release-${releaseType}">Release: ${release.repo} ${release.tag}</span>`);
      }
    }

    // Build final content
    let content = `<div class="chart-scrubber-status-row">${row1}</div>`;
    if (row2Parts.length > 0) {
      content += `<div class="chart-scrubber-status-row">${row2Parts.join('')}</div>`;
    }

    // Wrap content in inner container for positioning
    scrubberStatusBar.innerHTML = `<div class="chart-scrubber-status-inner">${content}</div>`;

    // Position the inner element to follow scrubber with edge easing
    const inner = scrubberStatusBar.querySelector('.chart-scrubber-status-inner');
    if (inner) {
      const statusWidth = scrubberStatusBar.offsetWidth;
      const innerWidth = inner.offsetWidth;
      const statusPadding = 24; // Match CSS padding

      // Calculate target position (centered on scrubber)
      const targetLeft = x - innerWidth / 2;

      // Apply easing at edges
      const minLeft = statusPadding;
      const maxLeft = statusWidth - innerWidth - statusPadding;

      // Ease function: smoothly transition from edge-clamped to centered
      const edgeZone = innerWidth / 2 + statusPadding;
      let finalLeft;

      if (x < edgeZone) {
        // Left edge: ease from minLeft to centered
        const t = x / edgeZone;
        finalLeft = minLeft + (targetLeft - minLeft) * t;
      } else if (x > width - edgeZone) {
        // Right edge: ease from centered to maxLeft
        const t = (width - x) / edgeZone;
        finalLeft = maxLeft + (targetLeft - maxLeft) * t;
      } else {
        // Middle: centered on scrubber
        finalLeft = targetLeft;
      }

      // Clamp to valid range
      finalLeft = Math.max(minLeft, Math.min(maxLeft, finalLeft));
      inner.style.marginLeft = `${finalLeft - statusPadding}px`;
    }
  }

  // Show/hide scrubber on container hover
  container.addEventListener('mouseenter', () => {
    scrubberLine.classList.add('visible');
    scrubberStatusBar.classList.add('visible');
  });

  container.addEventListener('mouseleave', () => {
    scrubberLine.classList.remove('visible');
    scrubberStatusBar.classList.remove('visible');
    hideReleaseTooltip();
    canvas.style.cursor = '';
  });

  container.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    updateScrubber(x, y);

    // Ship tooltip on hover (handled here since nav overlay captures canvas events)
    const ship = getShipAtPoint(getShipPositions(), x, y);
    if (ship) {
      showReleaseTooltip(ship.release, e.clientX, e.clientY);
      canvas.style.cursor = 'pointer';
    } else {
      hideReleaseTooltip();
      // Restore cursor based on anomaly hover state
      const anomaly = getAnomalyAtX(x);
      canvas.style.cursor = anomaly ? 'pointer' : '';
    }
  });

  // Drag selection for time range zoom
  const minDragDistance = 20; // Minimum pixels to count as a drag (not a click)

  // Start drag tracking from a mouse event (works for canvas and nav zones)
  function startDragTracking(e) {
    // Only handle left mouse button
    if (e.button !== 0) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;

    // Check if clicking on an anomaly - don't start drag
    const anomaly = getAnomalyAtX(x);
    if (anomaly) {
      // Let click handler deal with it
      return;
    }

    // Clear any existing pending selection when starting a new drag
    if (getPendingSelection()) {
      hideSelectionOverlay();
    }

    // Start drag tracking
    isDragging = false;
    dragStartX = x;

    // Hide scrubber during potential drag
    e.preventDefault();
  }

  // Mousedown on canvas or nav zones starts drag tracking
  canvas.addEventListener('mousedown', startDragTracking);
  navOverlay.querySelectorAll('.chart-nav-zone').forEach((zone) => {
    zone.addEventListener('mousedown', startDragTracking);
  });

  // Use container-level mousemove so drag works even when over nav zones
  container.addEventListener('mousemove', (e) => {
    if (dragStartX === null) return;

    const chartLayout = getChartLayout();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const distance = Math.abs(x - dragStartX);

    if (distance >= minDragDistance) {
      isDragging = true;
      container.classList.add('dragging');
      // Clamp x to chart bounds
      const clampedX = Math.max(
        chartLayout?.padding?.left || 0,
        Math.min(x, (chartLayout?.width || rect.width) - (chartLayout?.padding?.right || 0)),
      );
      updateSelectionOverlay(dragStartX, clampedX);

      // Hide scrubber while dragging
      scrubberLine.classList.remove('visible');
      scrubberStatusBar.classList.remove('visible');
    }
  });

  // Use container-level mouseup so drag completes even when over nav zones
  container.addEventListener('mouseup', (e) => {
    const wasDragging = isDragging;
    const startX = dragStartX;

    // Reset drag state
    isDragging = false;
    dragStartX = null;
    container.classList.remove('dragging');

    if (!wasDragging) {
      // It was a click, not a drag - check for anomaly or clear selection
      if (getPendingSelection()) {
        // Don't clear if clicking on the selection overlay itself
        const isOverlayClick = e.target === selectionOverlay
          || selectionOverlay.contains(e.target);
        if (isOverlayClick) {
          return;
        }
        // Clicking outside selection clears it
        hideSelectionOverlay();
        return;
      }
      const anomalyBounds = getAnomalyAtX(e.clientX - canvas.getBoundingClientRect().left);
      if (anomalyBounds) {
        zoomToAnomalyByRank(anomalyBounds.rank);
      }
      return;
    }

    // It was a drag - store pending selection but don't navigate yet
    const rect = canvas.getBoundingClientRect();
    const endX = e.clientX - rect.left;

    const startTime = getTimeAtX(Math.min(startX, endX));
    const endTime = getTimeAtX(Math.max(startX, endX));

    if (startTime && endTime && startTime < endTime) {
      setPendingSelection({ startTime, endTime });
      selectionOverlay.classList.add('confirmed');
      // Keep overlay visible - don't hide it
      // Set flag to prevent click handlers from firing
      justCompletedDrag = true;
      requestAnimationFrame(() => {
        justCompletedDrag = false;
      });

      // Redraw chart to show blue selection band
      const lastData = getLastChartData();
      if (lastData) {
        requestAnimationFrame(() => {
          renderChart(lastData);
        });
      }

      // Trigger investigation for the selected time range
      const chartData = getLastChartData();
      if (chartData && chartData.length >= 2) {
        const fullStart = parseUTC(chartData[0].t);
        const fullEnd = parseUTC(chartData[chartData.length - 1].t);
        investigateTimeRange(startTime, endTime, fullStart, fullEnd);
      }
    } else {
      hideSelectionOverlay();
    }
  });

  // Cancel drag if mouse leaves container
  container.addEventListener('mouseleave', () => {
    if (isDragging || dragStartX !== null) {
      isDragging = false;
      dragStartX = null;
      container.classList.remove('dragging');
      hideSelectionOverlay();
    }
  });

  // Nav zone click handlers - check for anomaly first, ignore if just completed a drag
  navOverlay.querySelector('.chart-nav-left').addEventListener('click', (e) => {
    if (justCompletedDrag) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const anomaly = getAnomalyAtX(x);
    if (anomaly) {
      zoomToAnomalyByRank(anomaly.rank);
    } else {
      navigateTime(-2 / 3);
    }
  });

  navOverlay.querySelector('.chart-nav-right').addEventListener('click', (e) => {
    if (justCompletedDrag) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const anomaly = getAnomalyAtX(x);
    if (anomaly) {
      zoomToAnomalyByRank(anomaly.rank);
    } else {
      navigateTime(2 / 3);
    }
  });

  // Hide nav zone hover when over an anomaly or ship
  navOverlay.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const anomaly = getAnomalyAtX(x);
    const ship = getShipAtPoint(getShipPositions(), x, y);
    navOverlay.classList.toggle('over-anomaly', !!anomaly);
    navOverlay.classList.toggle('over-ship', !!ship);
  });

  navOverlay.addEventListener('mouseleave', () => {
    navOverlay.classList.remove('over-anomaly');
    navOverlay.classList.remove('over-ship');
  });
}

export async function loadTimeSeries() {
  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const facetFilters = getFacetFilters();
  const bucket = getTimeBucket();

  const sql = `
    SELECT
      ${bucket} as t,
      countIf(\`response.status\` < 400) as cnt_ok,
      countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx,
      countIf(\`response.status\` >= 500) as cnt_5xx
    FROM ${DATABASE}.${getTable()}
    WHERE ${timeFilter} ${hostFilter} ${facetFilters}
    GROUP BY t
    ORDER BY t
  `;

  try {
    const result = await query(sql);
    state.chartData = result.data;
    renderChart(result.data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Chart error:', err);
  }
}
