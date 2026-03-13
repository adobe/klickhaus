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
 * Coralogix authentication management.
 * Implements OAuth2 Authorization Code + PKCE flow.
 */

import { CORALOGIX_CONFIG } from './config.js';

// Storage keys
const STORAGE_KEYS = {
  TOKEN: 'token',
  USER: 'auth_user',
  EXPIRES_AT: 'auth_expires_at',
  SELECTED_TEAM_ID: 'selectedTeamId',
  ALLOWED_TEAMS: 'oauth_allowed_teams',
  PKCE_VERIFIER: 'oauth_code_verifier',
  OAUTH_STATE: 'oauth_state',
  RETURN_URL: 'oauth_return_url',
};

// Refresh token is kept in memory only (never persisted) to reduce XSS exposure
let refreshTokenMemory = null;

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

function generateState() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

function getRedirectUri() {
  if (!CORALOGIX_CONFIG.redirectUri) {
    throw new Error('CX_REDIRECT_URI is required — set it to the registered OAuth callback URL');
  }
  return CORALOGIX_CONFIG.redirectUri;
}

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

function storeTokens(data) {
  if (data.access_token) {
    localStorage.setItem(STORAGE_KEYS.TOKEN, data.access_token);
  }
  if (data.refresh_token) {
    refreshTokenMemory = data.refresh_token;
  }
  if (data.id_token) {
    // Decode the JWT payload (no verification — just for display purposes)
    try {
      const payload = JSON.parse(atob(data.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({
        email: payload.email,
        name: payload.name || payload.preferred_username,
        sub: payload.sub,
      }));
    } catch (e) {
      // Ignore malformed id_token
    }
  }
  if (data.expires_in) {
    localStorage.setItem(STORAGE_KEYS.EXPIRES_AT, (Date.now() + data.expires_in * 1000).toString());
  }
}

function clearTokens() {
  Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
  localStorage.removeItem(STORAGE_KEYS.ALLOWED_TEAMS);
  refreshTokenMemory = null;
}

// ---------------------------------------------------------------------------
// Public API — credential accessors (used by interceptor.js and tests)
// ---------------------------------------------------------------------------

export function getToken() {
  return localStorage.getItem(STORAGE_KEYS.TOKEN);
}

export function getSelectedTeamId() {
  const teamId = localStorage.getItem(STORAGE_KEYS.SELECTED_TEAM_ID);
  return teamId ? parseInt(teamId, 10) : null;
}

export function getTeamId() {
  return getSelectedTeamId();
}

export function isLoggedIn() {
  return getToken() !== null;
}

export function getCurrentUser() {
  const raw = localStorage.getItem(STORAGE_KEYS.USER);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * Force logout when authentication fails unrecoverably.
 * @param {string} reason
 */
export function forceLogout(reason) {
  clearTokens();
  window.dispatchEvent(new CustomEvent('auth-logout', { detail: { reason } }));
}

// ---------------------------------------------------------------------------
// Backward-compat helpers (used by tests via setAuthCredentials)
// ---------------------------------------------------------------------------

export function setAuthCredentials(token, teamId = null) {
  if (token) localStorage.setItem(STORAGE_KEYS.TOKEN, token);
  if (teamId) localStorage.setItem(STORAGE_KEYS.SELECTED_TEAM_ID, teamId.toString());
}

export function clearAuthCredentials() {
  localStorage.removeItem(STORAGE_KEYS.TOKEN);
  localStorage.removeItem(STORAGE_KEYS.SELECTED_TEAM_ID);
}

export function hasAuthCredentials() {
  return getToken() !== null;
}

// ---------------------------------------------------------------------------
// OAuth2 Authorization Code + PKCE flow
// ---------------------------------------------------------------------------

/**
 * Start the OAuth2 login flow.
 * Redirects the browser to the Coralogix authorization endpoint.
 */
export async function login() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateState();

  localStorage.setItem(STORAGE_KEYS.PKCE_VERIFIER, verifier);
  localStorage.setItem(STORAGE_KEYS.OAUTH_STATE, state);
  localStorage.setItem(STORAGE_KEYS.RETURN_URL, window.location.href);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CORALOGIX_CONFIG.clientId,
    redirect_uri: getRedirectUri(),
    scope: 'openid profile email offline_access',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });

  window.location.href = `${CORALOGIX_CONFIG.authorizationEndpoint}?${params}`;
}

/**
 * Fetch user info (including allowed teams) and store in localStorage.
 * @returns {Promise<Array>} allowed_teams list
 */
async function fetchUserInfo() {
  const token = getToken();
  if (!token) return [];

  const response = await fetch(`${CORALOGIX_CONFIG.baseApiUrl}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) return [];

  const data = await response.json();

  localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({
    email: data.email,
    sub: data.sub,
    givenName: data.given_name,
    familyName: data.family_name,
  }));

  const teams = data.allowed_teams || [];
  localStorage.setItem(STORAGE_KEYS.ALLOWED_TEAMS, JSON.stringify(teams));
  return teams;
}

/**
 * Get the list of teams the user is allowed to access.
 * @returns {Array<{team_id: number, team_name: string}>}
 */
export function getAllowedTeams() {
  const raw = localStorage.getItem(STORAGE_KEYS.ALLOWED_TEAMS);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

/**
 * Set the active team ID.
 * @param {number} teamId
 */
export function setSelectedTeamId(teamId) {
  localStorage.setItem(STORAGE_KEYS.SELECTED_TEAM_ID, teamId.toString());
}

/**
 * Handle the OAuth2 callback — exchange the authorization code for tokens.
 * Called automatically by initAuth() when a `code` param is present in the URL.
 * @returns {Promise<boolean>} True on success
 */
export async function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const returnedState = params.get('state');

  if (!code) return false;

  const savedState = localStorage.getItem(STORAGE_KEYS.OAUTH_STATE);
  if (!savedState || returnedState !== savedState) {
    // eslint-disable-next-line no-console
    console.warn('OAuth state mismatch — redirecting to restart login', { returnedState, savedState });
    localStorage.removeItem(STORAGE_KEYS.PKCE_VERIFIER);
    localStorage.removeItem(STORAGE_KEYS.OAUTH_STATE);
    // Redirect to the original page (not login()) to avoid storing the callback URL
    // as the return URL and creating an infinite redirect loop
    const returnUrl = localStorage.getItem(STORAGE_KEYS.RETURN_URL) || '/';
    localStorage.removeItem(STORAGE_KEYS.RETURN_URL);
    window.location.replace(returnUrl);
    return null;
  }

  const verifier = localStorage.getItem(STORAGE_KEYS.PKCE_VERIFIER);

  const response = await fetch(CORALOGIX_CONFIG.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CORALOGIX_CONFIG.clientId,
      redirect_uri: getRedirectUri(),
      code,
      code_verifier: verifier,
      token_endpoint_auth_method: 'none',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${text}`);
  }

  const data = await response.json();
  storeTokens(data);

  // Fetch user info and store allowed teams for the team picker
  await fetchUserInfo();

  // Clean up PKCE state
  localStorage.removeItem(STORAGE_KEYS.PKCE_VERIFIER);
  localStorage.removeItem(STORAGE_KEYS.OAUTH_STATE);

  // Return the original page URL so the callback page can redirect back
  const returnUrl = localStorage.getItem(STORAGE_KEYS.RETURN_URL) || '/';
  localStorage.removeItem(STORAGE_KEYS.RETURN_URL);
  return returnUrl;
}

/**
 * Initialize authentication.
 * If the URL contains a `code` param, handles the OAuth callback.
 * Otherwise, checks for an existing valid session.
 * @returns {Promise<boolean>} True if authenticated
 */
export async function initAuth() {
  if (new URLSearchParams(window.location.search).has('code')) {
    try {
      await handleOAuthCallback();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('OAuth callback failed:', e);
      return false;
    }
  }

  // If we have a token but userinfo has never been fetched (key absent in localStorage),
  // fetch it now so the team selector can be populated.
  // Use the raw key check (not getAllowedTeams()) so we don't re-fetch on every page load
  // when the user has zero teams or a single team.
  if (getToken() && localStorage.getItem(STORAGE_KEYS.ALLOWED_TEAMS) === null) {
    await fetchUserInfo();
  }

  return getToken() !== null;
}

/**
 * Refresh the access token using the stored refresh token.
 * @returns {Promise<string>} New access token
 */
export async function refreshToken() {
  const storedRefreshToken = refreshTokenMemory;
  if (!storedRefreshToken) throw new Error('No refresh token available');

  const response = await fetch(CORALOGIX_CONFIG.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CORALOGIX_CONFIG.clientId,
      refresh_token: storedRefreshToken,
      token_endpoint_auth_method: 'none',
    }),
  });

  if (!response.ok) throw new Error('Token refresh failed');

  const data = await response.json();
  storeTokens(data);
  return data.access_token;
}

/**
 * Logout — revoke the refresh token and clear local session.
 */
export async function logout() {
  const storedRefreshToken = refreshTokenMemory;

  if (storedRefreshToken) {
    try {
      await fetch(CORALOGIX_CONFIG.revocationEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CORALOGIX_CONFIG.clientId,
          token: storedRefreshToken,
          token_endpoint_auth_method: 'none',
        }),
      });
    } catch (e) {
      // Ignore revocation errors
    }
  }

  clearTokens();
}

/**
 * Refresh the token if it is expired or within 60 seconds of expiry.
 * Call this before making authenticated requests.
 */
export async function ensureFreshToken() {
  const expiresAt = localStorage.getItem(STORAGE_KEYS.EXPIRES_AT);
  if (!expiresAt) return;
  if (Date.now() > parseInt(expiresAt, 10) - 60_000) {
    await refreshToken();
  }
}
