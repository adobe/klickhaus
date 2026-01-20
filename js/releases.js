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
import { query } from './api.js';

// Get releases within a time range from ClickHouse
export async function getReleasesInRange(startTime, endTime) {
  try {
    // Format timestamps without 'Z' suffix for ClickHouse
    const formatTs = (d) => d.toISOString().replace('Z', '').replace('T', ' ');
    const sql = `
      SELECT published, repo, tag, url, body
      FROM helix_logs_production.releases FINAL
      WHERE published >= toDateTime64('${formatTs(startTime)}', 3)
        AND published <= toDateTime64('${formatTs(endTime)}', 3)
      ORDER BY published
    `;
    const result = await query(sql, { cacheTtl: 300 });
    return result.data || [];
  } catch (err) {
    console.error('Failed to fetch releases:', err);
    return [];
  }
}

// Render ship symbols on the chart canvas
export function renderReleaseShips(ctx, releases, data, chartDimensions) {
  if (!releases || releases.length === 0 || !data || data.length < 2) return [];

  const { padding, chartWidth } = chartDimensions;
  const startTime = new Date(data[0].t).getTime();
  const endTime = new Date(data[data.length - 1].t).getTime();
  const timeRange = endTime - startTime;

  // Get CSS variables for theming
  const styles = getComputedStyle(document.documentElement);
  const cssVar = (name) => styles.getPropertyValue(name).trim();

  // Track ship positions for tooltip hit-testing
  const shipPositions = [];

  // Draw a simple ship/boat shape
  function drawShip(x, y, color, size = 8) {
    ctx.save();
    ctx.translate(x, y);

    // Hull (boat bottom) - curved bottom
    ctx.beginPath();
    ctx.moveTo(-size, 0);
    ctx.quadraticCurveTo(-size * 0.8, size * 0.6, 0, size * 0.6);
    ctx.quadraticCurveTo(size * 0.8, size * 0.6, size, 0);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    // Sail (triangle)
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.8, 0);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.fill();

    // Mast (vertical line)
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(0, size * 0.3);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 1;
    ctx.stroke();

    ctx.restore();
  }

  for (const release of releases) {
    const publishedTime = new Date(release.published).getTime();
    const xRatio = (publishedTime - startTime) / timeRange;
    const x = padding.left + (chartWidth * xRatio);

    // Draw at the very top of the chart
    const y = 10;

    // Determine release type from semver:
    // x.0.0 = breaking (red), x.y.0 = feature (yellow), else patch (green)
    const versionMatch = release.tag.match(/v?(\d+)\.(\d+)\.(\d+)/);
    let shipColor = cssVar('--status-ok') || '#12b76a'; // Default: patch (green)
    if (versionMatch) {
      const [, , minor, patch] = versionMatch;
      if (minor === '0' && patch === '0') {
        shipColor = cssVar('--status-server-error') || '#f04438'; // Breaking (red)
      } else if (patch === '0') {
        shipColor = cssVar('--status-client-error') || '#f79009'; // Feature (yellow)
      }
    }

    drawShip(x, y, shipColor);

    // Store position for tooltip hit-testing
    shipPositions.push({
      x,
      y,
      release,
      radius: 12, // Hit area radius
    });
  }

  return shipPositions;
}

// Create and manage the release tooltip
let tooltipElement = null;

function ensureTooltip() {
  if (!tooltipElement) {
    tooltipElement = document.createElement('div');
    tooltipElement.className = 'release-tooltip';
    tooltipElement.style.display = 'none';
    document.body.appendChild(tooltipElement);
  }
  return tooltipElement;
}

// Format release notes as HTML (basic markdown conversion)
function formatReleaseNotes(body) {
  if (!body) return '<em>No release notes</em>';

  // Process line by line for better control
  const lines = body.split('\n');
  const htmlLines = lines.map((line) => {
    // Strip markdown links first - keep only the link text
    let html = line.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // Strip bare URLs
    html = html.replace(/https?:\/\/[^\s<]+/g, '');

    // Escape HTML
    html = html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Headings (must be at start of line)
    // Skip h1 entirely - redundant with tooltip header
    if (html.match(/^# /)) {
      return '';
    }
    if (html.match(/^### /)) {
      return `<strong>${html.slice(4)}</strong>`;
    }
    if (html.match(/^## /)) {
      return `<strong>${html.slice(3)}</strong>`;
    }

    // List items (- or *)
    if (html.match(/^[*-] /)) {
      html = `• ${html.slice(2)}`;
    }

    // Inline formatting
    html = html
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>');

    return html;
  });

  return htmlLines.join('<br>');
}

// Show tooltip for a release
export function showReleaseTooltip(release, x, y) {
  const tooltip = ensureTooltip();
  const published = new Date(release.published);
  const timeStr = published.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });

  tooltip.innerHTML = `
    <div class="release-tooltip-header">
      <span class="release-repo">${release.repo}</span>
      <span class="release-tag">${release.tag}</span>
    </div>
    <div class="release-tooltip-time">${timeStr} UTC</div>
    <div class="release-tooltip-body">${formatReleaseNotes(release.body)}</div>
  `;

  // Position tooltip above the ship
  tooltip.style.display = 'block';

  // Get viewport dimensions
  const tooltipRect = tooltip.getBoundingClientRect();
  const viewportWidth = window.innerWidth;

  // Default position: centered above the ship
  let left = x - tooltipRect.width / 2;
  let top = y - tooltipRect.height - 20;

  // Keep within viewport bounds
  if (left < 10) left = 10;
  if (left + tooltipRect.width > viewportWidth - 10) {
    left = viewportWidth - tooltipRect.width - 10;
  }
  if (top < 10) {
    // Show below instead
    top = y + 20;
  }

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

// Hide the tooltip
export function hideReleaseTooltip() {
  if (tooltipElement) {
    tooltipElement.style.display = 'none';
  }
}

// Check if a point is near any ship
export function getShipAtPoint(shipPositions, x, y) {
  if (!shipPositions) return null;
  for (const ship of shipPositions) {
    const dx = x - ship.x;
    const dy = y - ship.y;
    if (dx * dx + dy * dy <= ship.radius * ship.radius) {
      return ship;
    }
  }
  return null;
}
