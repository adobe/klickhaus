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
 * Utility functions for the RUM CLS view.
 * Defines the full facet set and re-exports interpolation for CWV measurements.
 */

export {
  getRumDateRange,
  buildDataChunksFilters,
  renderKeyMetrics,
  populateRumTimeRangeSelect,
  showDashboardError,
  hideDashboardError,
} from './rum-traffic-utils.js';

export { interpolateCwvGaps } from './rum-lcp-utils.js';

/**
 * Full facet breakdown definitions for the CLS view.
 * Maps DataChunks facet names to breakdown card IDs and display labels.
 */
export const CLS_BREAKDOWNS = [
  { id: 'breakdown-url', facetName: 'url', col: 'url' },
  { id: 'breakdown-userAgent', facetName: 'userAgent', col: 'userAgent' },
  { id: 'breakdown-checkpoint', facetName: 'checkpoint', col: 'checkpoint' },
  { id: 'breakdown-enterSource', facetName: 'enterSource', col: 'enterSource' },
  { id: 'breakdown-clickTarget', facetName: 'clickTarget', col: 'clickTarget' },
  { id: 'breakdown-mediaTarget', facetName: 'mediaTarget', col: 'mediaTarget' },
  { id: 'breakdown-viewblock', facetName: 'viewblock', col: 'viewblock' },
  { id: 'breakdown-navigate', facetName: 'navigate', col: 'navigate' },
  { id: 'breakdown-language', facetName: 'language', col: 'language' },
  { id: 'breakdown-accessibility', facetName: 'accessibility', col: 'accessibility' },
  { id: 'breakdown-consent', facetName: 'consent', col: 'consent' },
  { id: 'breakdown-loadresource', facetName: 'loadresource', col: 'loadresource' },
  {
    id: 'breakdown-acquisitionSource',
    facetName: 'acquisitionSource',
    col: 'acquisitionSource',
  },
  { id: 'breakdown-error', facetName: 'error', col: 'error' },
  { id: 'breakdown-four04', facetName: 'four04', col: 'four04' },
  { id: 'breakdown-redirect', facetName: 'redirect', col: 'redirect' },
];
