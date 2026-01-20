/**
 * Chart zoom and time selection module.
 * Handles drag selection, time range navigation, and anomaly zoom.
 *
 * @module chart-zoom
 */

import { setCustomTimeRange, getPeriodMs, queryTimestamp, setQueryTimestamp } from './time.js';
import { saveStateToURL } from './url-state.js';
import { addFilter } from './filters.js';
import { getTimeAtX, getAnomalyAtX } from './chart-events.js';
import { investigateTimeRange, clearSelectionHighlights } from './anomaly-investigation.js';

// Status range column for filtering
const STATUS_RANGE_COL = "concat(toString(intDiv(`response.status`, 100)), 'xx')";

/**
 * Create selection overlay element
 * @param {HTMLElement} container - Container element
 * @returns {HTMLElement} Selection overlay element
 */
export function createSelectionOverlay(container) {
  const overlay = document.createElement('div');
  overlay.className = 'chart-selection-overlay';
  container.appendChild(overlay);
  return overlay;
}

/**
 * Update selection overlay position and size
 * @param {HTMLElement} overlay - Overlay element
 * @param {number} startX - Start X coordinate
 * @param {number} endX - End X coordinate
 * @param {Object} layout - Chart layout
 */
export function updateSelectionOverlay(overlay, startX, endX, layout) {
  if (!layout) return;
  const { padding, height } = layout;
  const left = Math.min(startX, endX);
  const width = Math.abs(endX - startX);

  overlay.style.left = `${left}px`;
  overlay.style.top = `${padding.top}px`;
  overlay.style.width = `${width}px`;
  overlay.style.height = `${height - padding.top - padding.bottom}px`;
  overlay.classList.add('visible');
}

/**
 * Hide selection overlay
 * @param {HTMLElement} overlay - Overlay element
 */
export function hideSelectionOverlay(overlay) {
  overlay.classList.remove('visible');
  overlay.classList.remove('confirmed');
}

/**
 * Navigate time by a fraction of the current period
 * @param {number} fraction - Fraction of period to navigate (positive = forward)
 * @param {Function} onNavigate - Callback after navigation
 */
export function navigateTime(fraction, onNavigate) {
  const periodMs = getPeriodMs();
  const shiftMs = periodMs * fraction;
  const currentTs = queryTimestamp || new Date();
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
 * Zoom to a specific time range
 * @param {Date} start - Start time
 * @param {Date} end - End time
 * @param {string|null} anomalyId - Optional anomaly ID for URL state
 * @param {Function} onNavigate - Callback after navigation
 */
export function zoomToTimeRange(start, end, anomalyId, onNavigate) {
  setCustomTimeRange(start, end);
  saveStateToURL(anomalyId);
  if (onNavigate) onNavigate();
}

/**
 * Zoom to anomaly by rank
 * @param {number} rank - Anomaly rank (1-5)
 * @param {Array} anomalyBounds - Array of anomaly bounds
 * @param {Array} detectedSteps - Array of detected steps
 * @param {Function} onNavigate - Callback after navigation
 * @returns {boolean} True if zoom was successful
 */
export function zoomToAnomalyByRank(rank, anomalyBounds, detectedSteps, onNavigate) {
  const bounds = anomalyBounds.find(b => b.rank === rank);
  if (!bounds) return false;

  const anomalyId = window._anomalyIds?.[rank] || null;

  // Get the anomaly category and add corresponding status filter
  const step = detectedSteps.find(s => s.rank === rank);
  if (step?.category) {
    const statusFilters = {
      'red': ['5xx'],
      'yellow': ['4xx'],
      'green': ['2xx']
    };
    const values = statusFilters[step.category];
    if (values) {
      for (const value of values) {
        addFilter(STATUS_RANGE_COL, value, false, true);
      }
    }
  }

  setCustomTimeRange(bounds.startTime, bounds.endTime);
  saveStateToURL(anomalyId);

  if (onNavigate) onNavigate();
  return true;
}

/**
 * Zoom to the most prominent anomaly, or most recent section if none
 * @param {Array} anomalyBounds - Array of anomaly bounds
 * @param {Array} detectedSteps - Array of detected steps
 * @param {Array} chartData - Chart data for calculating recent section
 * @param {Function} onNavigate - Callback after navigation
 * @returns {boolean} True if zoom was successful
 */
export function zoomToAnomaly(anomalyBounds, detectedSteps, chartData, onNavigate) {
  // Try most prominent anomaly first
  if (anomalyBounds.length > 0) {
    return zoomToAnomalyByRank(1, anomalyBounds, detectedSteps, onNavigate);
  }

  // Fall back to most recent section (last 20%)
  if (!chartData || chartData.length < 2) return false;
  const len = chartData.length;
  const startIdx = Math.floor(len * 0.8);
  const start = new Date(chartData[startIdx].t);
  const end = new Date(chartData[len - 1].t);

  setCustomTimeRange(start, end);
  saveStateToURL();

  if (onNavigate) onNavigate();
  return true;
}

/**
 * Create drag selection state manager
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {HTMLElement} selectionOverlay - Selection overlay element
 * @param {HTMLElement} container - Container element
 * @param {Object} callbacks - Callback functions
 * @returns {Object} Drag state manager
 */
export function createDragSelectionManager(canvas, selectionOverlay, container, callbacks) {
  const {
    getLayout,
    getData,
    getAnomalyBounds,
    onSelectionComplete,
    onSelectionClear,
    onAnomalyClick,
    onNavigate,
    requestRender
  } = callbacks;

  let isDragging = false;
  let dragStartX = null;
  let justCompletedDrag = false;
  let pendingSelection = null;

  const minDragDistance = 20;

  function getPendingSelection() {
    return pendingSelection;
  }

  function clearPendingSelection() {
    hideSelectionOverlay(selectionOverlay);
    pendingSelection = null;
    clearSelectionHighlights();
    requestRender();
  }

  function startDragTracking(e) {
    if (e.button !== 0) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;

    // Check if clicking on an anomaly
    const anomaly = getAnomalyAtX(x, getAnomalyBounds());
    if (anomaly) return;

    // Clear existing selection
    if (pendingSelection) {
      clearPendingSelection();
    }

    isDragging = false;
    dragStartX = x;
    e.preventDefault();
  }

  function handleMouseMove(e) {
    if (dragStartX === null) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const distance = Math.abs(x - dragStartX);
    const layout = getLayout();

    if (distance >= minDragDistance) {
      isDragging = true;
      container.classList.add('dragging');
      const clampedX = Math.max(layout?.padding?.left || 0,
        Math.min(x, (layout?.width || rect.width) - (layout?.padding?.right || 0)));
      updateSelectionOverlay(selectionOverlay, dragStartX, clampedX, layout);
    }
  }

  function handleMouseUp(e) {
    const wasDragging = isDragging;
    const startX = dragStartX;

    isDragging = false;
    dragStartX = null;
    container.classList.remove('dragging');

    if (!wasDragging) {
      if (pendingSelection) {
        if (e.target === selectionOverlay || selectionOverlay.contains(e.target)) {
          return;
        }
        clearPendingSelection();
        return;
      }
      const bounds = getAnomalyBounds();
      if (bounds.length > 0) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const anomaly = getAnomalyAtX(x, bounds);
        if (anomaly) {
          onAnomalyClick(anomaly.rank);
        }
      }
      return;
    }

    // It was a drag
    const rect = canvas.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const layout = getLayout();
    const data = getData();

    const startTime = getTimeAtX(Math.min(startX, endX), layout, data);
    const endTime = getTimeAtX(Math.max(startX, endX), layout, data);

    if (startTime && endTime && startTime < endTime) {
      pendingSelection = { startTime, endTime };
      selectionOverlay.classList.add('confirmed');
      justCompletedDrag = true;
      requestAnimationFrame(() => { justCompletedDrag = false; });

      requestRender();

      // Trigger investigation
      if (data && data.length >= 2) {
        const fullStart = new Date(data[0].t);
        const fullEnd = new Date(data[data.length - 1].t);
        investigateTimeRange(startTime, endTime, fullStart, fullEnd);
      }

      if (onSelectionComplete) {
        onSelectionComplete(pendingSelection);
      }
    } else {
      clearPendingSelection();
    }
  }

  function handleMouseLeave() {
    if (isDragging || dragStartX !== null) {
      isDragging = false;
      dragStartX = null;
      container.classList.remove('dragging');
      clearPendingSelection();
    }
  }

  function isJustCompletedDrag() {
    return justCompletedDrag;
  }

  // Setup selection overlay click handler
  selectionOverlay.addEventListener('click', () => {
    if (pendingSelection) {
      const { startTime, endTime } = pendingSelection;
      clearPendingSelection();
      setCustomTimeRange(startTime, endTime);
      saveStateToURL();
      if (onNavigate) onNavigate();
    }
  });

  return {
    startDragTracking,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    getPendingSelection,
    clearPendingSelection,
    isJustCompletedDrag
  };
}
