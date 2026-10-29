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
 * Backfill: grant SELECT on opspile_messages (view) and opspile_messages_raw to every
 * existing klickhaus reader. (Both were added to add-user.mjs's TABLES list after these
 * users were created, so they never received the grant.)
 *
 * Readers are all users with a table-level SELECT on delivery. That covers the
 * *_adobe_com users as well as older named readers; writers are excluded (they have at
 * most column-level SELECT on delivery, and *_writer names are skipped explicitly).
 *
 * The view runs with SQL SECURITY INVOKER, so readers need SELECT on the raw table too.
 *
 * Usage: node scripts/grant-opspile.mjs <admin-user> <admin-password> [-x]
 * Dry-run by default (prints the GRANT statements); pass -x to actually execute them.
 */

const CLICKHOUSE_HOST = 's2p5b8wmt5.eastus2.azure.clickhouse.cloud';
const CLICKHOUSE_PORT = 443;
const DATABASE = 'helix_logs_production';
const TABLES = ['opspile_messages', 'opspile_messages_raw'];

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
    console.error('Usage: node scripts/grant-opspile.mjs <admin-user> <admin-password> [-x]');
    process.exit(1);
  }

  const listSql = `SELECT DISTINCT user_name FROM system.grants
    WHERE user_name IS NOT NULL
      AND database = '${DATABASE}' AND table = 'delivery'
      AND access_type = 'SELECT' AND column IS NULL AND NOT is_partial_revoke
      AND NOT endsWith(user_name, '_writer')
      AND user_name != '${adminUser}'
    ORDER BY user_name
    FORMAT TSV`;
  const result = await runQuery(listSql, adminUser, adminPassword);
  const users = result.trim().split('\n').filter(Boolean);

  if (users.length === 0) {
    console.log('No reader users found.');
    return;
  }

  console.log(`Found ${users.length} reader(s): ${users.join(', ')}\n`);

  const statements = users.flatMap((user) => TABLES.map((table) => `GRANT SELECT ON ${DATABASE}.${table} TO \`${user}\``));

  if (!execute) {
    console.log('Dry run (pass -x to execute). Would run:\n');
    statements.forEach((sql) => console.log(`  ${sql};`));
    return;
  }

  for (const sql of statements) {
    // eslint-disable-next-line no-await-in-loop -- Sequential grants to avoid race conditions
    await runQuery(sql, adminUser, adminPassword);
    console.log(`  ${sql}`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
