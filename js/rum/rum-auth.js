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
 * Authentication module for RUM dashboard pages.
 * Handles domain + domainkey credentials for bundles.aem.page API.
 * Separate from the ClickHouse auth in auth.js to avoid interference.
 */

const BUNDLES_API_BASE = 'https://bundles.aem.page';

export const RUM_CREDENTIALS_KEY = 'rum_credentials';

/**
 * Extract RUM credentials from URL search parameters.
 * @param {URLSearchParams} params
 * @returns {{ domain: string, domainkey: string } | null}
 */
export function getRumCredentialsFromUrl(params) {
  const domain = (params.get('domain') || '').trim();
  const domainkey = (params.get('domainkey') || '').trim();
  if (!domain || !domainkey) {
    return null;
  }
  return { domain, domainkey };
}

/**
 * Clear stored RUM credentials from both storage types.
 */
export function clearRumCredentials() {
  localStorage.removeItem(RUM_CREDENTIALS_KEY);
  sessionStorage.removeItem(RUM_CREDENTIALS_KEY);
}

/**
 * Store RUM credentials.
 * @param {{ domain: string, domainkey: string }} credentials
 * @param {boolean} [forgetMe=false] - If true, use sessionStorage instead of localStorage
 */
export function storeRumCredentials(credentials, forgetMe = false) {
  const storage = forgetMe ? sessionStorage : localStorage;
  clearRumCredentials();
  storage.setItem(RUM_CREDENTIALS_KEY, JSON.stringify(credentials));
}

/**
 * Parse stored credentials, returning null if invalid.
 * Cleans up invalid entries from storage.
 * @param {string} raw
 * @param {Storage} storage
 * @returns {{ domain: string, domainkey: string } | null}
 */
function parseStoredCredentials(raw, storage) {
  try {
    const creds = JSON.parse(raw);
    if (creds && creds.domain && creds.domainkey) {
      return creds;
    }
  } catch (err) {
    // Fall through to cleanup
  }
  storage.removeItem(RUM_CREDENTIALS_KEY);
  return null;
}

/**
 * Load stored RUM credentials from sessionStorage or localStorage.
 * Prefers sessionStorage (temporary credentials) over localStorage.
 * @returns {{ domain: string, domainkey: string } | null}
 */
export function loadRumCredentials() {
  const sessionStored = sessionStorage.getItem(RUM_CREDENTIALS_KEY);
  if (sessionStored) {
    const sessionCreds = parseStoredCredentials(sessionStored, sessionStorage);
    if (sessionCreds) {
      return sessionCreds;
    }
  }
  const localStored = localStorage.getItem(RUM_CREDENTIALS_KEY);
  if (localStored) {
    return parseStoredCredentials(localStored, localStorage);
  }
  return null;
}

/**
 * Pad a number with leading zero.
 * @param {number} n
 * @returns {string}
 */
function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Validate RUM credentials by making a test API call to bundles.aem.page.
 * Uses today's date (UTC) to build the test URL.
 * Returns true if the API responds with 200 or 404 (no data yet but valid key).
 * Returns false on 403 (invalid key) or network error.
 * @param {string} domain
 * @param {string} domainkey
 * @returns {Promise<boolean>}
 */
export async function validateRumCredentials(domain, domainkey) {
  try {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = pad(now.getUTCMonth() + 1);
    const d = pad(now.getUTCDate());
    const url = `${BUNDLES_API_BASE}/bundles/${domain}/${y}/${m}/${d}?domainkey=${encodeURIComponent(domainkey)}`;
    const response = await fetch(url);
    // 200 = valid data, 404 = no data for today but key is valid
    return response.status === 200 || response.status === 404;
  } catch (err) {
    return false;
  }
}
