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
/**
 * Mints and revokes tenant-scoped ClickHouse users.
 *
 * The worker authenticates as `tenant_minter`, which can create and drop users and
 * hand out the `tenant_selfserve` role, but holds no SELECT on any log table.
 * ClickHouse only lets a user grant privileges it holds itself, so even a leaked
 * minter credential cannot produce a user with more access than tenant_selfserve.
 */

const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SPECIAL = '!@#$%^&*';

/** Escapes a value for use inside a single-quoted ClickHouse string literal. */
export function quote(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

/** Formats epoch millis as a ClickHouse `YYYY-MM-DD hh:mm:ss` UTC literal. */
export function formatDateTime(epochMillis) {
  return new Date(epochMillis).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Generates a password that satisfies the ClickHouse Cloud complexity policy
 * (at least one upper, lower, digit and special character). Ambiguous glyphs are
 * left out because these get copied by hand out of a ticket.
 */
export function generatePassword(length = 24) {
  const all = LOWER + UPPER + DIGITS + SPECIAL;
  const pick = (alphabet) => {
    const [value] = crypto.getRandomValues(new Uint32Array(1));
    return alphabet[value % alphabet.length];
  };
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SPECIAL)];
  while (chars.length < length) {
    chars.push(pick(all));
  }
  // Fisher-Yates with rejection-free indices; order of the guaranteed classes
  // must not be predictable.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const [value] = crypto.getRandomValues(new Uint32Array(1));
    const j = value % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function generateUsername(prefix = 'tenant') {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

/**
 * Builds the statements that create one tenant user. Returned as a list so the
 * caller can run them in order and so they are trivially assertable in tests.
 */
export function buildMintStatements({
  username, password, org, site, scope, ticket, expiresAt, database, role,
}) {
  const validUntil = formatDateTime(expiresAt);
  const grantSite = scope === 'org' ? '' : site;
  return [
    `CREATE USER ${username} IDENTIFIED BY ${quote(password)} `
      + `VALID UNTIL ${quote(validUntil)} DEFAULT ROLE ${role}`,
    `GRANT ${role} TO ${username}`,
    `INSERT INTO ${database}.tenant_grants (ch_user, org, site, expires, reason) VALUES (`
      + `${quote(username)}, ${quote(org)}, ${quote(grantSite)}, `
      + `${quote(validUntil)}, ${quote(ticket)})`,
  ];
}

async function execute(env, sql) {
  const response = await fetch(env.CLICKHOUSE_URL, {
    method: 'POST',
    headers: {
      'X-ClickHouse-User': env.CLICKHOUSE_USER,
      'X-ClickHouse-Key': env.CLICKHOUSE_PASSWORD,
      'Content-Type': 'text/plain',
    },
    body: sql,
  });
  const text = await response.text();
  if (!response.ok) {
    // Never surface raw ClickHouse errors to the caller: they can echo statement
    // text, which would include the generated password.
    throw new Error(`clickhouse request failed with ${response.status}`);
  }
  return text;
}

/**
 * Returns the still-valid grant for an org/site, if any, so a second request does
 * not quietly pile up extra credentials for the same tenant.
 */
export async function findActiveGrant(env, { org, site, scope }) {
  const grantSite = scope === 'org' ? '' : site;
  const sql = `SELECT ch_user, toString(expires) FROM ${env.CLICKHOUSE_DATABASE}.tenant_grants FINAL`
    + ` WHERE org = ${quote(org)} AND site = ${quote(grantSite)} AND expires > now()`
    + ' ORDER BY expires DESC LIMIT 1 FORMAT TabSeparated';
  const text = await execute(env, sql);
  const line = text.trim();
  if (!line) {
    return null;
  }
  const [chUser, expires] = line.split('\t');
  return { username: chUser, expires };
}

export async function mintTenant(env, {
  org, site, scope, ticket, ttlHours = 72, now = Date.now(),
}) {
  const username = generateUsername();
  const password = generatePassword();
  const expiresAt = now + ttlHours * 3600 * 1000;
  const statements = buildMintStatements({
    username,
    password,
    org,
    site,
    scope,
    ticket,
    expiresAt,
    database: env.CLICKHOUSE_DATABASE,
    role: env.TENANT_ROLE,
  });
  for (const sql of statements) {
    // Sequential on purpose: the GRANT and the audit row must not run before
    // CREATE USER has succeeded.
    // eslint-disable-next-line no-await-in-loop
    await execute(env, sql);
  }
  return { username, password, expiresAt };
}
