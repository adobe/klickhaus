/**
 * TUI Utility Functions
 */

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format number with commas
 */
export function formatNumber(num) {
  if (num === null || num === undefined) return '-';
  return num.toLocaleString();
}

/**
 * Format duration in milliseconds
 */
export function formatDuration(ms) {
  if (ms < 1) return '< 1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Format percentage
 */
export function formatPercent(value, decimals = 1) {
  if (value === null || value === undefined) return '-';
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Truncate string to max length
 */
export function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '\u2026';
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Get status color based on HTTP status code
 */
export function getStatusColor(status) {
  const code = parseInt(status);
  if (code >= 500) return 'red';
  if (code >= 400) return 'yellow';
  if (code >= 300) return 'cyan';
  if (code >= 200) return 'green';
  return 'white';
}

/**
 * Get cache status color
 */
export function getCacheColor(status) {
  const upper = (status || '').toUpperCase();
  if (upper.startsWith('HIT')) return 'green';
  if (upper === 'MISS') return 'red';
  if (upper === 'PASS') return 'yellow';
  return 'white';
}

/**
 * Create a simple text-based bar
 */
export function textBar(value, max, width = 20) {
  const filled = Math.round((value / max) * width);
  const empty = width - filled;
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
}

/**
 * Create a status distribution bar
 */
export function statusBar(ok, error4xx, error5xx, width = 30) {
  const total = ok + error4xx + error5xx;
  if (total === 0) return ' '.repeat(width);

  const okWidth = Math.round((ok / total) * width);
  const e4xxWidth = Math.round((error4xx / total) * width);
  const e5xxWidth = width - okWidth - e4xxWidth;

  return '{green-fg}' + '\u2588'.repeat(okWidth) + '{/green-fg}' +
    '{yellow-fg}' + '\u2588'.repeat(e4xxWidth) + '{/yellow-fg}' +
    '{red-fg}' + '\u2588'.repeat(e5xxWidth) + '{/red-fg}';
}

/**
 * Parse command line arguments
 */
export function parseArgs(args) {
  const result = {
    host: process.env.CLICKHOUSE_HOST,
    user: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD,
    timeRange: '1h',
    hostFilter: ''
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '-h':
      case '--host':
        result.host = next;
        i++;
        break;
      case '-u':
      case '--user':
        result.user = next;
        i++;
        break;
      case '-p':
      case '--password':
        result.password = next;
        i++;
        break;
      case '-t':
      case '--time':
        result.timeRange = next;
        i++;
        break;
      case '--host-filter':
        result.hostFilter = next;
        i++;
        break;
      case '--help':
        result.showHelp = true;
        break;
    }
  }

  return result;
}

/**
 * Show help text
 */
export function showHelp() {
  console.log(`
Klickhaus TUI - Terminal User Interface for ClickHouse CDN Analytics

Usage: npx @adobe/klickhaus [options]

Options:
  -h, --host <host>     ClickHouse host
  -u, --user <user>     ClickHouse user (default: 'default')
  -p, --password <pwd>  ClickHouse password
  -t, --time <range>    Time range: 15m, 1h, 12h, 24h, 7d (default: 1h)
  --host-filter <host>  Filter by host pattern
  --help                Show this help message

Environment Variables:
  CLICKHOUSE_HOST       ClickHouse host URL
  CLICKHOUSE_USER       ClickHouse username
  CLICKHOUSE_PASSWORD   ClickHouse password

Navigation:
  Tab / Shift+Tab       Switch between panels
  Arrow keys            Navigate within panel
  Enter                 Select / Apply filter
  Escape                Go back / Clear
  q                     Quit
  r                     Refresh data
  1-9                   Switch time range
  f                     Focus host filter
  l                     Toggle logs view
  b                     Show breakdowns
  ?                     Show help
`);
}
