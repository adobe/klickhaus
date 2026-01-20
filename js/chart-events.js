/**
 * Chart event handling module.
 * Manages mouse, touch, and keyboard events for the chart.
 *
 * @module chart-events
 */

import { getShipAtPoint, showReleaseTooltip, hideReleaseTooltip } from './releases.js';

/**
 * Parse timestamp as UTC
 * @param {string|Date} timestamp - Timestamp to parse
 * @returns {Date} Parsed date
 */
export function parseUTC(timestamp) {
  const str = String(timestamp);
  if (str.endsWith('Z')) {
    return new Date(str);
  }
  return new Date(str.replace(' ', 'T') + 'Z');
}

/**
 * Get time at a given X position on the chart
 * @param {number} x - X coordinate
 * @param {Object} layout - Chart layout info
 * @param {Array} data - Chart data
 * @returns {Date|null} Time at position or null
 */
export function getTimeAtX(x, layout, data) {
  if (!layout || !data || data.length < 2) return null;
  const { padding, chartWidth } = layout;
  const xRatio = (x - padding.left) / chartWidth;
  if (xRatio < 0 || xRatio > 1) return null;

  const startTime = parseUTC(data[0].t).getTime();
  const endTime = parseUTC(data[data.length - 1].t).getTime();
  return new Date(startTime + xRatio * (endTime - startTime));
}

/**
 * Check if x position is within any anomaly region
 * @param {number} x - X coordinate
 * @param {Array} anomalyBounds - Array of anomaly bounds objects
 * @returns {Object|null} Anomaly bounds or null
 */
export function getAnomalyAtX(x, anomalyBounds) {
  for (const bounds of anomalyBounds) {
    if (x >= bounds.left && x <= bounds.right) {
      return bounds;
    }
  }
  return null;
}

/**
 * Get ship near x position (with padding for easier hover)
 * @param {number} x - X coordinate
 * @param {Array} shipPositions - Array of ship positions
 * @param {number} padding - Padding for hit detection (default 20)
 * @returns {Object|null} Ship object or null
 */
export function getShipNearX(x, shipPositions, padding = 20) {
  if (!shipPositions) return null;
  for (const ship of shipPositions) {
    if (Math.abs(x - ship.x) <= padding) {
      return ship;
    }
  }
  return null;
}

/**
 * Format time for scrubber display
 * @param {Date} time - Time to format
 * @returns {Object} Object with timeStr and relativeStr
 */
export function formatScrubberTime(time) {
  const now = new Date();
  const diffMs = now - time;
  const diffMinutes = Math.floor(diffMs / 60000);

  const timeStr = time.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC'
  });

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
 * Create scrubber elements
 * @param {HTMLElement} container - Container element
 * @returns {Object} Scrubber elements { line, statusBar }
 */
export function createScrubberElements(container) {
  const line = document.createElement('div');
  line.className = 'chart-scrubber-line';
  container.appendChild(line);

  const statusBar = document.createElement('div');
  statusBar.className = 'chart-scrubber-status';
  container.appendChild(statusBar);

  return { line, statusBar };
}

/**
 * Create navigation overlay
 * @param {HTMLElement} container - Container element
 * @returns {HTMLElement} Navigation overlay element
 */
export function createNavOverlay(container) {
  const overlay = document.createElement('div');
  overlay.className = 'chart-nav-overlay';
  overlay.innerHTML = `
    <div class="chart-nav-zone chart-nav-left"><span class="chart-nav-arrow">\u25C0</span></div>
    <div class="chart-nav-zone chart-nav-right"><span class="chart-nav-arrow">\u25B6</span></div>
  `;
  container.appendChild(overlay);
  return overlay;
}

/**
 * Update scrubber position and content
 * @param {Object} scrubber - Scrubber elements
 * @param {number} x - X coordinate
 * @param {Object} layout - Chart layout
 * @param {Array} data - Chart data
 * @param {Array} anomalyBounds - Anomaly bounds
 * @param {Array} detectedSteps - Detected steps
 * @param {Array} shipPositions - Ship positions
 */
export function updateScrubber(scrubber, x, layout, data, anomalyBounds, detectedSteps, shipPositions) {
  if (!layout) return;

  const { line, statusBar } = scrubber;
  const { padding, width, height } = layout;

  // Position the scrubber line
  line.style.left = `${x}px`;
  line.style.top = `${padding.top}px`;
  line.style.height = `${height - padding.top - padding.bottom}px`;

  // Get time at position
  const time = getTimeAtX(x, layout, data);
  if (!time) {
    statusBar.innerHTML = '';
    return;
  }

  // Build status bar content
  const { timeStr, relativeStr } = formatScrubberTime(time);

  let row1 = `<span class="scrubber-time">${timeStr} UTC</span>`;
  if (relativeStr) {
    row1 += `<span class="scrubber-relative">${relativeStr}</span>`;
  }

  let row2Parts = [];

  // Check for anomaly
  const anomaly = getAnomalyAtX(x, anomalyBounds);
  if (anomaly) {
    const step = detectedSteps.find(s => s.rank === anomaly.rank);
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

  // Check for ship
  const ship = getShipNearX(x, shipPositions);
  if (ship) {
    const release = ship.release;
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

  statusBar.innerHTML = `<div class="chart-scrubber-status-inner">${content}</div>`;

  // Position inner element with edge easing
  const inner = statusBar.querySelector('.chart-scrubber-status-inner');
  if (inner) {
    const statusWidth = statusBar.offsetWidth;
    const innerWidth = inner.offsetWidth;
    const edgePadding = 24;

    const targetLeft = x - innerWidth / 2;
    const minLeft = edgePadding;
    const maxLeft = statusWidth - innerWidth - edgePadding;

    const edgeZone = innerWidth / 2 + edgePadding;
    let finalLeft;

    if (x < edgeZone) {
      const t = x / edgeZone;
      finalLeft = minLeft + (targetLeft - minLeft) * t;
    } else if (x > width - edgeZone) {
      const t = (width - x) / edgeZone;
      finalLeft = maxLeft + (targetLeft - maxLeft) * t;
    } else {
      finalLeft = targetLeft;
    }

    finalLeft = Math.max(minLeft, Math.min(maxLeft, finalLeft));
    inner.style.marginLeft = `${finalLeft - edgePadding}px`;
  }
}

/**
 * Setup touch event handlers
 * @param {HTMLElement} container - Container element
 * @param {Function} onNavigate - Navigation callback
 */
export function setupTouchHandlers(container, onNavigate) {
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
      onNavigate(deltaX > 0 ? -2/3 : 2/3);
    }
  }, { passive: true });

  // Double-tap to toggle logs
  let lastTap = 0;
  container.addEventListener('touchend', () => {
    const now = Date.now();
    const timeSinceLastTap = now - lastTap;
    if (timeSinceLastTap < 300 && timeSinceLastTap > 0) {
      if (typeof window.toggleLogsViewMobile === 'function') {
        window.toggleLogsViewMobile();
      }
      lastTap = 0;
    } else {
      lastTap = now;
    }
  }, { passive: true });
}

/**
 * Setup ship tooltip handlers
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {Function} getShipPositions - Function to get current ship positions
 * @param {Function} getAnomalyBounds - Function to get current anomaly bounds
 */
export function setupShipTooltipHandlers(canvas, getShipPositions, getAnomalyBounds) {
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const ship = getShipAtPoint(getShipPositions(), x, y);

    if (ship) {
      showReleaseTooltip(ship.release, e.clientX, e.clientY);
      canvas.style.cursor = 'pointer';
    } else {
      hideReleaseTooltip();
      const anomaly = getAnomalyAtX(x, getAnomalyBounds());
      canvas.style.cursor = anomaly ? 'pointer' : '';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    hideReleaseTooltip();
    canvas.style.cursor = '';
  });
}
