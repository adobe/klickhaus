/**
 * TUI Configuration
 */

export const CLICKHOUSE_URL = process.env.CLICKHOUSE_HOST ||
  'https://ogadftwx3q.us-east1.gcp.clickhouse.cloud/';

export const DATABASE = 'helix_logs_production';

// Time range configurations
export const TIME_RANGES = {
  '15m': {
    label: 'Last 15 minutes',
    interval: 'INTERVAL 15 MINUTE',
    bucket: 'toStartOfInterval(timestamp, INTERVAL 30 SECOND)',
    periodMs: 15 * 60 * 1000,
    cacheTtl: 60
  },
  '1h': {
    label: 'Last hour',
    interval: 'INTERVAL 1 HOUR',
    bucket: 'toStartOfMinute(timestamp)',
    periodMs: 60 * 60 * 1000,
    cacheTtl: 300
  },
  '12h': {
    label: 'Last 12 hours',
    interval: 'INTERVAL 12 HOUR',
    bucket: 'toStartOfTenMinutes(timestamp)',
    periodMs: 12 * 60 * 60 * 1000,
    cacheTtl: 600
  },
  '24h': {
    label: 'Last 24 hours',
    interval: 'INTERVAL 24 HOUR',
    bucket: 'toStartOfFifteenMinutes(timestamp)',
    periodMs: 24 * 60 * 60 * 1000,
    cacheTtl: 900
  },
  '7d': {
    label: 'Last 7 days',
    interval: 'INTERVAL 7 DAY',
    bucket: 'toStartOfHour(timestamp)',
    periodMs: 7 * 24 * 60 * 60 * 1000,
    cacheTtl: 1800
  }
};

// Breakdown facet definitions
export const BREAKDOWNS = [
  { id: 'status-range', label: 'Status Range', col: "concat(toString(intDiv(`response.status`, 100)), 'xx')" },
  { id: 'hosts', label: 'Hosts', col: '`request.host`' },
  { id: 'forwarded-hosts', label: 'Forwarded Hosts', col: '`request.headers.x_forwarded_host`' },
  { id: 'content-types', label: 'Content Types', col: '`response.headers.content_type`' },
  { id: 'status', label: 'Status Codes', col: 'toString(`response.status`)' },
  { id: 'errors', label: 'Errors', col: '`response.headers.x_error`', extraFilter: "AND `response.headers.x_error` != ''" },
  { id: 'cache', label: 'Cache Status', col: 'upper(`cdn.cache_status`)' },
  { id: 'paths', label: 'Paths', col: '`request.url`' },
  { id: 'referers', label: 'Referers', col: '`request.headers.referer`' },
  { id: 'user-agents', label: 'User Agents', col: '`request.headers.user_agent`' },
  { id: 'ips', label: 'IP Addresses', col: "if(`request.headers.x_forwarded_for` != '', `request.headers.x_forwarded_for`, `client.ip`)" },
  { id: 'request-type', label: 'Request Types', col: '`helix.request_type`', extraFilter: "AND `helix.request_type` != ''" },
  { id: 'backend-type', label: 'Backend Types', col: '`helix.backend_type`', extraFilter: "AND `helix.backend_type` != ''" },
  { id: 'methods', label: 'HTTP Methods', col: '`request.method`' },
  { id: 'datacenters', label: 'Datacenters', col: '`cdn.datacenter`' },
  { id: 'asn', label: 'ASN', col: "concat(toString(`client.asn`), ' ', dictGet('helix_logs_production.asn_dict', 'name', `client.asn`))", filterCol: '`client.asn`', extraFilter: "AND `client.asn` != 0" },
  { id: 'accept', label: 'Accept Header', col: '`request.headers.accept`', extraFilter: "AND `request.headers.accept` != ''" },
  { id: 'accept-encoding', label: 'Accept-Encoding', col: '`request.headers.accept_encoding`', extraFilter: "AND `request.headers.accept_encoding` != ''" },
  { id: 'cache-control', label: 'Cache-Control', col: '`request.headers.cache_control`', extraFilter: "AND `request.headers.cache_control` != ''" },
  { id: 'time-elapsed', label: 'Response Time', col: "multiIf(`cdn.time_elapsed_msec` < 5, '< 5ms', `cdn.time_elapsed_msec` < 10, '5-10ms', `cdn.time_elapsed_msec` < 20, '10-20ms', `cdn.time_elapsed_msec` < 35, '20-35ms', `cdn.time_elapsed_msec` < 50, '35-50ms', `cdn.time_elapsed_msec` < 100, '50-100ms', `cdn.time_elapsed_msec` < 250, '100-250ms', `cdn.time_elapsed_msec` < 500, '250-500ms', `cdn.time_elapsed_msec` < 1000, '500ms - 1s', '>= 1s')", orderBy: "min(`cdn.time_elapsed_msec`)" }
];

// Log columns for display
export const LOG_COLUMNS = [
  { key: 'timestamp', label: 'Time', width: 20 },
  { key: 'response.status', label: 'Status', width: 6 },
  { key: 'request.method', label: 'Method', width: 7 },
  { key: 'request.host', label: 'Host', width: 30 },
  { key: 'request.url', label: 'Path', width: 40 },
  { key: 'cdn.cache_status', label: 'Cache', width: 10 },
  { key: 'response.headers.content_type', label: 'Content-Type', width: 25 },
  { key: 'cdn.time_elapsed_msec', label: 'Time(ms)', width: 10 },
  { key: 'response.body_size', label: 'Size', width: 12 },
  { key: 'client.country_name', label: 'Country', width: 15 }
];
