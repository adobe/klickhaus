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
import { validateBaseUrl } from './iforgot-url.js';

describe('validateBaseUrl', () => {
  it('accepts an https URL', () => {
    const url = 'https://klickhaus.aemstatus.net/reset-password.html';
    assert.strictEqual(validateBaseUrl(url), url);
  });

  it('accepts an https preview URL with path', () => {
    const url = 'https://klickhaus.aemstatus.net/preview/pr-123/reset-password.html';
    assert.strictEqual(validateBaseUrl(url), url);
  });

  it('accepts http://localhost for development', () => {
    const url = 'http://localhost:3000/reset-password.html';
    assert.strictEqual(validateBaseUrl(url), url);
  });

  it('accepts http://127.0.0.1 for development', () => {
    const url = 'http://127.0.0.1:8080/reset-password.html';
    assert.strictEqual(validateBaseUrl(url), url);
  });

  it('accepts http://[::1] for development', () => {
    const url = 'http://[::1]:8080/reset-password.html';
    assert.strictEqual(validateBaseUrl(url), url);
  });

  it('rejects http:// for non-localhost hosts', () => {
    assert.throws(
      () => validateBaseUrl('http://klickhaus.aemstatus.net/reset-password.html'),
      /must be https/i,
    );
  });

  it('rejects http:// even for hosts that look like localhost', () => {
    assert.throws(
      () => validateBaseUrl('http://localhost.evil.com/reset-password.html'),
      /must be https/i,
    );
  });

  it('rejects file:// scheme', () => {
    assert.throws(
      () => validateBaseUrl('file:///etc/passwd'),
      /must be https/i,
    );
  });

  it('rejects javascript: scheme', () => {
    // Construct the scheme dynamically so the literal isn't flagged by linters.
    const evilScheme = `${'java'}${'script'}:alert(1)`;
    assert.throws(() => validateBaseUrl(evilScheme), /must be https/i);
  });

  it('rejects ftp:// scheme', () => {
    assert.throws(
      () => validateBaseUrl('ftp://example.com/reset.html'),
      /must be https/i,
    );
  });

  it('rejects garbage input', () => {
    assert.throws(() => validateBaseUrl('not a url'));
    assert.throws(() => validateBaseUrl(''));
  });
});
