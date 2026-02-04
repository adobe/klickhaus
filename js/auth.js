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
import { state } from './state.js';
import { query } from './api.js';

const CREDENTIALS_KEY = 'clickhouse_credentials';

// DOM element references (set by main.js)
let elements = {};

export function setElements(els) {
  elements = els;
}

function clearStoredCredentials() {
  localStorage.removeItem(CREDENTIALS_KEY);
  sessionStorage.removeItem(CREDENTIALS_KEY);
}

function storeCredentials(credentials, forgetMe) {
  const storage = forgetMe ? sessionStorage : localStorage;
  clearStoredCredentials();
  storage.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
}

function parseStoredCredentials(raw, storage) {
  try {
    const creds = JSON.parse(raw);
    if (creds && creds.user && creds.password) {
      return creds;
    }
  } catch (err) {
    // Fall through to cleanup invalid stored credentials.
  }
  storage.removeItem(CREDENTIALS_KEY);
  return null;
}

export function loadStoredCredentials() {
  const sessionStored = sessionStorage.getItem(CREDENTIALS_KEY);
  if (sessionStored) {
    const sessionCredentials = parseStoredCredentials(sessionStored, sessionStorage);
    if (sessionCredentials) {
      return sessionCredentials;
    }
  }
  const localStored = localStorage.getItem(CREDENTIALS_KEY);
  if (localStored) {
    return parseStoredCredentials(localStored, localStorage);
  }
  return null;
}

export async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const forgetMe = document.getElementById('forgetMe')?.checked;

  // Clear any stale stored credentials before attempting login
  // User input always takes precedence
  clearStoredCredentials();
  state.credentials = { user: username, password };

  try {
    // Test connection
    await query('SELECT 1');
    storeCredentials(state.credentials, forgetMe);
    elements.loginError.classList.remove('visible');
    // Dispatch event for dashboard to sync UI and load data
    window.dispatchEvent(new CustomEvent('login-success'));
  } catch (err) {
    state.credentials = null;
    elements.loginError.textContent = 'Authentication failed. Please check your credentials.';
    elements.loginError.classList.add('visible');
  }
}

export function showLogin() {
  elements.loginSection.classList.remove('hidden');
  elements.dashboardSection.classList.remove('visible');
}

export function handleLogout() {
  state.credentials = null;

  // Clear stored credentials and session-related localStorage entries
  clearStoredCredentials();
  localStorage.removeItem('hostAutocompleteSuggestions');

  // Clear all investigation caches (keys starting with 'anomaly_investigation_')
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith('anomaly_investigation_')) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));

  showLogin();
}

export function handleAuthError() {
  state.credentials = null;
  clearStoredCredentials();
  elements.loginError.textContent = 'Session expired. Please sign in again.';
  elements.loginError.classList.add('visible');
  showLogin();
}

export function showDashboard() {
  elements.loginSection.classList.add('hidden');
  elements.dashboardSection.classList.add('visible');
  // Dispatch event for autocomplete loading
  window.dispatchEvent(new CustomEvent('dashboard-shown'));
}

// Listen for auth errors from api.js
window.addEventListener('auth-error', handleAuthError);
