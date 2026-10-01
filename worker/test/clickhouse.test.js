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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMintStatements, formatDateTime, generatePassword, generateUsername, quote,
} from '../src/clickhouse.js';

const BASE = {
  username: 'tenant_abc123',
  password: 'pw',
  org: 'acme',
  site: 'www',
  scope: 'site',
  ticket: 'SUP-1',
  expiresAt: Date.parse('2026-09-12T12:00:00Z'),
  database: 'tenant_poc',
  role: 'tenant_selfserve',
};

test('quote escapes single quotes and backslashes', () => {
  assert.equal(quote("it's"), "'it''s'");
  assert.equal(quote('a\\b'), "'a\\\\b'");
  assert.equal(quote('plain'), "'plain'");
});

test('a ticket carrying quotes cannot break out of its literal', () => {
  const statements = buildMintStatements({
    ...BASE,
    ticket: "SUP-1'; DROP USER default; --",
  });
  const insert = statements.find((s) => s.startsWith('INSERT'));
  // The quote is doubled rather than passed through.
  assert.ok(insert.includes("'SUP-1''; DROP USER default; --'"), insert);
  // Every literal is closed: an odd count would mean the payload escaped its
  // quotes and the remainder of the statement is being parsed as SQL.
  const quoteCount = (insert.match(/'/g) || []).length;
  assert.equal(quoteCount % 2, 0, `unbalanced quotes in ${insert}`);
});

test('formatDateTime produces a ClickHouse UTC literal', () => {
  assert.equal(formatDateTime(Date.parse('2026-09-12T12:00:00Z')), '2026-09-12 12:00:00');
});

test('mint statements create the user, grant the role and record the audit row', () => {
  const statements = buildMintStatements(BASE);
  assert.equal(statements.length, 3);
  assert.match(statements[0], /^CREATE USER tenant_abc123 IDENTIFIED BY 'pw' /);
  assert.match(statements[0], /VALID UNTIL '2026-09-12 12:00:00' DEFAULT ROLE tenant_selfserve/);
  assert.equal(statements[1], 'GRANT tenant_selfserve TO tenant_abc123');
  assert.match(statements[2], /^INSERT INTO tenant_poc\.tenant_grants /);
});

test('the created user always expires; no statement omits VALID UNTIL', () => {
  const statements = buildMintStatements(BASE);
  const create = statements.find((s) => s.startsWith('CREATE USER'));
  assert.ok(create.includes('VALID UNTIL'), 'CREATE USER must be time-boxed');
});

test('org scope records an empty site so the grant covers every site in the org', () => {
  const statements = buildMintStatements({ ...BASE, scope: 'org' });
  const insert = statements.find((s) => s.startsWith('INSERT'));
  assert.ok(insert.includes("'acme', ''"), `site should be empty for org scope: ${insert}`);
});

test('site scope records the site name', () => {
  const statements = buildMintStatements(BASE);
  const insert = statements.find((s) => s.startsWith('INSERT'));
  assert.ok(insert.includes("'acme', 'www'"));
});

test('generated passwords satisfy the ClickHouse Cloud complexity policy', () => {
  for (let i = 0; i < 200; i += 1) {
    const password = generatePassword();
    assert.equal(password.length, 24);
    assert.match(password, /[a-z]/, `no lowercase in ${password}`);
    assert.match(password, /[A-Z]/, `no uppercase in ${password}`);
    assert.match(password, /[0-9]/, `no digit in ${password}`);
    assert.match(password, /[!@#$%^&*]/, `no special in ${password}`);
  }
});

test('generated passwords avoid glyphs that are ambiguous when copied by hand', () => {
  for (let i = 0; i < 200; i += 1) {
    assert.doesNotMatch(generatePassword(), /[l1IO0]/);
  }
});

test('generated passwords and usernames are unique across many draws', () => {
  const passwords = new Set(Array.from({ length: 500 }, () => generatePassword()));
  assert.equal(passwords.size, 500);
  const usernames = new Set(Array.from({ length: 500 }, () => generateUsername()));
  assert.equal(usernames.size, 500);
});

test('usernames are safe to interpolate into SQL identifiers', () => {
  for (let i = 0; i < 100; i += 1) {
    assert.match(generateUsername(), /^tenant_[0-9a-f]{12}$/);
  }
});
