/**
 * Time series chart module - public API and orchestration.
 * Coordinates rendering, events, and zoom functionality.
 *
 * @module chart
 */

import { query } from './api.js';
import { getFacetFilters } from './breakdowns/index.js';
import { DATABASE } from './config.js';
import { state } from './state.js';
import { getHostFilter, getTable, getTimeBucket, getTimeFilter } from './time.js';
import { hideReleaseTooltip, getShipAtPoint } from './releases.js';
import { clearSelectionHighlights } from './anomaly-investigation.js';

// Import submodules
import { renderChartCanvas, getLastDetectedSteps } from './chart-render.js';
import {
  createScrubberElements,
  createNavOverlay,
  updateScrubber,
  setupTouchHandlers,
  setupShipTooltipHandlers,
  getAnomalyAtX
} from './chart-events.js';
import {
  createSelectionOverlay,
  createDragSelectionManager,
  navigateTime,
  zoomToAnomalyByRank as zoomToAnomalyByRankImpl,
  zoomToAnomaly as zoomToAnomalyImpl
} from './chart-zoom.js';

// Module state
let onNavigate = null;
let navOverlay = null;
let scrubber = null;
let selectionOverlay = null;
let dragManager = null;
let chartLayout = null;
let lastChartData = null;
let lastAnomalyBoundsList = [];
let lastShipPositions = null;

/**
 * Setup chart navigation and interactions
 * @param {Function} callback - Navigation callback
 */
export function setupChartNavigation(callback) {
  onNavigate = callback;
  const canvas = document.getElementById('chart');
  const container = canvas.parentElement;

  // Create UI elements
  navOverlay = createNavOverlay(container);
  scrubber = createScrubberElements(container);
  selectionOverlay = createSelectionOverlay(container);

  // Setup drag selection manager
  dragManager = createDragSelectionManager(canvas, selectionOverlay, container, {
    getLayout: () => chartLayout,
    getData: () => lastChartData,
    getAnomalyBounds: () => lastAnomalyBoundsList,
    onAnomalyClick: (rank) => zoomToAnomalyByRank(rank),
    onNavigate: () => onNavigate?.(),
    requestRender: () => {
      if (lastChartData) {
        requestAnimationFrame(() => renderChart(lastChartData));
      }
    }
  });

  // Setup touch handlers
  setupTouchHandlers(container, (fraction) => {
    navigateTime(fraction, onNavigate);
  });

  // Setup ship tooltip handlers
  setupShipTooltipHandlers(
    canvas,
    () => lastShipPositions,
    () => lastAnomalyBoundsList
  );

  // Scrubber show/hide on hover
  container.addEventListener('mouseenter', () => {
    scrubber.line.classList.add('visible');
    scrubber.statusBar.classList.add('visible');
  });

  container.addEventListener('mouseleave', () => {
    scrubber.line.classList.remove('visible');
    scrubber.statusBar.classList.remove('visible');
  });

  // Scrubber position update
  container.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    updateScrubber(
      scrubber, x, chartLayout, lastChartData,
      lastAnomalyBoundsList, getLastDetectedSteps(), lastShipPositions
    );

    // Also handle drag
    dragManager.handleMouseMove(e);
  });

  // Drag handlers on canvas
  canvas.addEventListener('mousedown', (e) => dragManager.startDragTracking(e));

  // Nav zone drag handlers
  navOverlay.querySelectorAll('.chart-nav-zone').forEach(zone => {
    zone.addEventListener('mousedown', (e) => dragManager.startDragTracking(e));
  });

  // Container-level mouse up and leave
  container.addEventListener('mouseup', (e) => dragManager.handleMouseUp(e));
  container.addEventListener('mouseleave', () => {
    dragManager.handleMouseLeave();
  });

  // Nav zone click handlers
  navOverlay.querySelector('.chart-nav-left').addEventListener('click', (e) => {
    if (dragManager.isJustCompletedDrag()) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const anomaly = getAnomalyAtX(x, lastAnomalyBoundsList);
    if (anomaly) {
      zoomToAnomalyByRank(anomaly.rank);
    } else {
      navigateTime(-2/3, onNavigate);
    }
  });

  navOverlay.querySelector('.chart-nav-right').addEventListener('click', (e) => {
    if (dragManager.isJustCompletedDrag()) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const anomaly = getAnomalyAtX(x, lastAnomalyBoundsList);
    if (anomaly) {
      zoomToAnomalyByRank(anomaly.rank);
    } else {
      navigateTime(2/3, onNavigate);
    }
  });

  // Nav zone hover state for anomalies/ships
  navOverlay.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const anomaly = getAnomalyAtX(x, lastAnomalyBoundsList);
    const ship = getShipAtPoint(lastShipPositions, x, y);
    navOverlay.classList.toggle('over-anomaly', !!anomaly);
    navOverlay.classList.toggle('over-ship', !!ship);
  });

  navOverlay.addEventListener('mouseleave', () => {
    navOverlay.classList.remove('over-anomaly');
    navOverlay.classList.remove('over-ship');
  });
}

/**
 * Get the count of detected anomalies
 * @returns {number} Number of anomalies
 */
export function getAnomalyCount() {
  return lastAnomalyBoundsList.length;
}

/**
 * Get the time range of an anomaly by rank
 * @param {number} rank - Anomaly rank (1-5)
 * @returns {Object|null} Time range { start, end } or null
 */
export function getAnomalyTimeRange(rank = 1) {
  const bounds = lastAnomalyBoundsList.find(b => b.rank === rank);
  if (!bounds) return null;
  return {
    start: bounds.startTime,
    end: bounds.endTime
  };
}

/**
 * Get all detected anomalies with time bounds
 * @returns {Array} Array of anomaly objects
 */
export function getDetectedAnomalies() {
  const detectedSteps = getLastDetectedSteps();
  return lastAnomalyBoundsList.map(bounds => ({
    rank: bounds.rank,
    startTime: bounds.startTime,
    endTime: bounds.endTime,
    ...detectedSteps.find(s => s.rank === bounds.rank)
  }));
}

/**
 * Get the last chart data
 * @returns {Array} Chart data
 */
export function getLastChartData() {
  return lastChartData;
}

/**
 * Get the time range for the most recent section (last 20%)
 * @returns {Object|null} Time range { start, end } or null
 */
export function getMostRecentTimeRange() {
  if (!lastChartData || lastChartData.length < 2) return null;
  const len = lastChartData.length;
  const startIdx = Math.floor(len * 0.8);
  return {
    start: new Date(lastChartData[startIdx].t),
    end: new Date(lastChartData[len - 1].t)
  };
}

/**
 * Zoom to anomaly by rank
 * @param {number} rank - Anomaly rank (1-5)
 * @returns {boolean} True if zoom was successful
 */
export function zoomToAnomalyByRank(rank) {
  return zoomToAnomalyByRankImpl(
    rank,
    lastAnomalyBoundsList,
    getLastDetectedSteps(),
    onNavigate
  );
}

/**
 * Zoom to the most prominent anomaly, or most recent section
 * @returns {boolean} True if zoom was successful
 */
export function zoomToAnomaly() {
  return zoomToAnomalyImpl(
    lastAnomalyBoundsList,
    getLastDetectedSteps(),
    lastChartData,
    onNavigate
  );
}

/**
 * Load time series data from the API
 */
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
    console.error('Chart error:', err);
  }
}

/**
 * Render the chart with data
 * @param {Array} data - Chart data
 */
export function renderChart(data) {
  // Store data and reset bounds
  lastChartData = data;
  lastAnomalyBoundsList = [];
  lastShipPositions = null;
  hideReleaseTooltip();

  const canvas = document.getElementById('chart');
  const pendingSelection = dragManager?.getPendingSelection() || null;

  const result = renderChartCanvas(data, {
    canvas,
    pendingSelection,
    onShipPositionsReady: (positions) => {
      lastShipPositions = positions;
    }
  });

  // Store layout and bounds
  chartLayout = result.layout;
  lastAnomalyBoundsList = result.anomalyBounds;
}
