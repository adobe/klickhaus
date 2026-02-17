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
 * Handles JWT token-based authentication with Coralogix API.
 */

import { CORALOGIX_CONFIG } from './config.js';

// Storage keys
const STORAGE_KEYS = {
  TOKEN: 'token',
  REFRESH_TOKEN: 'auth_refresh_token',
  USER: 'auth_user',
  EXPIRES_AT: 'auth_expires_at',
  SELECTED_TEAM_ID: 'selectedTeamId',
};

/**
 * Get current bearer token
 * @returns {string|null}
 */
export function getToken() {
  return localStorage.getItem(STORAGE_KEYS.TOKEN);
}

/**
 * Store authentication response data in localStorage
 * @param {Object} data - Response data from login API
 */
function storeAuthData(data) {
  if (data.token) {
    localStorage.setItem(STORAGE_KEYS.TOKEN, data.token);
  }
  if (data.refreshToken) {
    localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, data.refreshToken);
  }
  if (data.user) {
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(data.user));
  }
  if (data.expiresIn) {
    const expiresAt = Date.now() + (data.expiresIn * 1000);
    localStorage.setItem(STORAGE_KEYS.EXPIRES_AT, expiresAt.toString());
  }
}

/**
 * Initialize authentication - check for existing session
 * @returns {Promise<boolean>} True if session is valid
 */
export async function initAuth() {
  const token = localStorage.getItem(STORAGE_KEYS.TOKEN);
  if (!token) {
    return false;
  }

  // For now, assume token is valid if it exists
  // In production, you'd validate with the server
  return true;
}

/**
 * Login with username and password
 * @param {Object} credentials
 * @param {string} credentials.username - Email address
 * @param {string} credentials.password - Password
 * @returns {Promise<Object>} User object
 */
export async function login({ username, password }) {
  const baseUrl = CORALOGIX_CONFIG.baseApiUrl || 'https://api.coralogix.com';
  const loginUrl = `${baseUrl}/api/v1/user/login`;

  // Build headers with optional captcha bypass token
  const headers = {
    'Content-Type': 'application/json',
  };

  // Add testtoken header for reCAPTCHA bypass in development
  if (CORALOGIX_CONFIG.skipRecaptcha && CORALOGIX_CONFIG.captchaBypassToken) {
    headers.testtoken = CORALOGIX_CONFIG.captchaBypassToken;
  }

  const response = await fetch(loginUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      username,
      password,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = 'Authentication failed';

    try {
      const errorData = JSON.parse(errorText);
      errorMessage = errorData.message || errorData.error || errorMessage;
    } catch (e) {
      // Use default error message
    }

    throw new Error(errorMessage);
  }

  const data = await response.json();

  // Store authentication data
  storeAuthData(data);

  // Set team ID from config
  const teamId = CORALOGIX_CONFIG.teamId || window.ENV?.CX_TEAM_ID || '7667';
  localStorage.setItem(STORAGE_KEYS.SELECTED_TEAM_ID, teamId);

  return data.user || { email: username };
}

/**
 * Logout - clear session
 * @returns {Promise<void>}
 */
export async function logout() {
  const baseUrl = CORALOGIX_CONFIG.baseApiUrl || 'https://api.coralogix.com';
  const logoutUrl = `${baseUrl}/api/v1/user/logout`;
  const token = getToken();

  // Call logout API (best effort, don't block on failure)
  if (token) {
    try {
      await fetch(logoutUrl, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (e) {
      // Ignore logout API errors
    }
  }

  // Clear local storage
  localStorage.removeItem(STORAGE_KEYS.TOKEN);
  localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.USER);
  localStorage.removeItem(STORAGE_KEYS.EXPIRES_AT);
  localStorage.removeItem(STORAGE_KEYS.SELECTED_TEAM_ID);
}

/**
 * Get teams for the current user
 * @returns {Promise<Array>} List of teams
 */
export async function getTeams() {
  const baseUrl = CORALOGIX_CONFIG.baseApiUrl || 'https://api.coralogix.com';
  const teamsUrl = `${baseUrl}/api/v1/user/team`;
  const token = getToken();

  if (!token) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(teamsUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch teams');
  }

  const data = await response.json();
  return data.teams || [];
}

/**
 * Get selected team ID
 * @returns {number|null}
 */
export function getSelectedTeamId() {
  const teamId = localStorage.getItem(STORAGE_KEYS.SELECTED_TEAM_ID);
  return teamId ? parseInt(teamId, 10) : null;
}

/**
 * Get team ID (alias for getSelectedTeamId)
 * @returns {number|null}
 */
export function getTeamId() {
  return getSelectedTeamId();
}

/**
 * Check if user is logged in
 * @returns {boolean}
 */
export function isLoggedIn() {
  return getToken() !== null;
}

/**
 * Get current user
 * @returns {Object|null}
 */
export function getCurrentUser() {
  const userJson = localStorage.getItem(STORAGE_KEYS.USER);
  if (!userJson) return null;
  try {
    return JSON.parse(userJson);
  } catch (e) {
    return null;
  }
}

/**
 * Refresh the authentication token
 * @returns {Promise<string>} New token
 */
export async function refreshToken() {
  const baseUrl = CORALOGIX_CONFIG.baseApiUrl || 'https://api.coralogix.com';
  const refreshUrl = `${baseUrl}/api/v1/user/refresh`;
  const refreshTokenValue = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);

  if (!refreshTokenValue) {
    throw new Error('No refresh token available');
  }

  const response = await fetch(refreshUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      refreshToken: refreshTokenValue,
    }),
  });

  if (!response.ok) {
    throw new Error('Token refresh failed');
  }

  const data = await response.json();

  if (data.token) {
    localStorage.setItem(STORAGE_KEYS.TOKEN, data.token);
  }
  if (data.refreshToken) {
    localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, data.refreshToken);
  }

  return data.token;
}

/**
 * Force logout when authentication fails
 * @param {string} reason - The reason for logout
 */
export function forceLogout(reason) {
  // Clear all auth data
  localStorage.removeItem(STORAGE_KEYS.TOKEN);
  localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.USER);
  localStorage.removeItem(STORAGE_KEYS.EXPIRES_AT);
  localStorage.removeItem(STORAGE_KEYS.SELECTED_TEAM_ID);

  // Dispatch logout event
  window.dispatchEvent(new CustomEvent('auth-logout', {
    detail: { reason },
  }));
}

/**
 * Set authentication credentials (for backward compatibility)
 * @param {string} token - Bearer token
 * @param {number|null} teamId - Team ID
 */
export function setAuthCredentials(token, teamId = null) {
  if (token) {
    localStorage.setItem(STORAGE_KEYS.TOKEN, token);
  }
  if (teamId) {
    localStorage.setItem(STORAGE_KEYS.SELECTED_TEAM_ID, teamId.toString());
  }
}

/**
 * Clear authentication credentials
 */
export function clearAuthCredentials() {
  localStorage.removeItem(STORAGE_KEYS.TOKEN);
  localStorage.removeItem(STORAGE_KEYS.SELECTED_TEAM_ID);
}

/**
 * Check if authentication credentials are set
 * @returns {boolean}
 */
export function hasAuthCredentials() {
  return getToken() !== null;
}
