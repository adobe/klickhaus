#!/usr/bin/env node
/**
 * Klickhaus TUI - Terminal User Interface for ClickHouse CDN Analytics
 *
 * Usage: npx @adobe/klickhaus [options]
 *
 * Options:
 *   -h, --host <host>     ClickHouse host (default: env CLICKHOUSE_HOST)
 *   -u, --user <user>     ClickHouse user (default: env CLICKHOUSE_USER or 'default')
 *   -p, --password <pwd>  ClickHouse password (default: env CLICKHOUSE_PASSWORD)
 *   -t, --time <range>    Time range: 15m, 1h, 12h, 24h, 7d (default: 1h)
 *   --host-filter <host>  Filter by host pattern
 */

import('../tui/index.js').then(({ start }) => start()).catch(err => {
  console.error('Failed to start Klickhaus TUI:', err.message);
  process.exit(1);
});
