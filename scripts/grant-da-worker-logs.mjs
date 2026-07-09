#!/usr/bin/env node

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
 * Backfill: grant SELECT on da_worker_logs to all existing *_adobe_com read-only users.
 * (da_worker_logs was added to add-user.mjs's TABLES list after these users were created,
 * so they never received the grant.)
 *
 * Usage: node scripts/grant-da-worker-logs.mjs <admin-user> <admin-password> [-x]
 * Dry-run by default (prints the GRANT statements); pass -x to actually execute them.
 */

const CLICKHOUSE_HOST = 's2p5b8wmt5.eastus2.azure.clickhouse.cloud';
const CLICKHOUSE_PORT = 443;
const DATABASE = 'helix_logs_production';
const TABLE = 'da_worker_logs';

async function runQuery(sql, adminUser, adminPassword) {
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
    throw new Error(text.trim());
  }
  return text;
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('-x');
  const [adminUser, adminPassword] = args.filter((a) => a !== '-x');

  if (!adminUser || !adminPassword) {
    console.error('Usage: node scripts/grant-da-worker-logs.mjs <admin-user> <admin-password> [-x]');
    process.exit(1);
  }

  const listSql = "SELECT name FROM system.users WHERE endsWith(name, '_adobe_com') FORMAT TSV";
  const result = await runQuery(listSql, adminUser, adminPassword);
  const users = result.trim().split('\n').filter(Boolean);

  if (users.length === 0) {
    console.log('No *_adobe_com users found.');
    return;
  }

  console.log(`Found ${users.length} user(s): ${users.join(', ')}\n`);

  if (!execute) {
    console.log('Dry run (pass -x to execute). Would run:\n');
    for (const user of users) {
      console.log(`  GRANT SELECT ON ${DATABASE}.${TABLE} TO ${user};`);
    }
    return;
  }

  for (const user of users) {
    const grantSql = `GRANT SELECT ON ${DATABASE}.${TABLE} TO ${user}`;
    // eslint-disable-next-line no-await-in-loop -- Sequential grants to avoid race conditions
    await runQuery(grantSql, adminUser, adminPassword);
    console.log(`  GRANT SELECT ON ${TABLE} TO ${user}`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
