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
  parseFragment,
  pickDisplayName,
  evaluatePassword,
  escapeSqlString,
  escapeIdentifier,
  describeError,
  buildAlterUserSql,
  buildDropUserSql,
  isResetLinkValid,
} from './reset-password-logic.js';

describe('parseFragment', () => {
  it('parses all three params from a hash with leading #', () => {
    const r = parseFragment('#u=trieloff_adobe_com&r=reset_abc&t=secret-token_123');
    assert.strictEqual(r.user, 'trieloff_adobe_com');
    assert.strictEqual(r.resetUser, 'reset_abc');
    assert.strictEqual(r.token, 'secret-token_123');
    assert.strictEqual(r.displayName, '');
  });

  it('parses the optional display-name (e) param', () => {
    const r = parseFragment('#u=trieloff_adobe_com&r=reset_abc&t=tok&e=trieloff%40adobe.com');
    assert.strictEqual(r.displayName, 'trieloff@adobe.com');
  });

  it('parses params from a hash without leading #', () => {
    const r = parseFragment('u=alice&r=reset_xyz&t=tok');
    assert.strictEqual(r.user, 'alice');
    assert.strictEqual(r.resetUser, 'reset_xyz');
    assert.strictEqual(r.token, 'tok');
  });

  it('returns empty strings for missing params', () => {
    const r = parseFragment('#');
    assert.strictEqual(r.user, '');
    assert.strictEqual(r.resetUser, '');
    assert.strictEqual(r.token, '');
    assert.strictEqual(r.displayName, '');
  });

  it('handles empty / nullish input', () => {
    const empty = {
      user: '', resetUser: '', token: '', displayName: '',
    };
    assert.deepEqual(parseFragment(''), empty);
    assert.deepEqual(parseFragment(null), empty);
    assert.deepEqual(parseFragment(undefined), empty);
  });

  it('decodes percent-encoded values', () => {
    const r = parseFragment('#u=alice&r=reset_a&t=a%2Bb%2Fc%3D%3D');
    assert.strictEqual(r.token, 'a+b/c==');
  });
});

describe('evaluatePassword', () => {
  it('rejects empty', () => {
    const r = evaluatePassword('');
    assert.isFalse(r.valid);
    assert.strictEqual(r.score, 0);
  });

  it('rejects short passwords', () => {
    const r = evaluatePassword('Aa1!aaaa');
    assert.isFalse(r.valid);
    assert.match(r.hint, /12\+ chars/);
  });

  it('rejects passwords missing a class', () => {
    const r = evaluatePassword('alllowercase1234');
    assert.isFalse(r.valid);
    assert.match(r.hint, /uppercase|symbol/);
  });

  it('accepts a strong password with all 4 classes and 12+ chars', () => {
    const r = evaluatePassword('Abcdefg1!xyzQ');
    assert.isTrue(r.valid);
    assert.isAtLeast(r.score, 3);
  });

  it('gives a higher score for longer mixed passwords', () => {
    const short = evaluatePassword('Abcdefg1!xyz');
    const long = evaluatePassword('Abcdefghij1!XYZqrst');
    assert.isAtLeast(long.score, short.score);
  });

  it('treats a 16+ char passphrase with all classes as score 4', () => {
    const r = evaluatePassword('Correct-Horse-Battery-Staple1!');
    assert.strictEqual(r.score, 4);
    assert.match(r.hint, /strong/i);
  });
});

describe('escapeSqlString', () => {
  it('doubles single quotes', () => {
    assert.strictEqual(escapeSqlString("it's"), "it''s");
  });
  it('escapes backslashes before quotes', () => {
    assert.strictEqual(escapeSqlString('a\\b'), 'a\\\\b');
  });
  it('handles non-string input by stringifying', () => {
    assert.strictEqual(escapeSqlString(42), '42');
  });
});

describe('escapeIdentifier', () => {
  it('returns valid identifiers unchanged', () => {
    assert.strictEqual(escapeIdentifier('alice_smith'), 'alice_smith');
  });
  it('throws on invalid identifiers', () => {
    assert.throws(() => escapeIdentifier('alice; DROP USER admin'));
    assert.throws(() => escapeIdentifier('alice@host'));
    assert.throws(() => escapeIdentifier(''));
  });
});

describe('describeError', () => {
  it('maps 401 to expired link message', () => {
    const err = new Error('Authentication failed');
    err.status = 401;
    assert.match(describeError(err), /expired/i);
  });
  it('maps required_password text to expired link message', () => {
    const err = new Error('Code: 516. REQUIRED_PASSWORD');
    assert.match(describeError(err), /expired/i);
  });
  it('maps "not enough privileges" to a privileges message', () => {
    const err = new Error('NOT_ENOUGH_PRIVILEGES: not enough privileges');
    assert.match(describeError(err), /privilege/i);
  });
  it('maps NetworkError to a network message', () => {
    assert.match(describeError(new TypeError('Failed to fetch')), /network/i);
  });
  it('falls back to the raw message', () => {
    assert.match(describeError(new Error('Some other failure')), /Some other failure/);
  });
  it('handles nullish error', () => {
    assert.strictEqual(describeError(null), 'Unknown error');
  });
  it('truncates very long messages', () => {
    const long = 'x'.repeat(500);
    const out = describeError(new Error(long));
    assert.isAtMost(out.length, 240);
  });
});

describe('buildAlterUserSql', () => {
  it('produces valid SQL', () => {
    const sql = buildAlterUserSql('alice', 'p@ss!');
    assert.strictEqual(sql, "ALTER USER alice IDENTIFIED BY 'p@ss!'");
  });
  it('escapes quotes in passwords', () => {
    const sql = buildAlterUserSql('alice', "ab'cd");
    assert.strictEqual(sql, "ALTER USER alice IDENTIFIED BY 'ab''cd'");
  });
  it('rejects invalid usernames', () => {
    assert.throws(() => buildAlterUserSql('alice; DROP', 'pw'));
  });
});

describe('buildDropUserSql', () => {
  it('produces a guarded DROP', () => {
    assert.strictEqual(buildDropUserSql('reset_abc'), 'DROP USER IF EXISTS reset_abc');
  });
  it('rejects invalid usernames', () => {
    assert.throws(() => buildDropUserSql('reset; DROP'));
  });
});

describe('pickDisplayName', () => {
  it('prefers the displayName when present', () => {
    assert.strictEqual(
      pickDisplayName({ user: 'trieloff_adobe_com', displayName: 'trieloff@adobe.com' }),
      'trieloff@adobe.com',
    );
  });

  it('falls back to user when displayName is empty', () => {
    assert.strictEqual(
      pickDisplayName({ user: 'lars', displayName: '' }),
      'lars',
    );
  });

  it('returns empty string for nullish input', () => {
    assert.strictEqual(pickDisplayName(null), '');
    assert.strictEqual(pickDisplayName(undefined), '');
    assert.strictEqual(pickDisplayName({}), '');
  });
});

describe('isResetLinkValid', () => {
  it('accepts complete params', () => {
    assert.isTrue(isResetLinkValid({ user: 'alice', resetUser: 'reset_a', token: 'tok' }));
  });
  it('rejects missing token', () => {
    assert.isFalse(isResetLinkValid({ user: 'alice', resetUser: 'reset_a', token: '' }));
  });
  it('rejects malformed username', () => {
    assert.isFalse(isResetLinkValid({ user: 'a@b', resetUser: 'reset_a', token: 't' }));
  });
  it('rejects malformed reset user', () => {
    assert.isFalse(isResetLinkValid({ user: 'alice', resetUser: 'reset-a', token: 't' }));
  });
  it('rejects nullish input', () => {
    assert.isFalse(isResetLinkValid(null));
    assert.isFalse(isResetLinkValid(undefined));
  });
});
