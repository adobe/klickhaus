#!/usr/bin/env node

/**
 * Drop a user from ClickHouse
 * Usage: node drop-user.mjs <admin-user> <admin-password> <username>
 */

const CLICKHOUSE_HOST = 'ogadftwx3q.us-east1.gcp.clickhouse.cloud';
const CLICKHOUSE_PORT = 8443;

async function query(sql, adminUser, adminPassword) {
  const url = `https://${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT}/`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${adminUser}:${adminPassword}`).toString('base64')
    },
    body: sql
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
