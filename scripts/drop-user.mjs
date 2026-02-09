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
 * Drop a user from ClickHouse
 * Usage: node drop-user.mjs <admin-user> <admin-password> <username>
 */

const CLICKHOUSE_HOST = 's2p5b8wmt5.eastus2.azure.clickhouse.cloud';
const CLICKHOUSE_PORT = 8443;

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
  const [,, adminUser, adminPassword, username] = process.argv;

  if (!adminUser || !adminPassword || !username) {
    console.error('Usage: node drop-user.mjs <admin-user> <admin-password> <username>');
    process.exit(1);
  }

  // Validate username to prevent SQL injection
  if (!/^[A-Za-z0-9_]+$/.test(username)) {
    console.error('Error: username must contain only letters, digits, and underscores');
    process.exit(1);
  }

  // Safety check
  const protectedUsers = ['default', 'admin'];
  if (protectedUsers.includes(username.toLowerCase())) {
    console.error(`Error: Cannot drop protected user '${username}'`);
    process.exit(1);
  }

  try {
    const sql = `DROP USER IF EXISTS ${username}`;
    await query(sql, adminUser, adminPassword);
    console.log(`Dropped user: ${username}`);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
