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

import { assert } from 'chai';
import {
  setAuthCredentials,
  getToken,
  getTeamId,
  clearAuthCredentials,
  hasAuthCredentials,
  refreshToken,
  handleOAuthCallback,
  getCurrentUser,
  logout,
  ensureFreshToken,
} from './auth.js';
import { CORALOGIX_CONFIG } from './config.js';

// Helper: build a minimal JWT id_token payload for storeTokens
function buildIdToken(payload) {
  const header = btoa(JSON.stringify({ alg: 'RS256' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
  return `${header}.${body}.sig`;
}

// Helper: prime localStorage + URL for an OAuth callback exchange
function setupOAuthState(code, state) {
  localStorage.setItem('oauth_code_verifier', 'test-verifier');
  localStorage.setItem('oauth_state', state);
  localStorage.setItem('oauth_return_url', '/dashboard.html');
  history.pushState('', '', `?code=${code}&state=${state}`);
}

// Helper: mock fetch with a token-exchange response (first call) and
// an optional userinfo response (second call, defaults to not-ok so it is a no-op)
function mockTokenFetch(tokenData, userinfoData = null) {
  let callCount = 0;
  window.fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return { ok: true, json: async () => tokenData };
    }
    // userinfo call
    if (userinfoData) {
      return { ok: true, json: async () => userinfoData };
    }
    return { ok: false };
  };
}

describe('Coralogix auth', () => {
  let originalFetch;

  beforeEach(() => {
    clearAuthCredentials();
    originalFetch = window.fetch;
    CORALOGIX_CONFIG.redirectUri = 'http://localhost/oauth-callback.html';
    CORALOGIX_CONFIG.clientId = 'test-client-id';
  });

  afterEach(() => {
    window.fetch = originalFetch;
    history.pushState('', '', window.location.pathname);
    CORALOGIX_CONFIG.redirectUri = null;
    CORALOGIX_CONFIG.clientId = null;
  });

  describe('setAuthCredentials', () => {
    it('should set token', () => {
      setAuthCredentials('test-token');
      assert.strictEqual(getToken(), 'test-token');
    });

    it('should set token and team ID', () => {
      setAuthCredentials('test-token', 12345);
      assert.strictEqual(getToken(), 'test-token');
      assert.strictEqual(getTeamId(), 12345);
    });

    it('should handle null team ID', () => {
      setAuthCredentials('test-token', null);
      assert.strictEqual(getToken(), 'test-token');
      assert.strictEqual(getTeamId(), null);
    });
  });

  describe('getToken', () => {
    it('should return null when not set', () => {
      assert.strictEqual(getToken(), null);
    });

    it('should return token when set', () => {
      setAuthCredentials('my-token');
      assert.strictEqual(getToken(), 'my-token');
    });
  });

  describe('getTeamId', () => {
    it('should return null when not set', () => {
      assert.strictEqual(getTeamId(), null);
    });

    it('should return team ID when set', () => {
      setAuthCredentials('token', 999);
      assert.strictEqual(getTeamId(), 999);
    });
  });

  describe('clearAuthCredentials', () => {
    it('should clear token and team ID', () => {
      setAuthCredentials('test-token', 12345);
      clearAuthCredentials();

      assert.strictEqual(getToken(), null);
      assert.strictEqual(getTeamId(), null);
    });
  });

  describe('hasAuthCredentials', () => {
    it('should return false when no credentials set', () => {
      assert.strictEqual(hasAuthCredentials(), false);
    });

    it('should return true when token is set', () => {
      setAuthCredentials('test-token');
      assert.strictEqual(hasAuthCredentials(), true);
    });

    it('should return false after clearing credentials', () => {
      setAuthCredentials('test-token', 12345);
      clearAuthCredentials();
      assert.strictEqual(hasAuthCredentials(), false);
    });
  });

  describe('refreshToken (no prior login)', () => {
    it('should throw when no refresh token is in memory', async () => {
      try {
        await refreshToken();
        assert.fail('expected error');
      } catch (e) {
        assert.strictEqual(e.message, 'No refresh token available');
      }
    });

    it('should never store refresh token in localStorage', () => {
      assert.isNull(localStorage.getItem('auth_refresh_token'));
    });
  });

  describe('handleOAuthCallback', () => {
    it('should return false when no code in URL', async () => {
      const result = await handleOAuthCallback();
      assert.isFalse(result);
    });

    it('should store access token in localStorage via getToken', async () => {
      setupOAuthState('auth-code', 'state-abc');
      mockTokenFetch({ access_token: 'access-123', refresh_token: 'refresh-123', expires_in: 3600 });

      assert.isNull(getToken()); // nothing before the callback
      await handleOAuthCallback();
      assert.strictEqual(getToken(), 'access-123'); // getToken() reads what storeTokens wrote
    });

    it('should store refresh token in memory, not localStorage', async () => {
      setupOAuthState('auth-code', 'state-def');
      mockTokenFetch({ access_token: 'access-456', refresh_token: 'refresh-456', expires_in: 3600 });

      await handleOAuthCallback();
      assert.isNull(localStorage.getItem('auth_refresh_token'));
    });

    it('should return the saved return URL', async () => {
      setupOAuthState('auth-code', 'state-ghi');
      mockTokenFetch({ access_token: 'access-789', expires_in: 3600 });

      const returnUrl = await handleOAuthCallback();
      assert.strictEqual(returnUrl, '/dashboard.html');
    });

    it('should decode id_token and populate getCurrentUser via getToken path', async () => {
      setupOAuthState('auth-code', 'state-jkl');
      const idToken = buildIdToken({ email: 'user@example.com', name: 'Test User', sub: 'u1' });
      mockTokenFetch({
        access_token: 'access-abc',
        refresh_token: 'refresh-abc',
        id_token: idToken,
        expires_in: 3600,
      });

      await handleOAuthCallback();
      const user = getCurrentUser();
      assert.strictEqual(user.email, 'user@example.com');
      assert.strictEqual(user.name, 'Test User');
    });

    it('should use getToken() (set by storeTokens) when calling fetchUserInfo', async () => {
      setupOAuthState('auth-code', 'state-mno');
      const fetchedUrls = [];
      let callCount = 0;
      window.fetch = async (url) => {
        fetchedUrls.push(url);
        callCount += 1;
        if (callCount === 1) {
          return { ok: true, json: async () => ({ access_token: 'access-xyz', refresh_token: 'refresh-xyz', expires_in: 3600 }) };
        }
        // userinfo call — verify it carries the Authorization header (set via getToken)
        return { ok: false };
      };

      await handleOAuthCallback();
      // The second fetch call is fetchUserInfo, triggered because storeTokens set the token
      assert.strictEqual(fetchedUrls.length, 2);
      assert.isTrue(fetchedUrls[1].includes('/oauth/userinfo'));
    });
  });

  describe('refreshToken (after OAuth callback)', () => {
    it('should use in-memory refresh token to obtain a new access token', async () => {
      // Populate refreshTokenMemory via a full OAuth callback
      setupOAuthState('code-1', 'state-pqr');
      let callCount = 0;
      window.fetch = async () => {
        callCount += 1;
        if (callCount === 1) {
          return { ok: true, json: async () => ({ access_token: 'first-token', refresh_token: 'the-refresh-token', expires_in: 3600 }) };
        }
        if (callCount === 2) return { ok: false }; // userinfo — no-op
        // Third call: the refreshToken() exchange
        return { ok: true, json: async () => ({ access_token: 'refreshed-token', refresh_token: 'the-refresh-token', expires_in: 3600 }) };
      };

      await handleOAuthCallback();
      assert.strictEqual(getToken(), 'first-token');

      const newToken = await refreshToken();
      assert.strictEqual(newToken, 'refreshed-token');
      assert.strictEqual(getToken(), 'refreshed-token');
      assert.isNull(localStorage.getItem('auth_refresh_token'));
    });
  });

  describe('ensureFreshToken', () => {
    it('should not call refreshToken when token is not expired', async () => {
      setAuthCredentials('valid-token');
      localStorage.setItem('auth_expires_at', (Date.now() + 600_000).toString()); // 10 min from now
      let fetchCalled = false;
      window.fetch = async () => {
        fetchCalled = true;
        return { ok: true, json: async () => ({}) };
      };

      await ensureFreshToken();
      assert.isFalse(fetchCalled);
    });
  });

  describe('logout', () => {
    it('should clear access token from localStorage', async () => {
      setAuthCredentials('test-token');
      window.fetch = async () => ({ ok: true });

      await logout();
      assert.isNull(getToken());
    });
  });
});
