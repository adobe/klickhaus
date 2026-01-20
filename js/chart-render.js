/**
 * Chart rendering module.
 * Handles all canvas drawing operations for the time series chart.
 *
 * @module chart-render
 */

import { formatNumber } from './format.js';
import { detectSteps } from './step-detection.js';
import { getReleasesInRange, renderReleaseShips } from './releases.js';

// Store last detected steps for external access
let lastDetectedSteps = [];

/**
 * Get the last detected anomaly steps
 * @returns {Array} Array of detected steps with metadata
 */
export function getLastDetectedSteps() {
  return lastDetectedSteps;
}

/**
 * Set detected steps (used during rendering)
 * @param {Array} steps - Detected steps to store
 */
export function setLastDetectedSteps(steps) {
  lastDetectedSteps = steps;
}

/**
 * Parse data into stacked values
 * @param {Array} data - Raw chart data
 * @returns {Object} Series object with ok, client, server arrays
 */
export function parseSeriesData(data) {
  return {
    ok: data.map(d => parseInt(d.cnt_ok) || 0),
    client: data.map(d => parseInt(d.cnt_4xx) || 0),
    server: data.map(d => parseInt(d.cnt_5xx) || 0)
  };
}

/**
 * Convert hex color to rgba
 * @param {string} hex - Hex color string
 * @param {number} alpha - Alpha value 0-1
 * @returns {string} RGBA color string
 */
export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Round a value to a "nice" number for axis labels
 * @param {number} val - Value to round
 * @returns {number} Nice rounded value
 */
function roundToNice(val) {
  if (val === 0) return 0;
  const magnitude = Math.pow(10, Math.floor(Math.log10(val)));
  const normalized = val / magnitude;
  let nice;
  if (normalized <= 1.5) nice = 1;
  else if (normalized <= 2.25) nice = 2;
  else if (normalized <= 3.5) nice = 2.5;
  else if (normalized <= 7.5) nice = 5;
  else nice = 10;
  return nice * magnitude;
}

/**
 * Draw the chart axes and grid lines
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} dimensions - Chart dimensions
 * @param {number} maxValue - Maximum Y value
 * @param {Array} data - Chart data for X labels
 * @param {Function} cssVar - Function to get CSS variable values
 */
export function drawAxes(ctx, dimensions, maxValue, data, cssVar) {
  const { width, height, padding, chartWidth, chartHeight, labelInset } = dimensions;
  const minValue = 0;

  // Draw X axis
  ctx.strokeStyle = cssVar('--axis-line');
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, height - padding.bottom);
  ctx.lineTo(width - padding.right, height - padding.bottom);
  ctx.stroke();

  // Y axis labels (inside chart, above grid lines, skip zero)
  ctx.fillStyle = cssVar('--text-secondary');
  ctx.font = '11px -apple-system, sans-serif';
  ctx.textAlign = 'left';

  for (let i = 1; i <= 4; i++) {
    const rawVal = minValue + (maxValue - minValue) * (i / 4);
    // Keep top value exact, round others to nice numbers
    const val = (i === 4) ? Math.round(rawVal) : roundToNice(rawVal);
    const y = height - padding.bottom - (chartHeight * i / 4);

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
    : Array.from({ length: 6 }, (_, i) => Math.round(i * (data.length - 1) / 5));

  for (const i of tickIndices) {
    if (i >= data.length) continue;
    let x = padding.left + (chartWidth * i / (data.length - 1));
    const time = new Date(data[i].t);
    let label = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
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

/**
 * Calculate stacked values for chart layers
 * @param {Object} series - Series data with ok, client, server arrays
 * @returns {Object} Stacked values for each layer
 */
export function calculateStackedValues(series) {
  const stackedServer = series.server.slice();
  const stackedClient = series.server.map((v, i) => v + series.client[i]);
  const stackedOk = series.server.map((v, i) => v + series.client[i] + series.ok[i]);
  return { stackedServer, stackedClient, stackedOk };
}

/**
 * Draw a stacked area layer
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Function} getX - Function to get X coordinate
 * @param {Function} getY - Function to get Y coordinate
 * @param {Array} topValues - Y values for top of area
 * @param {Array} bottomValues - Y values for bottom of area (or null for baseline)
 * @param {Object} colors - Color object with line and fill properties
 */
export function drawStackedArea(ctx, getX, getY, topValues, bottomValues, colors) {
  if (!topValues.some(v => v > 0)) return;

  const length = topValues.length;

  // Draw filled area
  ctx.beginPath();
  if (bottomValues) {
    ctx.moveTo(getX(0), getY(bottomValues[0]));
    for (let i = 0; i < length; i++) {
      ctx.lineTo(getX(i), getY(topValues[i]));
    }
    for (let i = length - 1; i >= 0; i--) {
      ctx.lineTo(getX(i), getY(bottomValues[i]));
    }
  } else {
    ctx.moveTo(getX(0), getY(0));
    for (let i = 0; i < length; i++) {
      ctx.lineTo(getX(i), getY(topValues[i]));
    }
    ctx.lineTo(getX(length - 1), getY(0));
  }
  ctx.closePath();
  ctx.fillStyle = colors.fill;
  ctx.fill();

  // Draw line on top
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(topValues[0]));
  for (let i = 1; i < length; i++) {
    ctx.lineTo(getX(i), getY(topValues[i]));
  }
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 2;
  ctx.stroke();
}

/**
 * Draw anomaly highlight region
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} step - Step detection result
 * @param {Object} dimensions - Chart dimensions
 * @param {Object} stacked - Stacked values
 * @param {Function} getX - Function to get X coordinate
 * @param {Function} getY - Function to get Y coordinate
 * @param {Array} data - Chart data
 * @returns {Object} Bounds information for click detection
 */
export function drawAnomalyHighlight(ctx, step, dimensions, stacked, getX, getY, data) {
  const { padding, height, chartWidth } = dimensions;
  const { stackedServer, stackedClient, stackedOk } = stacked;

  const startX = getX(step.startIndex);
  const endX = getX(step.endIndex);
  // Wider minimum band for better visibility
  const minBandWidth = Math.max(chartWidth / data.length * 2, 16);

  // Calculate band edges with padding on both sides
  const bandPadding = minBandWidth / 2;
  const bandLeft = startX - bandPadding;
  const bandRight = step.startIndex === step.endIndex
    ? startX + bandPadding
    : endX + bandPadding;

  // Calculate anomaly times
  const startTime = new Date(data[step.startIndex].t);
  const endTime = new Date(data[step.endIndex].t);

  // Color coding matches the traffic category
  const opacityMultiplier = step.rank === 1 ? 1 : 0.7;
  let highlightFill, highlightStroke, labelColor;

  if (step.category === 'red') {
    highlightFill = `rgba(240, 68, 56, ${0.35 * opacityMultiplier})`;
    highlightStroke = 'rgba(240, 68, 56, 0.8)';
    labelColor = 'rgb(240, 68, 56)';
  } else if (step.category === 'yellow') {
    highlightFill = `rgba(247, 144, 9, ${0.35 * opacityMultiplier})`;
    highlightStroke = 'rgba(247, 144, 9, 0.8)';
    labelColor = 'rgb(247, 144, 9)';
  } else {
    highlightFill = `rgba(18, 183, 106, ${0.35 * opacityMultiplier})`;
    highlightStroke = 'rgba(18, 183, 106, 0.8)';
    labelColor = 'rgb(18, 183, 106)';
  }

  // Get the top and bottom curves for this category
  let getSeriesTop, getSeriesBottom;
  if (step.category === 'red') {
    getSeriesTop = (i) => getY(stackedServer[i]);
    getSeriesBottom = () => getY(0);
  } else if (step.category === 'yellow') {
    getSeriesTop = (i) => getY(stackedClient[i]);
    getSeriesBottom = (i) => getY(stackedServer[i]);
  } else {
    getSeriesTop = (i) => getY(stackedOk[i]);
    getSeriesBottom = (i) => getY(stackedClient[i]);
  }

  // Build polygon points
  const points = [];
  for (let i = step.startIndex; i <= step.endIndex; i++) {
    points.push({ x: getX(i), y: getSeriesTop(i) });
  }
  for (let i = step.endIndex; i >= step.startIndex; i--) {
    points.push({ x: getX(i), y: getSeriesBottom(i) });
  }

  // Draw filled polygon
  ctx.fillStyle = highlightFill;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  ctx.fill();

  // Draw dashed vertical lines at band edges
  ctx.strokeStyle = highlightStroke;
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

  // Draw indicator label
  const centerX = (bandLeft + bandRight) / 2;
  const arrowY = padding.top + 12;
  const arrow = step.type === 'spike' ? '\u25B2' : '\u25BC';

  let magnitudeLabel;
  if (step.magnitude >= 1) {
    const multiplier = step.magnitude;
    magnitudeLabel = multiplier >= 10
      ? `${Math.round(multiplier)}x`
      : `${multiplier.toFixed(1).replace(/\.0$/, '')}x`;
  } else {
    magnitudeLabel = `${Math.round(step.magnitude * 100)}%`;
  }

  ctx.font = 'bold 11px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = labelColor;
  ctx.fillText(`${step.rank} ${arrow} ${magnitudeLabel}`, centerX, arrowY);

  return {
    left: bandLeft,
    right: bandRight,
    startTime,
    endTime,
    rank: step.rank
  };
}

/**
 * Draw blue selection band
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} selection - Selection with startTime and endTime
 * @param {Object} dimensions - Chart dimensions
 * @param {Array} data - Chart data
 */
export function drawSelectionBand(ctx, selection, dimensions, data) {
  const { width, height, padding, chartWidth, chartHeight } = dimensions;
  const { startTime: selStart, endTime: selEnd } = selection;
  const dataStart = new Date(data[0].t);
  const dataEnd = new Date(data[data.length - 1].t);
  const timeRange = dataEnd - dataStart;

  if (timeRange <= 0) return;

  // Convert selection times to x coordinates
  const selStartX = padding.left + ((selStart - dataStart) / timeRange) * chartWidth;
  const selEndX = padding.left + ((selEnd - dataStart) / timeRange) * chartWidth;

  // Clamp to chart bounds
  const bandLeft = Math.max(padding.left, Math.min(selStartX, selEndX));
  const bandRight = Math.min(width - padding.right, Math.max(selStartX, selEndX));

  // Blue selection colors
  const selectionFill = 'rgba(59, 130, 246, 0.15)';
  const selectionStroke = 'rgba(59, 130, 246, 0.8)';

  // Draw filled rectangle
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

/**
 * Main chart render function
 * @param {Array} data - Chart data
 * @param {Object} options - Render options
 * @returns {Object} Render result with bounds and layout info
 */
export function renderChartCanvas(data, options = {}) {
  const {
    canvas,
    pendingSelection = null,
    onShipPositionsReady = null
  } = options;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  // Set canvas size
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  const padding = { top: 20, right: 0, bottom: 40, left: 0 };
  const labelInset = 24;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const dimensions = { width, height, padding, chartWidth, chartHeight, labelInset };

  // Clear canvas
  ctx.clearRect(0, 0, width, height);

  // Get CSS variables for theming
  const styles = getComputedStyle(document.documentElement);
  const cssVar = (name) => styles.getPropertyValue(name).trim();

  // Handle empty data
  if (data.length === 0) {
    ctx.fillStyle = cssVar('--text-secondary');
    ctx.textAlign = 'center';
    ctx.fillText('No data', width / 2, height / 2);
    return { layout: dimensions, anomalyBounds: [], detectedSteps: [] };
  }

  // Parse series data
  const series = parseSeriesData(data);

  // Calculate max value
  const totals = data.map((_, i) => series.ok[i] + series.client[i] + series.server[i]);
  const maxValue = Math.max(...totals);

  // Get colors from CSS variables
  const okColor = cssVar('--status-ok');
  const clientColor = cssVar('--status-client-error');
  const serverColor = cssVar('--status-server-error');

  const colors = {
    ok: { line: okColor, fill: hexToRgba(okColor, 0.3) },
    client: { line: clientColor, fill: hexToRgba(clientColor, 0.3) },
    server: { line: serverColor, fill: hexToRgba(serverColor, 0.3) }
  };

  // Draw axes
  drawAxes(ctx, dimensions, maxValue, data, cssVar);

  // Helper functions for coordinates
  const getY = (value) => height - padding.bottom - (chartHeight * value / (maxValue || 1));
  const getX = (i) => padding.left + (chartWidth * i / (data.length - 1 || 1));

  // Calculate stacked values
  const stacked = calculateStackedValues(series);
  const { stackedServer, stackedClient, stackedOk } = stacked;

  // Draw stacked areas (bottom to top: server, client, ok)
  drawStackedArea(ctx, getX, getY, stackedServer, null, colors.server);
  drawStackedArea(ctx, getX, getY, stackedClient, stackedServer, colors.client);
  drawStackedArea(ctx, getX, getY, stackedOk, stackedClient, colors.ok);

  // Detect anomalies (skip for time ranges less than 5 minutes)
  const timeRangeMs = data.length >= 2
    ? new Date(data[data.length - 1].t) - new Date(data[0].t)
    : 0;
  const minTimeRangeMs = 5 * 60 * 1000;
  const steps = timeRangeMs >= minTimeRangeMs ? detectSteps(series, 5) : [];

  // Store detected steps with time metadata
  const detectedSteps = steps.map(s => ({
    ...s,
    startTime: data[s.startIndex]?.t ? new Date(data[s.startIndex].t) : null,
    endTime: data[s.endIndex]?.t ? new Date(data[s.endIndex].t) : null
  }));
  setLastDetectedSteps(detectedSteps);

  // Debug output
  if (steps.length > 0) {
    console.table(steps.map(s => ({
      rank: s.rank,
      type: s.type,
      category: s.category,
      startIndex: s.startIndex,
      endIndex: s.endIndex,
      startTime: data[s.startIndex]?.t,
      endTime: data[s.endIndex]?.t,
      magnitude: Math.round(s.magnitude * 100) + '%',
      score: s.score.toFixed(2)
    })));
  }

  // Draw anomaly highlights and collect bounds
  const anomalyBounds = [];
  for (const step of steps) {
    const bounds = drawAnomalyHighlight(ctx, step, dimensions, stacked, getX, getY, data);
    anomalyBounds.push(bounds);
  }

  // Draw selection band if present
  if (pendingSelection) {
    drawSelectionBand(ctx, pendingSelection, dimensions, data);
  }

  // Fetch and render release ships asynchronously
  const startTime = new Date(data[0].t);
  const endTime = new Date(data[data.length - 1].t);
  getReleasesInRange(startTime, endTime).then(releases => {
    if (releases.length > 0) {
      const chartDimensions = { width, height, padding, chartWidth };
      const shipPositions = renderReleaseShips(ctx, releases, data, chartDimensions);
      if (onShipPositionsReady) {
        onShipPositionsReady(shipPositions);
      }
    } else {
      if (onShipPositionsReady) {
        onShipPositionsReady(null);
      }
    }
  }).catch(err => {
    console.error('Failed to render releases:', err);
    if (onShipPositionsReady) {
      onShipPositionsReady(null);
    }
  });

  return {
    layout: dimensions,
    anomalyBounds,
    detectedSteps
  };
}
