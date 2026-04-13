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

import { initDashboard } from './dashboard-init.js';
import { state } from './state.js';
import { showLogin, handleAuthError } from './auth.js';
import {
  getRumCredentialsFromUrl,
  loadRumCredentials,
  storeRumCredentials,
  clearRumCredentials,
  validateRumCredentials,
} from './rum/rum-auth.js';
import { fetchRumData } from './rum/rum-adapter.js';
import { renderChart } from './chart.js';
import { renderBreakdownTable } from './breakdowns/render.js';
import { isRequestCurrent } from './request-context.js';
import {
  RUM_BREAKDOWNS,
  getRumDateRange,
  buildDataChunksFilters,
  renderKeyMetrics,
  populateRumTimeRangeSelect,
} from './rum/rum-traffic-utils.js';

/**
 * RUM credentials for the current session.
 * Stored separately from ClickHouse credentials to avoid interference.
 */
let rumCredentials = null;

/**
 * Cached data from the most recent fetchRumData call.
 * Shared between loadRumTimeSeries and loadRumBreakdowns
 * since both consume data from the same API call.
 */
let cachedRumResult = null;

/**
 * Fetch RUM data and render the time series chart.
 * Called by dashboard-init via the pluggable loadTimeSeries callback.
 * @param {object} requestContext - From startRequestContext()
 */
async function loadRumTimeSeries(requestContext) {
  const { requestId, scope } = requestContext;
  const isCurrent = () => isRequestCurrent(requestId, scope);

  // Invalidate cache so concurrent loadRumBreakdowns fetches fresh data
  cachedRumResult = null;

  if (!rumCredentials) {
    return;
  }

  const { startDate, endDate } = getRumDateRange(state.timeRange);
  const filters = buildDataChunksFilters(state.filters);

  try {
    const result = await fetchRumData({
      domain: rumCredentials.domain,
      domainkey: rumCredentials.domainkey,
      startDate,
      endDate,
      viewType: 'traffic',
      filters,
    });

    if (!isCurrent()) {
      return;
    }

    if (result.error) {
      if (result.error === 'auth') {
        window.dispatchEvent(new CustomEvent('auth-error'));
      }
      return;
    }

    // Cache result for loadRumBreakdowns (if it hasn't fetched yet)
    cachedRumResult = result;
    state.chartData = result.chartData;
    renderChart(result.chartData);

    const overlay = document.getElementById('keyMetricsOverlay');
    renderKeyMetrics(result.totals, overlay);
  } catch (err) {
    if (!isCurrent()) {
      return;
    }
    // eslint-disable-next-line no-console
    console.error('RUM time series error:', err);
  }
}

/**
 * Render breakdown facet tables from RUM data.
 * Called by dashboard-init via the pluggable loadBreakdowns callback.
 * @param {object} requestContext - From startRequestContext()
 */
async function loadRumBreakdowns(requestContext) {
  const { requestId, scope } = requestContext;
  const isCurrent = () => isRequestCurrent(requestId, scope);

  let result = cachedRumResult;

  // If no cached data, fetch independently (rare — only if breakdowns start
  // before time series finishes, which shouldn't happen with current flow)
  if (!result && rumCredentials) {
    const { startDate, endDate } = getRumDateRange(state.timeRange);
    const filters = buildDataChunksFilters(state.filters);
    result = await fetchRumData({
      domain: rumCredentials.domain,
      domainkey: rumCredentials.domainkey,
      startDate,
      endDate,
      viewType: 'traffic',
      filters,
    });
  }

  if (!isCurrent() || !result || result.error) {
    return;
  }

  for (const bd of RUM_BREAKDOWNS) {
    const breakdownData = result.breakdowns[bd.facetName] || [];
    const card = document.getElementById(bd.id);
    if (card) {
      // Compute totals for this breakdown (sum of all rows)
      const totals = {
        cnt: breakdownData.reduce((sum, row) => sum + row.cnt, 0),
        cnt_ok: breakdownData.reduce((sum, row) => sum + row.cnt_ok, 0),
        cnt_4xx: breakdownData.reduce((sum, row) => sum + row.cnt_4xx, 0),
        cnt_5xx: breakdownData.reduce((sum, row) => sum + row.cnt_5xx, 0),
      };

      renderBreakdownTable(
        bd.id,
        breakdownData.slice(0, state.topN),
        totals,
        bd.col,
        null, // linkPrefix
        null, // linkSuffix
        null, // linkFn
        0, // elapsed
        null, // dimPrefixes
        null, // dimFormatFn
        null, // summaryRatio
        null, // summaryLabel
        null, // summaryColor
        null, // modeToggle
        false, // isContinuous
        null, // filterCol
        null, // filterValueFn
        null, // filterOp
      );
    }
  }
}

/**
 * Handle RUM login form submission.
 * Validates domain + domainkey by making a test API call,
 * then dispatches 'login-success' on success.
 * @param {Event} e
 */
async function handleRumLogin(e) {
  e.preventDefault();
  const domain = document.getElementById('domain').value.trim();
  const domainkey = document.getElementById('domainkey').value.trim();
  const forgetMe = document.getElementById('forgetMe')?.checked;
  const loginError = document.getElementById('loginError');

  if (!domain || !domainkey) {
    loginError.textContent = 'Please enter both domain and domain key.';
    loginError.classList.add('visible');
    return;
  }

  loginError.classList.remove('visible');

  try {
    const valid = await validateRumCredentials(domain, domainkey);
    if (valid) {
      rumCredentials = { domain, domainkey };
      // Store as a credential marker so dashboard-init treats user as authenticated
      state.credentials = { user: domain, password: domainkey };
      storeRumCredentials(rumCredentials, forgetMe);
      loginError.classList.remove('visible');
      window.dispatchEvent(new CustomEvent('login-success'));
    } else {
      loginError.textContent = 'Authentication failed. Please check your domain and domain key.';
      loginError.classList.add('visible');
    }
  } catch (err) {
    loginError.textContent = 'Connection error. Please try again.';
    loginError.classList.add('visible');
  }
}

/**
 * Handle RUM logout. Clears RUM credentials and shows login form.
 */
function handleRumLogout() {
  rumCredentials = null;
  state.credentials = null;
  cachedRumResult = null;
  clearRumCredentials();
  showLogin();
}

/**
 * Initialize RUM authentication flow.
 * Checks URL params first, then stored credentials.
 * Dispatches 'login-success' if credentials are found and valid.
 */
function initRumAuth() {
  // 1. Check URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const urlCreds = getRumCredentialsFromUrl(urlParams);

  if (urlCreds) {
    rumCredentials = urlCreds;
    state.credentials = { user: urlCreds.domain, password: urlCreds.domainkey };
    storeRumCredentials(urlCreds);
    // Auto-authenticate — dispatch login-success after init completes
    setTimeout(() => window.dispatchEvent(new CustomEvent('login-success')), 0);
    return;
  }

  // 2. Check stored credentials
  const storedCreds = loadRumCredentials();
  if (storedCreds) {
    rumCredentials = storedCreds;
    state.credentials = { user: storedCreds.domain, password: storedCreds.domainkey };
    // Auto-authenticate — dispatch login-success after init completes
    setTimeout(() => window.dispatchEvent(new CustomEvent('login-success')), 0);
  }

  // 3. No credentials found — show login form
  // Login form is already visible by default (dashboard-init handles this)
}

// Remove ClickHouse auth-error handler — RUM pages don't use ClickHouse,
// so ClickHouse auth failures should be silently ignored.
window.removeEventListener('auth-error', handleAuthError);

// Wire up the login form for RUM auth
document.getElementById('loginForm').addEventListener('submit', handleRumLogin);

// Initialize authentication
initRumAuth();

// Hide the logs view toggle (RUM pages don't have SQL-based logs)
const viewToggleBtn = document.getElementById('viewToggleBtn');
if (viewToggleBtn) {
  viewToggleBtn.style.display = 'none';
}

// Initialize the dashboard with RUM-specific config
initDashboard({
  title: 'RUM Traffic',
  skipDefaultAuth: true,
  skipLogs: true,
  onLogout: handleRumLogout,
  seriesLabels: { ok: 'good', client: 'needs improvement', server: 'poor' },
  loadTimeSeries: loadRumTimeSeries,
  loadBreakdowns: loadRumBreakdowns,
});

// Replace time range options with RUM-specific ranges (week/month/year)
const timeRangeSelect = document.getElementById('timeRange');
state.timeRange = populateRumTimeRangeSelect(timeRangeSelect, state.timeRange);
