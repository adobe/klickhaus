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
import { normalizeSampleRate, getSampledTable } from './time.js';

let chartNextSampleRate = null;

export function isChartTimeoutError(err) {
  return err?.category === 'timeout' || err?.type === 'TIMEOUT_EXCEEDED';
}

export function getChartSamplingConfig(sampleRate) {
  const rate = normalizeSampleRate(sampleRate);
  const multiplier = rate < 1 ? Math.round(1 / rate) : 1;
  return {
    table: getSampledTable(rate),
    mult: multiplier > 1 ? ` * ${multiplier}` : '',
  };
}

function formatSampleRateLabel(rate) {
  const normalizedRate = normalizeSampleRate(rate);
  if (!Number.isFinite(normalizedRate)) return '';
  if (normalizedRate >= 1) return 'full';
  return `${Math.round(normalizedRate * 100)}%`;
}

export function setChartRefineTarget(nextSampleRate = null) {
  chartNextSampleRate = Number.isFinite(nextSampleRate)
    ? normalizeSampleRate(nextSampleRate)
    : null;
  const button = document.getElementById('chartRefineBtn');
  if (!button) return;

  if (!Number.isFinite(chartNextSampleRate)) {
    button.hidden = true;
    button.removeAttribute('data-sample-rate');
    return;
  }

  const label = formatSampleRateLabel(chartNextSampleRate);
  const text = label === 'full' ? 'Load full data' : `Load ${label} data`;
  button.textContent = text;
  button.title = `${text} without a timeout`;
  button.hidden = false;
  button.dataset.sampleRate = String(chartNextSampleRate);
}

export function getChartRefineTarget() {
  return chartNextSampleRate;
}
