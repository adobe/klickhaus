#!/usr/bin/env node

/**
 * Roll (rotate) a user's password in ClickHouse
 * Usage: node roll-user.mjs <admin-user> <admin-password> <username>
 */

const CLICKHOUSE_HOST = 'ogadftwx3q.us-east1.gcp.clickhouse.cloud';
const CLICKHOUSE_PORT = 8443;

function generatePassword(length = 16) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

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
