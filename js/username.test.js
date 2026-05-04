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
import { emailToUsername, isValidUsername, normalizeLoginIdentifier } from './username.js';

describe('emailToUsername', () => {
  it('normalizes a basic email', () => {
    assert.strictEqual(emailToUsername('trieloff@adobe.com'), 'trieloff_adobe_com');
  });

  it('handles plus-addressing', () => {
    assert.strictEqual(emailToUsername('lars+test@adobe.com'), 'lars_test_adobe_com');
  });

  it('lowercases mixed case', () => {
    assert.strictEqual(emailToUsername('Trieloff@Adobe.COM'), 'trieloff_adobe_com');
  });

  it('is idempotent on already-normalized usernames', () => {
    assert.strictEqual(emailToUsername('trieloff_adobe_com'), 'trieloff_adobe_com');
  });

  it('collapses runs of separators', () => {
    assert.strictEqual(emailToUsername('a..b--c__d'), 'a_b_c_d');
  });

  it('strips leading and trailing separators', () => {
    assert.strictEqual(emailToUsername('---alice---'), 'alice');
  });

  it('throws on empty / unprintable', () => {
    assert.throws(() => emailToUsername(''));
    assert.throws(() => emailToUsername('---'));
  });

  it('throws on non-string', () => {
    assert.throws(() => emailToUsername(null));
    assert.throws(() => emailToUsername(undefined));
    assert.throws(() => emailToUsername(42));
  });
});

describe('isValidUsername', () => {
  it('accepts valid', () => {
    assert.isTrue(isValidUsername('alice'));
    assert.isTrue(isValidUsername('trieloff_adobe_com'));
    assert.isTrue(isValidUsername('reset_abcdef0123456789'));
  });

  it('rejects invalid', () => {
    assert.isFalse(isValidUsername(''));
    assert.isFalse(isValidUsername('a-b'));
    assert.isFalse(isValidUsername('user@host'));
    assert.isFalse(isValidUsername('with space'));
    assert.isFalse(isValidUsername(null));
  });
});

describe('normalizeLoginIdentifier', () => {
  it('normalizes an email to a ClickHouse username', () => {
    assert.strictEqual(
      normalizeLoginIdentifier('trieloff@adobe.com'),
      'trieloff_adobe_com',
    );
  });

  it('lowercases mixed-case emails', () => {
    assert.strictEqual(
      normalizeLoginIdentifier('Trieloff@Adobe.COM'),
      'trieloff_adobe_com',
    );
  });

  it('leaves plain usernames unchanged (idempotent)', () => {
    assert.strictEqual(normalizeLoginIdentifier('lars'), 'lars');
    assert.strictEqual(normalizeLoginIdentifier('david_query'), 'david_query');
  });

  it('lowercases plain usernames', () => {
    assert.strictEqual(normalizeLoginIdentifier('Lars'), 'lars');
  });

  it('trims surrounding whitespace', () => {
    assert.strictEqual(normalizeLoginIdentifier('  lars  '), 'lars');
    assert.strictEqual(
      normalizeLoginIdentifier('  trieloff@adobe.com  '),
      'trieloff_adobe_com',
    );
  });

  it('returns empty string for blank input', () => {
    assert.strictEqual(normalizeLoginIdentifier(''), '');
    assert.strictEqual(normalizeLoginIdentifier('   '), '');
    assert.strictEqual(normalizeLoginIdentifier(null), '');
    assert.strictEqual(normalizeLoginIdentifier(undefined), '');
  });

  it('falls back to the trimmed input when normalization throws', () => {
    assert.strictEqual(normalizeLoginIdentifier('---'), '---');
  });
});
