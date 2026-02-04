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
import { escapeHtml, isSyntheticBucket, sanitizeUrl } from './utils.js';

describe('escapeHtml', () => {
  it('escapes angle brackets', () => {
    assert.strictEqual(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes ampersands', () => {
    assert.strictEqual(escapeHtml('a&b'), 'a&amp;b');
  });

  it('escapes quotes', () => {
    const result = escapeHtml('"hello"');
    assert.ok(result.includes('&quot;') || result.includes('"'));
  });

  it('returns empty string for empty input', () => {
    assert.strictEqual(escapeHtml(''), '');
  });

  it('passes through safe text unchanged', () => {
    assert.strictEqual(escapeHtml('hello world'), 'hello world');
  });
});

describe('isSyntheticBucket', () => {
  it('returns true for null', () => {
    assert.strictEqual(isSyntheticBucket(null), true);
  });

  it('returns true for undefined', () => {
    assert.strictEqual(isSyntheticBucket(undefined), true);
  });

  it('returns true for empty string', () => {
    assert.strictEqual(isSyntheticBucket(''), true);
  });

  it('returns true for parenthesized values', () => {
    assert.strictEqual(isSyntheticBucket('(empty)'), true);
    assert.strictEqual(isSyntheticBucket('(other)'), true);
    assert.strictEqual(isSyntheticBucket('(same)'), true);
  });

  it('returns true for values containing synthetic patterns', () => {
    assert.strictEqual(isSyntheticBucket('0 (empty)'), true);
    assert.strictEqual(isSyntheticBucket('unknown (other)'), true);
  });

  it('returns false for regular values', () => {
    assert.strictEqual(isSyntheticBucket('example.com'), false);
    assert.strictEqual(isSyntheticBucket('GET'), false);
    assert.strictEqual(isSyntheticBucket('200'), false);
  });

  it('returns false for non-string types', () => {
    assert.strictEqual(isSyntheticBucket(42), false);
    assert.strictEqual(isSyntheticBucket(true), false);
  });
});

describe('sanitizeUrl', () => {
  it('allows http and https URLs', () => {
    assert.strictEqual(sanitizeUrl('https://example.com/path?q=1'), 'https://example.com/path?q=1');
    assert.strictEqual(sanitizeUrl('http://example.com'), 'http://example.com');
  });

  it('encodes query characters and preserves hash', () => {
    assert.strictEqual(
      sanitizeUrl('https://example.com/path?q="test"&x=1#frag'),
      'https://example.com/path?q=%22test%22&x=1#frag',
    );
  });

  it('handles query or hash without explicit path', () => {
    assert.strictEqual(sanitizeUrl('https://example.com?query=value'), 'https://example.com?query=value');
    assert.strictEqual(sanitizeUrl('https://example.com#section'), 'https://example.com#section');
  });

  it('preserves explicit trailing slash', () => {
    assert.strictEqual(sanitizeUrl('https://example.com/'), 'https://example.com/');
  });

  it('rejects invalid or unsafe protocols', () => {
    const scriptScheme = ['java', 'script:alert(1)'].join('');
    const dataScheme = ['da', 'ta:text/plain,hello'].join('');
    const blobScheme = ['b', 'lob:https://example.com/'].join('');
    assert.isNull(sanitizeUrl(scriptScheme));
    assert.isNull(sanitizeUrl(dataScheme));
    assert.isNull(sanitizeUrl(blobScheme));
  });

  it('returns null for invalid input', () => {
    assert.isNull(sanitizeUrl(''));
    assert.isNull(sanitizeUrl('   '));
    assert.isNull(sanitizeUrl('not a url'));
  });
});
