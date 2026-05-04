#!/usr/bin/env node

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
/**
 * Generate a one-time, server-time-bounded password-set link for a user.
 *
 * Usage:
 *   node iforgot.mjs <admin-user> <admin-password> <email-or-username>
 *                    [--ttl=<minutes>] [--base-url=<url>]
 *
 * The script creates an ephemeral ClickHouse user (`reset_<random>`) with
 * `VALID UNTIL` enforced server-side and only the privileges needed to set a
 * password (`ALTER USER`, `DROP USER` for self-cleanup). It then prints a URL
 * containing the temp credentials in the URL fragment. The URL takes the user
 * to `reset-password.html`, which uses those credentials to ALTER the target
 * user's password and then DROPs the temp user.
 */

import { randomBytes } from 'crypto';
import { emailToUsername, isValidUsername } from '../js/username.js';
import { validateBaseUrl } from '../js/iforgot-url.js';

const CLICKHOUSE_HOST = 's2p5b8wmt5.eastus2.azure.clickhouse.cloud';
const CLICKHOUSE_PORT = 8443;
const DEFAULT_BASE_URL = 'https://klickhaus.aemstatus.net/reset-password.html';
const DEFAULT_TTL_MINUTES = 24 * 60;

async function query(sql, adminUser, adminPassword) {
  const url = `https://${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT}/`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${adminUser}:${adminPassword}`).toString('base64')}`,
      'Content-Type': 'text/plain',
    },
    body: sql,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text);
  }
  return text;
}

function tokenBytes(n) {
  const base = randomBytes(n).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  // ClickHouse Cloud's password policy requires at least one upper, lower,
  // digit, and special character. Base64url already contains upper/lower/digit;
  // append a deterministic special-character suffix to satisfy the rule.
  return `${base}!A1`;
}

function formatUtcDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} `
    + `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function parseTtlArg(args) {
  const flag = args.find((a) => a.startsWith('--ttl='));
  if (!flag) {
    return DEFAULT_TTL_MINUTES;
  }
  const value = parseInt(flag.slice('--ttl='.length), 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid --ttl value: ${flag}`);
  }
  return value;
}

function parseBaseUrlArg(args) {
  const flag = args.find((a) => a.startsWith('--base-url='));
  if (!flag) {
    return DEFAULT_BASE_URL;
  }
  return validateBaseUrl(flag.slice('--base-url='.length));
}

async function userExists(username, adminUser, adminPassword) {
  const sql = `SELECT name FROM system.users WHERE name = '${username}' FORMAT TabSeparated`;
  const result = await query(sql, adminUser, adminPassword);
  return result.trim() === username;
}

async function createTempUser({
  tempUser, tempPassword, expiresAt, adminUser, adminPassword,
}) {
  await query(
    `CREATE USER ${tempUser} IDENTIFIED BY '${tempPassword.replace(/'/g, "''")}' `
    + `VALID UNTIL '${expiresAt}'`,
    adminUser,
    adminPassword,
  );
  await query(`GRANT ALTER USER ON *.* TO ${tempUser}`, adminUser, adminPassword);
  await query(`GRANT DROP USER ON *.* TO ${tempUser}`, adminUser, adminPassword);
}

function buildResetUrl(baseUrl, targetUser, tempUser, tempPassword, displayName) {
  const params = new URLSearchParams();
  params.set('u', targetUser);
  params.set('r', tempUser);
  params.set('t', tempPassword);
  if (displayName && displayName !== targetUser) {
    params.set('e', displayName);
  }
  return `${baseUrl}#${params.toString()}`;
}

function printResult({
  targetUser, expiresAt, ttlMinutes, resetUrl,
}) {
  const hours = (ttlMinutes / 60).toFixed(ttlMinutes % 60 === 0 ? 0 : 1);
  console.log('');
  console.log(`Password reset link for "${targetUser}"`);
  console.log(`Valid for ~${hours} hour(s), until ${expiresAt} UTC`);
  console.log('');
  console.log(resetUrl);
  console.log('');
  console.log('Send this URL to the user via a private channel (Slack DM, signed email, etc.).');
  console.log('The link is single-use; opening it lets the user choose their own password.');
}

function parseArgs(argv) {
  const positional = [];
  const flags = [];
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--')) {
      flags.push(arg);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv);
  const [adminUser, adminPassword, identifier] = positional;

  if (!adminUser || !adminPassword || !identifier) {
    console.error(
      'Usage: node iforgot.mjs <admin-user> <admin-password> <email-or-username> '
      + '[--ttl=<minutes>] [--base-url=<url>]',
    );
    process.exit(1);
  }

  let ttlMinutes;
  let targetUser;
  let baseUrl;
  try {
    ttlMinutes = parseTtlArg(flags);
    baseUrl = parseBaseUrlArg(flags);
    targetUser = emailToUsername(identifier);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
    return;
  }

  if (!isValidUsername(targetUser)) {
    console.error(`Error: derived username "${targetUser}" is not valid`);
    process.exit(1);
  }

  try {
    const exists = await userExists(targetUser, adminUser, adminPassword);
    if (!exists) {
      console.error(`Error: user "${targetUser}" does not exist.`);
      console.error(`Create them first with: node scripts/add-user.mjs <admin-user> <admin-password> ${targetUser}`);
      process.exit(1);
    }

    const tempUser = `reset_${randomBytes(8).toString('hex')}`;
    const tempPassword = tokenBytes(32);
    const expiresAt = formatUtcDateTime(new Date(Date.now() + ttlMinutes * 60_000));

    await createTempUser({
      tempUser, tempPassword, expiresAt, adminUser, adminPassword,
    });

    const resetUrl = buildResetUrl(baseUrl, targetUser, tempUser, tempPassword, identifier);
    printResult({
      targetUser, expiresAt, ttlMinutes, resetUrl,
    });
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
