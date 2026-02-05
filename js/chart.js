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

import { query, isAbortError } from './api.js';
import { getFacetFilters, getCurrentSamplingInfo, getSamplingPlan } from './breakdowns/index.js';
import { DATABASE } from './config.js';
import { formatNumber } from './format.js';
import { getRequestContext, isRequestCurrent } from './request-context.js';
import { state } from './state.js';
import { detectSteps } from './step-detection.js';
import {
  getHostFilter,
  getSampledTable,
  getTimeBucket,
  getTimeBucketStep,
  getTimeFilter,
  normalizeSampleRate,
  setCustomTimeRange,
  getTimeRangeBounds,
  getTimeRangeStart,
  getTimeRangeEnd,
} from './time.js';
import { loadSql } from './sql-loader.js';
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
  getXAtTime,
  formatScrubberTime,
  formatDuration,
  zoomToAnomalyByRank,
  getShipNearX,
  hexToRgba,
  parseUTC,
} from './chart-state.js';

function getSamplingConfig(sampleRate) {
  const rate = normalizeSampleRate(sampleRate);
  const multiplier = rate < 1 ? Math.round(1 / rate) : 1;
  return {
    table: getSampledTable(rate),
    mult: multiplier > 1 ? ` * ${multiplier}` : '',
  };
}

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

/**
 * Initialize canvas for chart rendering
 */
function initChartCanvas() {
  const canvas = document.getElementById('chart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  return { canvas, ctx, rect };
}

/**
 * Draw Y axis with grid lines and labels
 */
function drawYAxis(ctx, chartDimensions, cssVar, minValue, maxValue) {
  const {
    width, height, padding, chartHeight, labelInset,
  } = chartDimensions;
  ctx.fillStyle = cssVar('--text-secondary');
  ctx.font = '11px -apple-system, sans-serif';
  ctx.textAlign = 'left';

  for (let i = 1; i <= 4; i += 1) {
    const val = minValue + (maxValue - minValue) * (i / 4);
    const y = height - padding.bottom - ((chartHeight * i) / 4);

    ctx.strokeStyle = cssVar('--grid-line');
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();

    ctx.fillStyle = cssVar('--text-secondary');
    ctx.fillText(formatNumber(val), padding.left + labelInset, y - 4);
  }
}

/**
 * Draw X axis labels
 */
function drawXAxisLabels(ctx, data, chartDimensions, intendedStartTime, intendedTimeRange, cssVar) {
  const {
    width, height, padding, chartWidth, labelInset,
  } = chartDimensions;
  ctx.fillStyle = cssVar('--text-secondary');
  const isMobile = width < 500;
  const tickIndices = isMobile
    ? [0, Math.floor((data.length - 1) / 2), data.length - 1]
    : Array.from({ length: 6 }, (_, idx) => Math.round((idx * (data.length - 1)) / 5));

  const validIndices = tickIndices.filter((i) => i < data.length);
  for (const i of validIndices) {
    const time = parseUTC(data[i].t);
    const elapsed = time.getTime() - intendedStartTime;
    const x = padding.left + (elapsed / intendedTimeRange) * chartWidth;
    const label = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    const yPos = height - padding.bottom + 20;

    if (i === 0) {
      ctx.textAlign = 'left';
      ctx.fillText(label, padding.left + labelInset, yPos);
    } else if (i === data.length - 1) {
      ctx.textAlign = 'right';
      ctx.fillText(`${label} (UTC)`, width - padding.right - labelInset, yPos);
    } else {
      ctx.textAlign = 'center';
      ctx.fillText(label, x, yPos);
    }
  }
}

/**
 * Draw anomaly highlight for a detected step
 */
function drawAnomalyHighlight(ctx, step, data, chartDimensions, getX, getY, stacks) {
  const { height, padding, chartWidth } = chartDimensions;
  const { stackedServer, stackedClient, stackedOk } = stacks;

  const startX = getX(step.startIndex);
  const endX = getX(step.endIndex);
  const minBandWidth = Math.max((chartWidth / data.length) * 2, 16);
  const bandPadding = minBandWidth / 2;
  const bandLeft = startX - bandPadding;
  const bandRight = step.startIndex === step.endIndex ? startX + bandPadding : endX + bandPadding;

  const startTime = parseUTC(data[step.startIndex].t);
  const endTime = parseUTC(data[step.endIndex].t);
  addAnomalyBounds({
    left: bandLeft, right: bandRight, startTime, endTime, rank: step.rank,
  });

  const opacityMultiplier = step.rank === 1 ? 1 : 0.7;
  const categoryColors = { red: [240, 68, 56], yellow: [247, 144, 9], green: [18, 183, 106] };
  const [cr, cg, cb] = categoryColors[step.category] || categoryColors.green;

  const seriesBounds = {
    red: [(i) => getY(stackedServer[i]), () => getY(0)],
    yellow: [(i) => getY(stackedClient[i]), (i) => getY(stackedServer[i])],
    green: [(i) => getY(stackedOk[i]), (i) => getY(stackedClient[i])],
  };
  const [getSeriesTop, getSeriesBottom] = seriesBounds[step.category] || seriesBounds.green;

  const points = [];
  for (let i = step.startIndex; i <= step.endIndex; i += 1) {
    points.push({ x: getX(i), y: getSeriesTop(i) });
  }
  for (let i = step.endIndex; i >= step.startIndex; i -= 1) {
    points.push({ x: getX(i), y: getSeriesBottom(i) });
  }

  ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${0.35 * opacityMultiplier})`;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, 0.8)`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  [bandLeft, bandRight].forEach((bx) => {
    ctx.beginPath();
    ctx.moveTo(bx, padding.top);
    ctx.lineTo(bx, height - padding.bottom);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  const mag = step.magnitude;
  const magnitudeLabel = mag >= 1
    ? `${mag >= 10 ? Math.round(mag) : mag.toFixed(1).replace(/\.0$/, '')}x`
    : `${Math.round(mag * 100)}%`;
  ctx.font = 'bold 11px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = `rgb(${cr}, ${cg}, ${cb})`;
  const arrow = step.type === 'spike' ? '\u25B2' : '\u25BC';
  ctx.fillText(`${step.rank} ${arrow} ${magnitudeLabel}`, (bandLeft + bandRight) / 2, padding.top + 12);
}

/**
 * Draw a stacked area with line on top
 * @param {number[]} [lineDash] - Optional dash array for stroke
 * (e.g. [6, 4] dashed, [2, 2] dotted). Omit or [] for solid.
*/
function drawStackedArea(ctx, data, getX, getY, topStack, bottomStack, colors, lineDash = []) {
  if (!topStack.some((v, i) => v > bottomStack[i])) return;

  ctx.beginPath();
  ctx.moveTo(getX(0), getY(bottomStack[0]));
  for (let i = 0; i < data.length; i += 1) ctx.lineTo(getX(i), getY(topStack[i]));
  for (let i = data.length - 1; i >= 0; i -= 1) ctx.lineTo(getX(i), getY(bottomStack[i]));
  ctx.closePath();
  ctx.fillStyle = colors.fill;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(getX(0), getY(topStack[0]));
  for (let i = 1; i < data.length; i += 1) ctx.lineTo(getX(i), getY(topStack[i]));
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 2;
  ctx.setLineDash(lineDash);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function renderChart(data) {
  setLastChartData(data);
  resetAnomalyBounds();
  setShipPositions(null);
  hideReleaseTooltip();

  const { ctx, rect } = initChartCanvas();
  const { width } = rect;
  const { height } = rect;
  const padding = {
    top: 20, right: 0, bottom: 40, left: 0,
  };
  const labelInset = 24;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const timeRangeBounds = getTimeRangeBounds();

  ctx.clearRect(0, 0, width, height);
  const styles = getComputedStyle(document.documentElement);
  const cssVar = (name) => styles.getPropertyValue(name).trim();

  if (data.length === 0) {
    setChartLayout({
      width,
      height,
      padding,
      chartWidth,
      chartHeight,
      intendedStartTime: timeRangeBounds.start.getTime(),
      intendedEndTime: timeRangeBounds.end.getTime(),
    });
    ctx.fillStyle = cssVar('--text-secondary');
    ctx.textAlign = 'center';
    ctx.fillText('No data', width / 2, height / 2);
    return;
  }

  let intendedStartTime = timeRangeBounds.start.getTime();
  let intendedEndTime = timeRangeBounds.end.getTime();
  let intendedTimeRange = intendedEndTime - intendedStartTime;

  if (!Number.isFinite(intendedTimeRange) || intendedTimeRange <= 0) {
    intendedStartTime = parseUTC(data[0].t).getTime();
    intendedEndTime = parseUTC(data[data.length - 1].t).getTime();
    intendedTimeRange = Math.max(1, intendedEndTime - intendedStartTime);
  }

  const chartDimensions = {
    width, height, padding, chartWidth, chartHeight, labelInset,
  };
  setChartLayout({ ...chartDimensions, intendedStartTime, intendedEndTime });

  const series = {
    ok: data.map((d) => parseInt(d.cnt_ok, 10) || 0),
    client: data.map((d) => parseInt(d.cnt_4xx, 10) || 0),
    server: data.map((d) => parseInt(d.cnt_5xx, 10) || 0),
  };

  const totals = data.map((_, i) => series.ok[i] + series.client[i] + series.server[i]);
  const maxValue = Math.max(4, Math.ceil(Math.ceil(Math.max(...totals)) / 4) * 4);

  const okColor = cssVar('--status-ok');
  const clientColor = cssVar('--status-client-error');
  const serverColor = cssVar('--status-server-error');
  const colors = {
    ok: { line: okColor, fill: hexToRgba(okColor, 0.3) },
    client: { line: clientColor, fill: hexToRgba(clientColor, 0.3) },
    server: { line: serverColor, fill: hexToRgba(serverColor, 0.3) },
  };

  // Draw X axis line
  ctx.strokeStyle = cssVar('--axis-line');
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, height - padding.bottom);
  ctx.lineTo(width - padding.right, height - padding.bottom);
  ctx.stroke();

  drawYAxis(ctx, chartDimensions, cssVar, 0, maxValue);
  drawXAxisLabels(ctx, data, chartDimensions, intendedStartTime, intendedTimeRange, cssVar);

  const getY = (value) => height - padding.bottom - ((chartHeight * value) / (maxValue || 1));
  const getX = (idx) => {
    const time = parseUTC(data[idx].t);
    return padding.left + ((time.getTime() - intendedStartTime) / intendedTimeRange) * chartWidth;
  };

  const stackedServer = series.server.slice();
  const stackedClient = series.server.map((v, i) => v + series.client[i]);
  const stackedOk = series.server.map((v, i) => v + series.client[i] + series.ok[i]);
  const zeros = new Array(data.length).fill(0);

  // Line style based on sampling: solid (no sampling), dashed (10%), dotted (1%)
  const samplingInfo = getCurrentSamplingInfo();
  let lineDash = [];
  if (samplingInfo.isActive) {
    lineDash = samplingInfo.rate === '1%' ? [2, 2] : [6, 4];
  }

  drawStackedArea(ctx, data, getX, getY, stackedOk, stackedClient, colors.ok, lineDash);
  drawStackedArea(ctx, data, getX, getY, stackedClient, stackedServer, colors.client, lineDash);
  drawStackedArea(ctx, data, getX, getY, stackedServer, zeros, colors.server, lineDash);

  // Detect anomalies (skip for ranges < 5 minutes)
  const lastIdx = data.length - 1;
  const timeRangeMs = data.length >= 2 ? parseUTC(data[lastIdx].t) - parseUTC(data[0].t) : 0;
  const cutoffTime = Date.now() - 3 * 60 * 1000;
  let endMargin = 0;
  for (let i = lastIdx; i >= 0 && parseUTC(data[i].t).getTime() >= cutoffTime; i -= 1) {
    endMargin += 1;
  }
  const steps = timeRangeMs >= 5 * 60 * 1000 ? detectSteps(series, 5, { endMargin }) : [];

  setDetectedSteps(steps.map((s) => ({
    ...s,
    startTime: data[s.startIndex]?.t ? parseUTC(data[s.startIndex].t) : null,
    endTime: data[s.endIndex]?.t ? parseUTC(data[s.endIndex].t) : null,
  })));

  const stacks = { stackedServer, stackedClient, stackedOk };
  for (const step of steps) {
    drawAnomalyHighlight(ctx, step, data, chartDimensions, getX, getY, stacks);
  }

  // Draw blue selection band if there's a pending selection
  const pendingSelection = getPendingSelection();
  if (pendingSelection) {
    const { startTime: selStart, endTime: selEnd } = pendingSelection;

    if (intendedTimeRange > 0) {
      // Convert selection times to x coordinates using intended time range
      const selStartOff = (selStart - intendedStartTime) / intendedTimeRange;
      const selStartX = padding.left + selStartOff * chartWidth;
      const selEndOff = (selEnd - intendedStartTime) / intendedTimeRange;
      const selEndX = padding.left + selEndOff * chartWidth;

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
  const intendedStartDate = new Date(intendedStartTime);
  const intendedEndDate = new Date(intendedEndTime);
  getReleasesInRange(intendedStartDate, intendedEndDate).then((releases) => {
    if (releases.length > 0) {
      const dims = {
        width, height, padding, chartWidth,
      };
      const timeRange = { start: intendedStartTime, end: intendedEndTime };
      setShipPositions(renderReleaseShips(ctx, releases, data, dims, timeRange));
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

  /**
   * Build anomaly info HTML for scrubber
   */
  function buildAnomalyInfo(x) {
    const anomaly = getAnomalyAtX(x);
    if (!anomaly) return null;

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
    const cat = step?.category || 'red';
    return `<span class="scrubber-anomaly scrubber-anomaly-${cat}">${typeLabel} #${anomaly.rank}: ${categoryLabel} ${magnitudeLabel} over ${duration}</span>`;
  }

  /**
   * Build release info HTML for scrubber
   */
  function buildReleaseInfo(x) {
    const ship = getShipNearX(x);
    if (!ship) return null;

    const { release } = ship;
    if (release.repo === 'aem-certificate-rotation') {
      return `<span class="scrubber-release scrubber-release-config">Config: ${release.repo}</span>`;
    }

    const versionMatch = release.tag.match(/v?(\d+)\.(\d+)\.(\d+)/);
    let releaseType = 'patch';
    if (versionMatch) {
      const [, , minor, patch] = versionMatch;
      if (minor === '0' && patch === '0') releaseType = 'breaking';
      else if (patch === '0') releaseType = 'feature';
    }
    return `<span class="scrubber-release scrubber-release-${releaseType}">Release: ${release.repo} ${release.tag}</span>`;
  }

  /**
   * Position scrubber status bar inner element with edge easing
   */
  function positionScrubberInner(inner, x, scrubWidth) {
    const innerWidth = inner.offsetWidth;
    const statusPadding = 24;
    const targetLeft = x - innerWidth / 2;
    const minLeft = statusPadding;
    const maxLeft = scrubWidth - innerWidth - statusPadding;
    const edgeZone = innerWidth / 2 + statusPadding;

    let finalLeft;
    if (x < edgeZone) {
      finalLeft = minLeft + (targetLeft - minLeft) * (x / edgeZone);
    } else if (x > scrubWidth - edgeZone) {
      finalLeft = maxLeft + (targetLeft - maxLeft) * ((scrubWidth - x) / edgeZone);
    } else {
      finalLeft = targetLeft;
    }

    const el = inner;
    el.style.marginLeft = `${Math.max(minLeft, Math.min(maxLeft, finalLeft)) - statusPadding}px`;
  }

  // Show selection time range in status bar, centered between selection edges
  function updateSelectionStatusBar(startTime, endTime) {
    const startFmt = formatScrubberTime(startTime);
    const endFmt = formatScrubberTime(endTime);
    const dur = formatDuration(startTime, endTime);
    const row = `<span class="scrubber-time">${startFmt.timeStr}</span>`
      + '<span class="scrubber-selection-arrow">\u2192</span>'
      + `<span class="scrubber-time">${endFmt.timeStr} UTC</span>`
      + `<span class="scrubber-selection-duration">${dur}</span>`;
    scrubberStatusBar.innerHTML = `<div class="chart-scrubber-status-inner"><div class="chart-scrubber-status-row">${row}</div></div>`;
    const inner = scrubberStatusBar.querySelector('.chart-scrubber-status-inner');
    const startX = getXAtTime(startTime);
    const endX = getXAtTime(endTime);
    if (inner && Number.isFinite(startX) && Number.isFinite(endX)) {
      const midX = (startX + endX) / 2;
      positionScrubberInner(inner, midX, scrubberStatusBar.offsetWidth);
    }
    scrubberStatusBar.classList.add('visible');
  }

  // Update scrubber position and content
  function updateScrubber(x, _) {
    const chartLayout = getChartLayout();
    if (!chartLayout) return;

    const { padding, height } = chartLayout;

    // Position the scrubber line
    scrubberLine.style.left = `${x}px`;
    scrubberLine.style.top = `${padding.top}px`;
    scrubberLine.style.height = `${height - padding.top - padding.bottom}px`;

    // If there's a confirmed selection, show selection times instead
    const pendingSel = getPendingSelection();
    if (pendingSel) {
      updateSelectionStatusBar(pendingSel.startTime, pendingSel.endTime);
      return;
    }

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
    const anomalyHtml = buildAnomalyInfo(x);
    if (anomalyHtml) row2Parts.push(anomalyHtml);
    const releaseHtml = buildReleaseInfo(x);
    if (releaseHtml) row2Parts.push(releaseHtml);

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
      positionScrubberInner(inner, x, scrubberStatusBar.offsetWidth);
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

      // Hide scrubber line but show selection times in status bar
      scrubberLine.classList.remove('visible');
      const selStartTime = getTimeAtX(Math.min(dragStartX, clampedX));
      const selEndTime = getTimeAtX(Math.max(dragStartX, clampedX));
      if (selStartTime && selEndTime) {
        updateSelectionStatusBar(selStartTime, selEndTime);
      }
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
      // Show final selection times in status bar
      updateSelectionStatusBar(startTime, endTime);
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

export async function loadTimeSeries(requestContext = getRequestContext('dashboard')) {
  const { requestId, signal, scope } = requestContext;
  const isCurrent = () => isRequestCurrent(requestId, scope);
  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const facetFilters = getFacetFilters();
  const bucket = getTimeBucket();
  const step = getTimeBucketStep();
  const rangeStart = getTimeRangeStart();
  const rangeEnd = getTimeRangeEnd();
  const samplingPlan = getSamplingPlan();

  for (const sampleRate of samplingPlan) {
    if (!isCurrent()) return;
    const { table, mult } = getSamplingConfig(sampleRate);
    // Progressive refinement requires sequential queries.
    // eslint-disable-next-line no-await-in-loop
    const sql = await loadSql('time-series', {
      bucket,
      database: DATABASE,
      table,
      timeFilter,
      hostFilter,
      facetFilters,
      additionalWhereClause: state.additionalWhereClause,
      rangeStart,
      rangeEnd,
      step,
      mult,
    });

    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await query(sql, { signal });
      if (!isCurrent()) return;
      state.chartData = result.data;
      renderChart(result.data);
    } catch (err) {
      if (!isCurrent() || isAbortError(err)) return;
      // eslint-disable-next-line no-console
      console.error('Chart error:', err);
      return;
    }
  }
}

window.addEventListener('sample-rate-change', () => {
  if (state.chartData) {
    renderChart(state.chartData);
  }
});
