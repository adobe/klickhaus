// Time series chart rendering
import { query } from './api.js';
import { getFacetFilters } from './breakdowns/index.js';
import { DATABASE } from './config.js';
import { formatNumber } from './format.js';
import { state } from './state.js';
import { detectSteps } from './step-detection.js';
import { addFilter } from './filters.js';
import { getHostFilter, getPeriodMs, getTable, getTimeBucket, getTimeFilter, queryTimestamp, setCustomTimeRange, setQueryTimestamp } from './time.js';
import { saveStateToURL } from './url-state.js';
import { getReleasesInRange, renderReleaseShips, getShipAtPoint, showReleaseTooltip, hideReleaseTooltip } from './releases.js';
import { investigateTimeRange, clearSelectionHighlights } from './anomaly-investigation.js';

// Navigation state
let onNavigate = null;
let navOverlay = null;

// Ship positions for tooltip hit-testing
let lastShipPositions = null;

// Scrubber elements
let scrubberLine = null;
let scrubberStatusBar = null;

// Drag selection elements and state
let selectionOverlay = null;
let isDragging = false;
let dragStartX = null;
let justCompletedDrag = false; // Flag to prevent click handlers firing after drag

// Pending selection state (module-level for access in renderChart)
let pendingSelection = null; // { startTime, endTime } - persists after drag until clicked or cleared

// Chart layout info for scrubber (set during render)
let chartLayout = null;

// Anomaly zoom state - now supports up to 5 anomalies
let lastAnomalyBoundsList = []; // Array of { left, right, startTime, endTime, rank }
let lastChartData = null; // Store data for timestamp lookups

export function setupChartNavigation(callback) {
  onNavigate = callback;
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

  // Click on selection overlay to navigate to the selected time range
  selectionOverlay.addEventListener('click', () => {
    if (pendingSelection) {
      const { startTime, endTime } = pendingSelection;
      hideSelectionOverlay();
      setCustomTimeRange(startTime, endTime);
      saveStateToURL();
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
      navigateTime(deltaX > 0 ? -2/3 : 2/3);
    }
  }, { passive: true });

  // Double-tap to toggle logs
  let lastTap = 0;
  container.addEventListener('touchend', (e) => {
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

  // Check if x position is within any anomaly region
  function getAnomalyAtX(x) {
    for (const bounds of lastAnomalyBoundsList) {
      if (x >= bounds.left && x <= bounds.right) {
        return bounds;
      }
    }
    return null;
  }

  // Get ship near x position (with padding for easier hover)
  function getShipNearX(x, padding = 20) {
    if (!lastShipPositions) return null;
    for (const ship of lastShipPositions) {
      if (Math.abs(x - ship.x) <= padding) {
        return ship;
      }
    }
    return null;
  }

  // Parse timestamp as UTC (ClickHouse returns UTC times without Z suffix)
  function parseUTC(timestamp) {
    const str = String(timestamp);
    // If already has Z suffix, parse directly
    if (str.endsWith('Z')) {
      return new Date(str);
    }
    // Otherwise, normalize and append Z to treat as UTC
    return new Date(str.replace(' ', 'T') + 'Z');
  }

  // Get time at x position
  function getTimeAtX(x) {
    if (!chartLayout || !lastChartData || lastChartData.length < 2) return null;
    const { padding, chartWidth } = chartLayout;
    const xRatio = (x - padding.left) / chartWidth;
    if (xRatio < 0 || xRatio > 1) return null;

    const startTime = parseUTC(lastChartData[0].t).getTime();
    const endTime = parseUTC(lastChartData[lastChartData.length - 1].t).getTime();
    const time = new Date(startTime + xRatio * (endTime - startTime));
    return time;
  }

  // Format time for scrubber display (similar to x-axis labels)
  function formatScrubberTime(time) {
    const now = new Date();
    const diffMs = now - time;
    const diffMinutes = Math.floor(diffMs / 60000);

    // Format like x-axis: HH:MM:SS UTC
    const timeStr = time.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'UTC'
    });

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

  // Format anomaly duration
  function formatDuration(startTime, endTime) {
    const durationMs = endTime - startTime;
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    if (minutes === 0) return `${seconds}s`;
    if (seconds === 0) return `${minutes}m`;
    return `${minutes}m ${seconds}s`;
  }

  // Update scrubber position and content
  function updateScrubber(x, y) {
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
    let row2Parts = [];

    // Check for anomaly
    const anomaly = getAnomalyAtX(x);
    if (anomaly) {
      const step = lastDetectedSteps.find(s => s.rank === anomaly.rank);
      const duration = formatDuration(anomaly.startTime, anomaly.endTime);
      const typeLabel = step?.type === 'spike' ? 'Spike' : 'Dip';
      const categoryLabel = step?.category === 'red' ? '5xx' : step?.category === 'yellow' ? '4xx' : '2xx';
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
      const release = ship.release;
      // Determine release type from semver: x.0.0 = breaking (red), x.y.0 = feature (yellow), else patch (green)
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
      const padding = 24; // Match CSS padding

      // Calculate target position (centered on scrubber)
      const targetLeft = x - innerWidth / 2;

      // Apply easing at edges
      const minLeft = padding;
      const maxLeft = statusWidth - innerWidth - padding;

      // Ease function: smoothly transition from edge-clamped to centered
      const edgeZone = innerWidth / 2 + padding;
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
      inner.style.marginLeft = `${finalLeft - padding}px`;
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
  });

  container.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    updateScrubber(x, y);
  });

  // Drag selection for time range zoom
  const minDragDistance = 20; // Minimum pixels to count as a drag (not a click)

  function updateSelectionOverlay(startX, endX) {
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
    pendingSelection = null;
    // Clear blue highlights when selection is cleared
    clearSelectionHighlights();
    // Redraw chart to remove blue band
    if (lastChartData) {
      requestAnimationFrame(() => {
        renderChart(lastChartData);
      });
    }
  }

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
    if (pendingSelection) {
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
  navOverlay.querySelectorAll('.chart-nav-zone').forEach(zone => {
    zone.addEventListener('mousedown', startDragTracking);
  });

  // Use container-level mousemove so drag works even when over nav zones
  container.addEventListener('mousemove', (e) => {
    if (dragStartX === null) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const distance = Math.abs(x - dragStartX);

    if (distance >= minDragDistance) {
      isDragging = true;
      container.classList.add('dragging');
      // Clamp x to chart bounds
      const clampedX = Math.max(chartLayout?.padding?.left || 0,
        Math.min(x, (chartLayout?.width || rect.width) - (chartLayout?.padding?.right || 0)));
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
      if (pendingSelection) {
        // Don't clear if clicking on the selection overlay itself (let its click handler deal with it)
        if (e.target === selectionOverlay || selectionOverlay.contains(e.target)) {
          return;
        }
        // Clicking outside selection clears it
        hideSelectionOverlay();
        return;
      }
      if (lastAnomalyBoundsList.length > 0) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const anomaly = getAnomalyAtX(x);
        if (anomaly) {
          zoomToAnomalyByRank(anomaly.rank);
        }
      }
      return;
    }

    // It was a drag - store pending selection but don't navigate yet
    const rect = canvas.getBoundingClientRect();
    const endX = e.clientX - rect.left;

    const startTime = getTimeAtX(Math.min(startX, endX));
    const endTime = getTimeAtX(Math.max(startX, endX));

    if (startTime && endTime && startTime < endTime) {
      pendingSelection = { startTime, endTime };
      selectionOverlay.classList.add('confirmed');
      // Keep overlay visible - don't hide it
      // Set flag to prevent click handlers from firing
      justCompletedDrag = true;
      requestAnimationFrame(() => { justCompletedDrag = false; });

      // Redraw chart to show blue selection band
      if (lastChartData) {
        requestAnimationFrame(() => {
          renderChart(lastChartData);
        });
      }

      // Trigger investigation for the selected time range
      if (lastChartData && lastChartData.length >= 2) {
        const fullStart = new Date(lastChartData[0].t);
        const fullEnd = new Date(lastChartData[lastChartData.length - 1].t);
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
      navigateTime(-2/3);
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
      navigateTime(2/3);
    }
  });

  // Hide nav zone hover when over an anomaly or ship
  navOverlay.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const anomaly = getAnomalyAtX(x);
    const ship = getShipAtPoint(lastShipPositions, x, y);
    navOverlay.classList.toggle('over-anomaly', !!anomaly);
    navOverlay.classList.toggle('over-ship', !!ship);
  });

  navOverlay.addEventListener('mouseleave', () => {
    navOverlay.classList.remove('over-anomaly');
    navOverlay.classList.remove('over-ship');
  });

  // Ship tooltip on hover
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const ship = getShipAtPoint(lastShipPositions, x, y);

    if (ship) {
      // Convert canvas coordinates to page coordinates
      const pageX = e.clientX;
      const pageY = e.clientY;
      showReleaseTooltip(ship.release, pageX, pageY);
      canvas.style.cursor = 'pointer';
    } else {
      hideReleaseTooltip();
      // Restore cursor based on anomaly hover state
      const anomaly = getAnomalyAtX(x);
      canvas.style.cursor = anomaly ? 'pointer' : '';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    hideReleaseTooltip();
    canvas.style.cursor = '';
  });
}

// Get the count of detected anomalies
export function getAnomalyCount() {
  return lastAnomalyBoundsList.length;
}

// Get the time range of an anomaly by rank (1-5)
export function getAnomalyTimeRange(rank = 1) {
  const bounds = lastAnomalyBoundsList.find(b => b.rank === rank);
  if (!bounds) return null;
  return {
    start: bounds.startTime,
    end: bounds.endTime
  };
}

// Get all detected anomalies with time bounds (for investigation)
export function getDetectedAnomalies() {
  return lastAnomalyBoundsList.map(bounds => ({
    rank: bounds.rank,
    startTime: bounds.startTime,
    endTime: bounds.endTime,
    // Find matching step info from last detection
    ...lastDetectedSteps.find(s => s.rank === bounds.rank)
  }));
}

// Get the last chart data (for investigation)
export function getLastChartData() {
  return lastChartData;
}

// Store detected steps for investigation
let lastDetectedSteps = [];

// Get the time range for the most recent section (last 20% of timeline)
export function getMostRecentTimeRange() {
  if (!lastChartData || lastChartData.length < 2) return null;
  const len = lastChartData.length;
  // Last 20% of the timeline
  const startIdx = Math.floor(len * 0.8);
  return {
    start: new Date(lastChartData[startIdx].t),
    end: new Date(lastChartData[len - 1].t)
  };
}

// Status range column for filtering
const STATUS_RANGE_COL = "concat(toString(intDiv(`response.status`, 100)), 'xx')";

// Zoom to anomaly by rank (1 = most prominent)
export function zoomToAnomalyByRank(rank) {
  const range = getAnomalyTimeRange(rank);
  if (!range) return false;

  // Get the anomaly ID for this rank (set during investigation)
  const anomalyId = window._anomalyIds?.[rank] || null;

  // Get the anomaly category and add corresponding status filter
  const step = lastDetectedSteps.find(s => s.rank === rank);
  if (step?.category) {
    // Map category to status range filter values
    // red = 5xx errors, yellow = 4xx client errors, green = 2xx success
    const statusFilters = {
      'red': ['5xx'],
      'yellow': ['4xx'],
      'green': ['2xx']  // Focus on successful requests for green anomalies
    };
    const values = statusFilters[step.category];
    if (values) {
      for (const value of values) {
        // Skip reload - we'll reload once after setting time range
        addFilter(STATUS_RANGE_COL, value, false, true);
      }
    }
  }

  setCustomTimeRange(range.start, range.end);
  // Save all state atomically in one history entry (time + filters + anomaly ID)
  saveStateToURL(anomalyId);

  if (onNavigate) onNavigate();
  return true;
}

// Zoom to the most prominent anomaly, or most recent section if none
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

function navigateTime(fraction) {
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

export function renderChart(data) {
  // Store data for zoom functionality and reset anomaly/ship bounds
  lastChartData = data;
  lastAnomalyBoundsList = [];
  lastShipPositions = null; // Reset ship positions on redraw
  hideReleaseTooltip(); // Hide any visible tooltip

  const canvas = document.getElementById('chart');
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
  const labelInset = 24; // Match main element padding for alignment with breakdowns
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Store layout for scrubber
  chartLayout = { width, height, padding, chartWidth, chartHeight };

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
    ok: data.map(d => parseInt(d.cnt_ok) || 0),
    client: data.map(d => parseInt(d.cnt_4xx) || 0),
    server: data.map(d => parseInt(d.cnt_5xx) || 0)
  };

  // Calculate stacked totals for max value
  const totals = data.map((_, i) => series.ok[i] + series.client[i] + series.server[i]);
  const maxValue = Math.max(...totals);
  const minValue = 0;

  // Colors from CSS variables
  const hexToRgba = (hex, alpha) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const okColor = cssVar('--status-ok');
  const clientColor = cssVar('--status-client-error');
  const serverColor = cssVar('--status-server-error');

  const colors = {
    ok: { line: okColor, fill: hexToRgba(okColor, 0.3) },
    client: { line: clientColor, fill: hexToRgba(clientColor, 0.3) },
    server: { line: serverColor, fill: hexToRgba(serverColor, 0.3) }
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

  // Round intermediate values to nice numbers, keep top value exact
  const roundToNice = (val) => {
    if (val === 0) return 0;
    const magnitude = Math.pow(10, Math.floor(Math.log10(val)));
    const normalized = val / magnitude;
    // Round to nearest 1, 2, 2.5, or 5
    let nice;
    if (normalized <= 1.5) nice = 1;
    else if (normalized <= 2.25) nice = 2;
    else if (normalized <= 3.5) nice = 2.5;
    else if (normalized <= 7.5) nice = 5;
    else nice = 10;
    return nice * magnitude;
  };

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

  // Helper function to get Y coordinate
  const getY = (value) => height - padding.bottom - (chartHeight * value / (maxValue || 1));
  const getX = (i) => padding.left + (chartWidth * i / (data.length - 1 || 1));

  // Calculate cumulative values for stacking (reversed order: 5xx at bottom)
  const stackedServer = series.server.slice();
  const stackedClient = series.server.map((v, i) => v + series.client[i]);
  const stackedOk = series.server.map((v, i) => v + series.client[i] + series.ok[i]);

  // Draw 1xx-3xx area (top layer - green)
  if (series.ok.some(v => v > 0)) {
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(stackedClient[0]));
    for (let i = 0; i < data.length; i++) {
      ctx.lineTo(getX(i), getY(stackedOk[i]));
    }
    for (let i = data.length - 1; i >= 0; i--) {
      ctx.lineTo(getX(i), getY(stackedClient[i]));
    }
    ctx.closePath();
    ctx.fillStyle = colors.ok.fill;
    ctx.fill();

    // Draw line on top
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(stackedOk[0]));
    for (let i = 1; i < data.length; i++) {
      ctx.lineTo(getX(i), getY(stackedOk[i]));
    }
    ctx.strokeStyle = colors.ok.line;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Draw 4xx area (middle layer - yellow/orange)
  if (series.client.some(v => v > 0)) {
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(stackedServer[0]));
    for (let i = 0; i < data.length; i++) {
      ctx.lineTo(getX(i), getY(stackedClient[i]));
    }
    for (let i = data.length - 1; i >= 0; i--) {
      ctx.lineTo(getX(i), getY(stackedServer[i]));
    }
    ctx.closePath();
    ctx.fillStyle = colors.client.fill;
    ctx.fill();

    // Draw line on top
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(stackedClient[0]));
    for (let i = 1; i < data.length; i++) {
      ctx.lineTo(getX(i), getY(stackedClient[i]));
    }
    ctx.strokeStyle = colors.client.line;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Draw 5xx area (bottom layer - red)
  if (series.server.some(v => v > 0)) {
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(0));
    for (let i = 0; i < data.length; i++) {
      ctx.lineTo(getX(i), getY(stackedServer[i]));
    }
    ctx.lineTo(getX(data.length - 1), getY(0));
    ctx.closePath();
    ctx.fillStyle = colors.server.fill;
    ctx.fill();

    // Draw line on top
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(stackedServer[0]));
    for (let i = 1; i < data.length; i++) {
      ctx.lineTo(getX(i), getY(stackedServer[i]));
    }
    ctx.strokeStyle = colors.server.line;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Detect and highlight up to 5 anomaly regions (spikes or dips)
  // Skip anomaly detection for time ranges less than 5 minutes
  const timeRangeMs = data.length >= 2
    ? new Date(data[data.length - 1].t) - new Date(data[0].t)
    : 0;
  const minTimeRangeMs = 5 * 60 * 1000; // 5 minutes
  const steps = timeRangeMs >= minTimeRangeMs ? detectSteps(series, 5) : [];

  // Store detected steps for investigation (with additional metadata)
  lastDetectedSteps = steps.map(s => ({
    ...s,
    startTime: data[s.startIndex]?.t ? new Date(data[s.startIndex].t) : null,
    endTime: data[s.endIndex]?.t ? new Date(data[s.endIndex].t) : null
  }));

  // Debug: show detected anomalies in console
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

  for (const step of steps) {
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
    const bandWidth = bandRight - bandLeft;

    // Store anomaly bounds for click detection and zoom
    const startTime = new Date(data[step.startIndex].t);
    const endTime = new Date(data[step.endIndex].t);
    lastAnomalyBoundsList.push({
      left: bandLeft,
      right: bandRight,
      startTime,
      endTime,
      rank: step.rank
    });

    // Color coding matches the traffic category: red (5xx), yellow (4xx), green (2xx/3xx)
    // Use slightly lower opacity for lower-ranked anomalies, but keep them clearly visible
    // Labels and lines always use full opacity for readability
    const opacityMultiplier = step.rank === 1 ? 1 : 0.7;
    let highlightFill, highlightStroke, labelColor;

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
    let getSeriesTop, getSeriesBottom;
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
    for (let i = startIdx; i <= endIdx; i++) {
      points.push({ x: getX(i), y: getSeriesTop(i), label: `top[${i}]` });
    }
    // Bottom edge: trace back from endIdx to startIdx along the series bottom
    for (let i = endIdx; i >= startIdx; i--) {
      points.push({ x: getX(i), y: getSeriesBottom(i), label: `bot[${i}]` });
    }

    // Draw filled polygon for the anomaly region
    ctx.fillStyle = highlightFill;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
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
  if (pendingSelection) {
    const { startTime: selStart, endTime: selEnd } = pendingSelection;
    const dataStart = new Date(data[0].t);
    const dataEnd = new Date(data[data.length - 1].t);
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
  const startTime = new Date(data[0].t);
  const endTime = new Date(data[data.length - 1].t);
  getReleasesInRange(startTime, endTime).then(releases => {
    if (releases.length > 0) {
      const chartDimensions = { width, height, padding, chartWidth };
      lastShipPositions = renderReleaseShips(ctx, releases, data, chartDimensions);
    } else {
      lastShipPositions = null;
    }
  }).catch(err => {
    console.error('Failed to render releases:', err);
    lastShipPositions = null;
  });
}
