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

/**
 * RUM credentials for the current session.
 * Stored separately from ClickHouse credentials to avoid interference.
 */
let rumCredentials = null;

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

// Placeholder data loading — the rum-traffic-view feature will replace these
// with actual bundles.aem.page data loading via rum-adapter.
async function loadRumTimeSeries() {
  // No-op: will be implemented by rum-traffic-view feature
}

async function loadRumBreakdowns() {
  // No-op: will be implemented by rum-traffic-view feature
}

// Initialize the dashboard with RUM-specific config
initDashboard({
  title: 'RUM Traffic',
  skipDefaultAuth: true,
  onLogout: handleRumLogout,
  seriesLabels: { ok: 'good', client: 'needs improvement', server: 'poor' },
  loadTimeSeries: loadRumTimeSeries,
  loadBreakdowns: loadRumBreakdowns,
});
