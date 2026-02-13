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
 * Canvas drawing helpers for the chart module.
 * Extracted from chart.js to stay within the max-lines lint limit.
 */

import { formatNumber } from './format.js';
import { addAnomalyBounds, parseUTC } from './chart-state.js';

/**
 * Draw Y axis with grid lines and labels
 */
export function drawYAxis(ctx, chartDimensions, cssVar, minValue, maxValue) {
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
// eslint-disable-next-line max-len
export function drawXAxisLabels(ctx, data, chartDimensions, intendedStartTime, intendedTimeRange, cssVar) {
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
    const timeStr = time.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
    });
    const showDate = intendedTimeRange > 24 * 60 * 60 * 1000;
    const label = showDate
      ? `${time.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}, ${timeStr}`
      : timeStr;
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
export function drawAnomalyHighlight(ctx, step, data, chartDimensions, getX, getY, stacks) {
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
  ctx.font = '500 11px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = `rgb(${cr}, ${cg}, ${cb})`;
  const arrow = step.type === 'spike' ? '\u25B2' : '\u25BC';
  ctx.fillText(`${step.rank} ${arrow} ${magnitudeLabel}`, (bandLeft + bandRight) / 2, padding.top + 12);
}

/**
 * Draw a stacked area with line on top
 */
export function drawStackedArea(ctx, data, getX, getY, topStack, bottomStack, colors) {
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
  ctx.stroke();
}
