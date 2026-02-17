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
} from './auth.js';

describe('Coralogix auth', () => {
  beforeEach(() => {
    clearAuthCredentials();
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
});
