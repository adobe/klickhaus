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
import { hostLink, forwardedHostLink, refererLink } from './links.js';

describe('hostLink', () => {
  it('prepends https://', () => {
    assert.strictEqual(hostLink('example.com'), 'https://example.com');
  });

  it('works with AEM domains', () => {
    assert.strictEqual(hostLink('main--site--org.aem.live'), 'https://main--site--org.aem.live');
  });

  it('returns null for empty value', () => {
    assert.strictEqual(hostLink(''), null);
    assert.strictEqual(hostLink(null), null);
    assert.strictEqual(hostLink(undefined), null);
  });
});

describe('forwardedHostLink', () => {
  it('prepends https://', () => {
    assert.strictEqual(forwardedHostLink('customer.com'), 'https://customer.com');
  });

  it('takes first host from comma-separated list', () => {
    assert.strictEqual(forwardedHostLink('customer.com, main--site--org.aem.live'), 'https://customer.com');
  });

  it('trims whitespace from first host', () => {
    assert.strictEqual(forwardedHostLink('  customer.com , cdn.example.com'), 'https://customer.com');
  });

  it('returns null for empty value', () => {
    assert.strictEqual(forwardedHostLink(''), null);
    assert.strictEqual(forwardedHostLink(null), null);
  });
});

describe('refererLink', () => {
  it('returns https URLs as-is', () => {
    assert.strictEqual(refererLink('https://www.google.com/search?q=test'), 'https://www.google.com/search?q=test');
  });

  it('returns http URLs as-is', () => {
    assert.strictEqual(refererLink('http://example.com/page'), 'http://example.com/page');
  });

  it('returns null for non-URL values', () => {
    assert.strictEqual(refererLink('not-a-url'), null);
    assert.strictEqual(refererLink('/relative/path'), null);
  });

  it('returns null for empty value', () => {
    assert.strictEqual(refererLink(''), null);
    assert.strictEqual(refererLink(null), null);
  });
});
