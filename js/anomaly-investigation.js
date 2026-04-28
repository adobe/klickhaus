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

/**
 * Breakdown-row investigation (ClickHouse facet vs baseline) is disabled.
 * Chart step detection + vertical anomaly bands remain in chart.js / step-detection.js.
 *
 * Stubs preserve the public API and css/investigation.css (row highlight styles) for a
 * future implementation. Re-wire investigateFacet in investigation-data.js and restore
 * logic here when ready.
 */

import { clearAllInvestigationCaches } from './investigation-data.js';

const ROW_HIGHLIGHT_CLASSES = [
  'investigation-highlight',
  'investigation-red',
  'investigation-yellow',
  'investigation-green',
  'investigation-blue',
];

function stripRowClasses(selector) {
  document.querySelectorAll(selector).forEach((el) => {
    el.classList.remove(...ROW_HIGHLIGHT_CLASSES);
    const statusColor = el.querySelector('.status-color');
    if (statusColor) { statusColor.removeAttribute('title'); }
  });
}

/**
 * @returns {string|null}
 */
export function getFocusedAnomalyId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('anomaly') || null;
}

/**
 * @param {string|null} anomalyId
 */
export function setFocusedAnomalyId(anomalyId) {
  const url = new URL(window.location);
  if (anomalyId) {
    url.searchParams.set('anomaly', anomalyId);
  } else {
    url.searchParams.delete('anomaly');
  }
  window.history.replaceState({}, '', url);
}

export function clearHighlights() {
  stripRowClasses('.investigation-highlight');
}

export async function investigateAnomalies() {
  window.anomalyIdsByRank = {};
  clearHighlights();
  return [];
}

export function getHighlightedDimensions() {
  return new Set();
}

export function invalidateInvestigationCache() {
  window.anomalyIdsByRank = {};
  clearHighlights();
  clearAllInvestigationCaches();
}

/** @returns {null} */
export function getInvestigationByAnomalyId() {
  return null;
}

/** @returns {null} */
export function getAnomalyIdByRank() {
  return null;
}

export function getLastInvestigationResults() {
  return [];
}

export function reapplyHighlightsIfCached() {}

export function hasCachedInvestigation() {
  return false;
}

export function clearSelectionHighlights() {
  stripRowClasses('.investigation-highlight.investigation-blue');
}

/**
 * STUB: previously compared a dragged time range to the rest of the chart via ClickHouse.
 * @returns {Promise<[]>}
 */
export async function investigateTimeRange() {
  return [];
}
