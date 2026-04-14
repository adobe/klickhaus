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
 * Cross-page navigation for RUM dashboard views.
 * Renders a navigation bar with links to Traffic, LCP, CLS, and INP views.
 * Preserves URL state (domain, domainkey, time range, filters) across navigation.
 * Also manages checkpoint-specific sub-facet visibility.
 */

import { state } from '../state.js';

/**
 * Comprehensive list of all RUM breakdown facet definitions across all views.
 * Used to set state.breakdowns so that parseFilter() in url-state.js accepts
 * RUM-specific filter columns (e.g., 'url', 'checkpoint', 'userAgent') when
 * loading filters from URL parameters. Without this, filters are rejected
 * because the default SQL-based breakdown columns don't include RUM facet names.
 *
 * This is the union of:
 * - Traffic core facets (url, userAgent, checkpoint)
 * - Traffic checkpoint subfacets (clickSource, clickTarget, mediaSource, mediaTarget)
 * - CWV view facets (enterSource, viewblock, navigate, language, accessibility,
 *   consent, loadresource, acquisitionSource, error, four04, redirect)
 */
export const ALL_RUM_BREAKDOWNS = [
  { id: 'breakdown-url', facetName: 'url', col: 'url' },
  { id: 'breakdown-userAgent', facetName: 'userAgent', col: 'userAgent' },
  { id: 'breakdown-checkpoint', facetName: 'checkpoint', col: 'checkpoint' },
  { id: 'breakdown-enterSource', facetName: 'enterSource', col: 'enterSource' },
  { id: 'breakdown-clickSource', facetName: 'clickSource', col: 'clickSource' },
  { id: 'breakdown-clickTarget', facetName: 'clickTarget', col: 'clickTarget' },
  { id: 'breakdown-mediaSource', facetName: 'mediaSource', col: 'mediaSource' },
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

/**
 * RUM view definitions.
 * Each view maps to a separate HTML page with its own entry point JS.
 */
export const RUM_VIEWS = [
  { id: 'traffic', href: 'rum-traffic.html', label: 'Traffic' },
  { id: 'lcp', href: 'rum-lcp.html', label: 'LCP' },
  { id: 'cls', href: 'rum-cls.html', label: 'CLS' },
  { id: 'inp', href: 'rum-inp.html', label: 'INP' },
];

/**
 * URL parameters that should be preserved across navigation.
 * These cover domain credentials, time range, filters, and facet preferences.
 */
const PRESERVED_PARAMS = [
  'domain',
  'domainkey',
  't',
  'filters',
  'n',
  'host',
  'pf',
  'hf',
];

/**
 * Build a navigation URL for a target page, preserving relevant URL state.
 * @param {string} targetHref - The target page filename (e.g., 'rum-lcp.html')
 * @param {URLSearchParams} currentParams - Current page URL parameters
 * @returns {string} Full URL with preserved parameters
 */
export function buildNavUrl(targetHref, currentParams) {
  const params = new URLSearchParams();

  for (const key of PRESERVED_PARAMS) {
    const value = currentParams.get(key);
    if (value) {
      params.set(key, value);
    }
  }

  const qs = params.toString();
  return qs ? `${targetHref}?${qs}` : targetHref;
}

/**
 * Render the RUM navigation bar into the given container.
 * Highlights the current view with an active class.
 * Navigation links use click handlers to read the current URL state
 * at click time, ensuring time range and filter changes are captured.
 *
 * @param {HTMLElement|null} container - The nav element to render into
 * @param {string} currentView - Current view ID ('traffic', 'lcp', 'cls', 'inp')
 * @param {URLSearchParams} [params] - URL params for initial href (defaults to current page URL)
 */
export function renderRumNav(container, currentView, params) {
  if (!container) {
    return;
  }

  const currentParams = params || new URLSearchParams(window.location.search);

  const nav = container;
  nav.classList.add('rum-nav');
  nav.innerHTML = '';

  for (const view of RUM_VIEWS) {
    const link = document.createElement('a');
    link.className = 'rum-nav-link';
    link.textContent = view.label;
    link.href = buildNavUrl(view.href, currentParams);

    if (view.id === currentView) {
      link.classList.add('active');
    }

    // Update href at click time to capture latest state changes.
    // Merges state.extraUrlParams (domain/domainkey) since saveStateToURL
    // may have rebuilt the URL without them.
    link.addEventListener('click', () => {
      const liveParams = new URLSearchParams(window.location.search);
      if (state.extraUrlParams) {
        for (const [key, value] of Object.entries(state.extraUrlParams)) {
          if (value && !liveParams.has(key)) {
            liveParams.set(key, value);
          }
        }
      }
      link.href = buildNavUrl(view.href, liveParams);
    });

    nav.appendChild(link);
  }
}

/**
 * Mapping of checkpoint filter values to their sub-facet card IDs.
 * When a checkpoint filter is active, these sub-facet cards become visible.
 */
const CHECKPOINT_SUBFACETS = {
  click: ['breakdown-clickSource', 'breakdown-clickTarget'],
  viewmedia: ['breakdown-mediaSource', 'breakdown-mediaTarget'],
};

/**
 * Update checkpoint sub-facet visibility based on active filters.
 * When a checkpoint filter is active, shows the corresponding sub-facet cards.
 * When no checkpoint filter is active, hides all sub-facet cards.
 *
 * @param {Array<{col: string, value: string, exclude: boolean}>} filters - Active filters
 */
export function updateCheckpointSubfacets(filters) {
  const subfacetCards = document.querySelectorAll('.checkpoint-subfacet');
  if (subfacetCards.length === 0) {
    return;
  }

  // Find active checkpoint filters (non-exclude only)
  const activeCheckpoints = filters
    .filter((f) => f.col === 'checkpoint' && !f.exclude)
    .map((f) => f.value);

  // Collect all sub-facet IDs that should be visible
  const visibleIds = new Set();
  for (const cp of activeCheckpoints) {
    const ids = CHECKPOINT_SUBFACETS[cp];
    if (ids) {
      ids.forEach((id) => visibleIds.add(id));
    }
  }

  // Show/hide sub-facet cards
  for (const card of subfacetCards) {
    card.style.display = visibleIds.has(card.id) ? '' : 'none';
  }
}
