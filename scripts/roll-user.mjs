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
 * Roll (rotate) a user's password in ClickHouse
 * Usage: node roll-user.mjs <admin-user> <admin-password> <username>
 */

const CLICKHOUSE_HOST = 's2p5b8wmt5.eastus2.azure.clickhouse.cloud';
const CLICKHOUSE_PORT = 8443;

function generatePassword(length = 16) {
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  const special = '!@#$%^&*';
  const all = lower + upper + digits + special;

  // Ensure at least one of each required type
  const password = [
    upper.charAt(Math.floor(Math.random() * upper.length)),
    special.charAt(Math.floor(Math.random() * special.length)),
    digits.charAt(Math.floor(Math.random() * digits.length)),
  ];

  // Fill rest with random chars
  for (let i = password.length; i < length; i += 1) {
    password.push(all.charAt(Math.floor(Math.random() * all.length)));
  }

  // Shuffle
  for (let i = password.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [password[i], password[j]] = [password[j], password[i]];
  }

  return password.join('');
}

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

async function main() {
  const [, , adminUser, adminPassword, username] = process.argv;

  if (!adminUser || !adminPassword || !username) {
    console.error('Usage: node roll-user.mjs <admin-user> <admin-password> <username>');
    process.exit(1);
  }

  const newPassword = generatePassword();

  try {
    const sql = `ALTER USER ${username} IDENTIFIED BY '${newPassword.replace(/'/g, "''")}'`;
    await query(sql, adminUser, adminPassword);

    console.log(`Password rotated for user: ${username}`);
    console.log('\n--- New Credentials ---');
    console.log(`Username: ${username}`);
    console.log(`Password: ${newPassword}`);
    console.log(`Host: ${CLICKHOUSE_HOST}`);
    console.log(`Port: ${CLICKHOUSE_PORT} (HTTPS)`);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
