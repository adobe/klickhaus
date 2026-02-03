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
  hostLink, forwardedHostLink, refererLink, pathLink,
} from './links.js';
import { state } from '../state.js';

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

describe('pathLink', () => {
  let savedFilters;

  beforeEach(() => {
    savedFilters = state.filters;
    state.filters = [];
  });

  afterEach(() => {
    state.filters = savedFilters;
  });

  it('returns null for empty value', () => {
    assert.strictEqual(pathLink(''), null);
    assert.strictEqual(pathLink(null), null);
  });

  it('returns null when no host filter active', () => {
    assert.strictEqual(pathLink('/page'), null);
  });

  it('builds URL from host filter', () => {
    state.filters = [
      { col: '`request.host`', value: 'example.com', exclude: false },
    ];
    assert.strictEqual(pathLink('/page'), 'https://example.com/page');
  });

  it('ignores excluded host filter', () => {
    state.filters = [
      { col: '`request.host`', value: 'example.com', exclude: true },
    ];
    assert.strictEqual(pathLink('/page'), null);
  });

  it('builds URL from forwarded host filter', () => {
    const fwdCol = "if(`request.headers.x_forwarded_host` = `request.host`, '(same)', `request.headers.x_forwarded_host`)";
    state.filters = [
      { col: fwdCol, value: 'customer.com', exclude: false },
    ];
    assert.strictEqual(pathLink('/page'), 'https://customer.com/page');
  });

  it('takes first host from comma-separated forwarded host', () => {
    const fwdCol = "if(`request.headers.x_forwarded_host` = `request.host`, '(same)', `request.headers.x_forwarded_host`)";
    state.filters = [
      { col: fwdCol, value: 'a.com, b.com', exclude: false },
    ];
    assert.strictEqual(pathLink('/page'), 'https://a.com/page');
  });

  it('ignores forwarded host filter with (same) value', () => {
    const fwdCol = "if(`request.headers.x_forwarded_host` = `request.host`, '(same)', `request.headers.x_forwarded_host`)";
    state.filters = [
      { col: fwdCol, value: '(same)', exclude: false },
    ];
    assert.strictEqual(pathLink('/page'), null);
  });

  it('prefers host filter over forwarded host', () => {
    const fwdCol = "if(`request.headers.x_forwarded_host` = `request.host`, '(same)', `request.headers.x_forwarded_host`)";
    state.filters = [
      { col: '`request.host`', value: 'edge.com', exclude: false },
      { col: fwdCol, value: 'origin.com', exclude: false },
    ];
    assert.strictEqual(pathLink('/page'), 'https://edge.com/page');
  });
});
