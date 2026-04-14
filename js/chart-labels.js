/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/** Scrubber badge and anomaly label helpers that use state.seriesLabels. */

import { formatNumber } from './format.js';
import { state } from './state.js';
import {
  getDataAtTime, getAnomalyAtX, getDetectedSteps, formatDuration,
} from './chart-state.js';

/** Build value badges HTML for scrubber (labels from state.seriesLabels) */
export function buildValueBadges(time) {
  const dataPoint = getDataAtTime(time);
  if (!dataPoint) {
    return '';
  }
  const { ok: okLabel, client: clientLabel, server: serverLabel } = state.seriesLabels;
  const ok = parseInt(dataPoint.cnt_ok, 10) || 0;
  const client = parseInt(dataPoint.cnt_4xx, 10) || 0;
  const server = parseInt(dataPoint.cnt_5xx, 10) || 0;
  let html = '';
  if (ok > 0) {
    html += `<span class="scrubber-value scrubber-value-ok">${okLabel} ${formatNumber(ok)}</span>`;
  }
  if (client > 0) {
    html += `<span class="scrubber-value scrubber-value-4xx">${clientLabel} ${formatNumber(client)}</span>`;
  }
  if (server > 0) {
    html += `<span class="scrubber-value scrubber-value-5xx">${serverLabel} ${formatNumber(server)}</span>`;
  }
  return html;
}

/** Build anomaly info HTML for scrubber */
export function buildAnomalyInfo(x) {
  const anomaly = getAnomalyAtX(x);
  if (!anomaly) {
    return null;
  }

  const detectedSteps = getDetectedSteps();
  const step = detectedSteps.find((s) => s.rank === anomaly.rank);
  const duration = formatDuration(anomaly.startTime, anomaly.endTime);
  const typeLabel = step?.type === 'spike' ? 'Spike' : 'Dip';
  const { ok: okLabel, client: clientLabel, server: serverLabel } = state.seriesLabels;
  let categoryLabel = okLabel;
  if (step?.category === 'red') {
    categoryLabel = serverLabel;
  } else if (step?.category === 'yellow') {
    categoryLabel = clientLabel;
  }

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
