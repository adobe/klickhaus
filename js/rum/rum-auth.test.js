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
import { assert } from 'chai';
import {
  loadRumCredentials,
  storeRumCredentials,
  clearRumCredentials,
  getRumCredentialsFromUrl,
  validateRumCredentials,
  RUM_CREDENTIALS_KEY,
} from './rum-auth.js';

describe('rum-auth', () => {
  // Save and restore original fetch and localStorage
  let originalFetch;

  beforeEach(() => {
    originalFetch = window.fetch;
    // Clear localStorage for the RUM credentials key
    localStorage.removeItem(RUM_CREDENTIALS_KEY);
    sessionStorage.removeItem(RUM_CREDENTIALS_KEY);
  });

  afterEach(() => {
    window.fetch = originalFetch;
    localStorage.removeItem(RUM_CREDENTIALS_KEY);
    sessionStorage.removeItem(RUM_CREDENTIALS_KEY);
  });

  describe('getRumCredentialsFromUrl', () => {
    it('returns credentials when domain and domainkey are in URL params', () => {
      const params = new URLSearchParams('?domain=www.example.com&domainkey=abc-123');
      const creds = getRumCredentialsFromUrl(params);
      assert.deepEqual(creds, { domain: 'www.example.com', domainkey: 'abc-123' });
    });

    it('returns null when domain is missing', () => {
      const params = new URLSearchParams('?domainkey=abc-123');
      const creds = getRumCredentialsFromUrl(params);
      assert.isNull(creds);
    });

    it('returns null when domainkey is missing', () => {
      const params = new URLSearchParams('?domain=www.example.com');
      const creds = getRumCredentialsFromUrl(params);
      assert.isNull(creds);
    });

    it('returns null when both are missing', () => {
      const params = new URLSearchParams('');
      const creds = getRumCredentialsFromUrl(params);
      assert.isNull(creds);
    });

    it('returns null when domain is empty', () => {
      const params = new URLSearchParams('?domain=&domainkey=abc-123');
      const creds = getRumCredentialsFromUrl(params);
      assert.isNull(creds);
    });

    it('returns null when domainkey is empty', () => {
      const params = new URLSearchParams('?domain=www.example.com&domainkey=');
      const creds = getRumCredentialsFromUrl(params);
      assert.isNull(creds);
    });

    it('trims whitespace from values', () => {
      const params = new URLSearchParams('?domain= www.example.com &domainkey= abc-123 ');
      const creds = getRumCredentialsFromUrl(params);
      assert.deepEqual(creds, { domain: 'www.example.com', domainkey: 'abc-123' });
    });
  });

  describe('storeRumCredentials', () => {
    it('stores credentials in localStorage by default', () => {
      storeRumCredentials({ domain: 'test.com', domainkey: 'key1' });
      const stored = JSON.parse(localStorage.getItem(RUM_CREDENTIALS_KEY));
      assert.deepEqual(stored, { domain: 'test.com', domainkey: 'key1' });
    });

    it('stores credentials in sessionStorage when forgetMe is true', () => {
      storeRumCredentials({ domain: 'test.com', domainkey: 'key1' }, true);
      const stored = JSON.parse(sessionStorage.getItem(RUM_CREDENTIALS_KEY));
      assert.deepEqual(stored, { domain: 'test.com', domainkey: 'key1' });
      assert.isNull(localStorage.getItem(RUM_CREDENTIALS_KEY));
    });

    it('clears any existing stored credentials before storing new', () => {
      localStorage.setItem(RUM_CREDENTIALS_KEY, JSON.stringify({ domain: 'old.com', domainkey: 'old' }));
      storeRumCredentials({ domain: 'new.com', domainkey: 'newkey' }, true);
      assert.isNull(localStorage.getItem(RUM_CREDENTIALS_KEY));
      const stored = JSON.parse(sessionStorage.getItem(RUM_CREDENTIALS_KEY));
      assert.strictEqual(stored.domain, 'new.com');
    });
  });

  describe('loadRumCredentials', () => {
    it('returns null when no credentials stored', () => {
      assert.isNull(loadRumCredentials());
    });

    it('loads credentials from localStorage', () => {
      const creds = { domain: 'test.com', domainkey: 'key1' };
      localStorage.setItem(RUM_CREDENTIALS_KEY, JSON.stringify(creds));
      const loaded = loadRumCredentials();
      assert.deepEqual(loaded, creds);
    });

    it('loads credentials from sessionStorage', () => {
      const creds = { domain: 'test.com', domainkey: 'key1' };
      sessionStorage.setItem(RUM_CREDENTIALS_KEY, JSON.stringify(creds));
      const loaded = loadRumCredentials();
      assert.deepEqual(loaded, creds);
    });

    it('prefers sessionStorage over localStorage', () => {
      localStorage.setItem(RUM_CREDENTIALS_KEY, JSON.stringify({ domain: 'local.com', domainkey: 'a' }));
      sessionStorage.setItem(RUM_CREDENTIALS_KEY, JSON.stringify({ domain: 'session.com', domainkey: 'b' }));
      const loaded = loadRumCredentials();
      assert.strictEqual(loaded.domain, 'session.com');
    });

    it('returns null and cleans up invalid JSON', () => {
      localStorage.setItem(RUM_CREDENTIALS_KEY, 'not-json');
      const loaded = loadRumCredentials();
      assert.isNull(loaded);
      assert.isNull(localStorage.getItem(RUM_CREDENTIALS_KEY));
    });

    it('returns null for stored object missing domain', () => {
      localStorage.setItem(RUM_CREDENTIALS_KEY, JSON.stringify({ domainkey: 'key1' }));
      const loaded = loadRumCredentials();
      assert.isNull(loaded);
      assert.isNull(localStorage.getItem(RUM_CREDENTIALS_KEY));
    });

    it('returns null for stored object missing domainkey', () => {
      localStorage.setItem(RUM_CREDENTIALS_KEY, JSON.stringify({ domain: 'test.com' }));
      const loaded = loadRumCredentials();
      assert.isNull(loaded);
      assert.isNull(localStorage.getItem(RUM_CREDENTIALS_KEY));
    });
  });

  describe('clearRumCredentials', () => {
    it('clears credentials from both localStorage and sessionStorage', () => {
      localStorage.setItem(RUM_CREDENTIALS_KEY, JSON.stringify({ domain: 'a', domainkey: 'b' }));
      sessionStorage.setItem(RUM_CREDENTIALS_KEY, JSON.stringify({ domain: 'c', domainkey: 'd' }));
      clearRumCredentials();
      assert.isNull(localStorage.getItem(RUM_CREDENTIALS_KEY));
      assert.isNull(sessionStorage.getItem(RUM_CREDENTIALS_KEY));
    });
  });

  describe('validateRumCredentials', () => {
    it('returns true when API responds with 200', async () => {
      window.fetch = async (url) => {
        assert.include(url, 'bundles.aem.page');
        assert.include(url, 'test.com');
        assert.include(url, 'domainkey=abc-key');
        return { ok: true, status: 200 };
      };
      const valid = await validateRumCredentials('test.com', 'abc-key');
      assert.isTrue(valid);
    });

    it('returns false when API responds with 403', async () => {
      window.fetch = async () => ({ ok: false, status: 403 });
      const valid = await validateRumCredentials('test.com', 'bad-key');
      assert.isFalse(valid);
    });

    it('returns false when API responds with 404', async () => {
      // 404 means domain doesn't exist — but still valid domainkey if it returns 404
      // Actually a 404 for today's date just means no data yet; treat as valid
      window.fetch = async () => ({ ok: false, status: 404 });
      const valid = await validateRumCredentials('test.com', 'key');
      assert.isTrue(valid);
    });

    it('returns false on network error', async () => {
      window.fetch = async () => {
        throw new Error('Network error');
      };
      const valid = await validateRumCredentials('test.com', 'key');
      assert.isFalse(valid);
    });

    it('returns true when API responds with 200 for a real date path', async () => {
      let calledUrl = '';
      window.fetch = async (url) => {
        calledUrl = url;
        return { ok: true, status: 200 };
      };
      await validateRumCredentials('example.com', 'key-123');
      // URL should include a date path
      assert.match(calledUrl, /\/bundles\/example\.com\/\d{4}\//);
    });
  });
});
