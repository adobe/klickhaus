#!/usr/bin/env node

/**
 * Add a new read-only user to ClickHouse
 * Usage: node add-user.mjs <admin-user> <admin-password> <new-username> [password]
 */

const CLICKHOUSE_HOST = 'ogadftwx3q.us-east1.gcp.clickhouse.cloud';
const CLICKHOUSE_PORT = 8443;
const DATABASE = 'helix_logs_production';
const TABLES = ['cdn_requests_combined', 'cdn_requests_v2'];

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
  const [,, adminUser, adminPassword, newUsername, providedPassword] = process.argv;

  if (!adminUser || !adminPassword || !newUsername) {
    console.error('Usage: node add-user.mjs <admin-user> <admin-password> <new-username> [password]');
    process.exit(1);
  }

  // Remove backslash escaping that shells may add
  const cleanPassword = providedPassword ? providedPassword.replace(/\\([!@#$%^&*])/g, '$1') : null;
  const password = cleanPassword || generatePassword();

  try {
    // Create user
    const createSql = `CREATE USER ${newUsername} IDENTIFIED BY '${password.replace(/'/g, "''")}'`;
    await query(createSql, adminUser, adminPassword);
    console.log(`Created user: ${newUsername}`);

    // Grant read-only access to all tables
    for (const table of TABLES) {
      const grantSql = `GRANT SELECT ON ${DATABASE}.${table} TO ${newUsername}`;
      await query(grantSql, adminUser, adminPassword);
      console.log(`Granted SELECT on ${DATABASE}.${table}`);
    }

    console.log('\n--- Credentials ---');
    console.log(`Username: ${newUsername}`);
    console.log(`Password: ${password}`);
    console.log(`Host: ${CLICKHOUSE_HOST}`);
    console.log(`Port: ${CLICKHOUSE_PORT} (HTTPS)`);

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
