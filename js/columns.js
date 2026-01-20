// Centralized column metadata for logs and facets

/**
 * @typedef {Object} ColumnDefinition
 * @property {string} logKey - Column name in log rows.
 * @property {string} facetCol - SQL expression used for facet queries/filters.
 * @property {string} [label] - Human-readable label.
 * @property {string} [shortLabel] - Compact label for tight UI.
 * @property {(value: unknown) => string} [filterTransform] - Optional filter value transform.
 */

/** @type {Record<string, ColumnDefinition>} */
export const COLUMN_DEFS = {
  status: {
    logKey: 'response.status',
    facetCol: 'toString(`response.status`)',
    label: 'Status',
    shortLabel: 'status',
    filterTransform: (value) => String(value),
  },
  method: {
    logKey: 'request.method',
    facetCol: '`request.method`',
    label: 'Method',
    shortLabel: 'method',
  },
  host: {
    logKey: 'request.host',
    facetCol: '`request.host`',
    label: 'Host',
  },
  url: {
    logKey: 'request.url',
    facetCol: '`request.url`',
    label: 'URL',
  },
  cacheStatus: {
    logKey: 'cdn.cache_status',
    facetCol: 'upper(`cdn.cache_status`)',
    label: 'Cache',
    shortLabel: 'cache',
    filterTransform: (value) => String(value).toUpperCase(),
  },
  contentType: {
    logKey: 'response.headers.content_type',
    facetCol: '`response.headers.content_type`',
    label: 'Content Type',
  },
  requestType: {
    logKey: 'helix.request_type',
    facetCol: '`helix.request_type`',
    label: 'Request Type',
    shortLabel: 'type',
  },
  backendType: {
    logKey: 'helix.backend_type',
    facetCol: '`helix.backend_type`',
    label: 'Backend Type',
    shortLabel: 'backend',
  },
  forwardedHost: {
    logKey: 'request.headers.x_forwarded_host',
    facetCol: '`request.headers.x_forwarded_host`',
    label: 'Forwarded Host',
  },
  referer: {
    logKey: 'request.headers.referer',
    facetCol: '`request.headers.referer`',
    label: 'Referer',
  },
  userAgent: {
    logKey: 'request.headers.user_agent',
    facetCol: '`request.headers.user_agent`',
    label: 'User Agent',
  },
  error: {
    logKey: 'response.headers.x_error',
    facetCol: '`response.headers.x_error`',
    label: 'Error',
  },
  clientIp: {
    logKey: 'client.ip',
    facetCol: "if(`request.headers.x_forwarded_for` != '', `request.headers.x_forwarded_for`, `client.ip`)",
    label: 'Client IP',
  },
  forwardedFor: {
    logKey: 'request.headers.x_forwarded_for',
    facetCol: "if(`request.headers.x_forwarded_for` != '', `request.headers.x_forwarded_for`, `client.ip`)",
    label: 'Forwarded For',
  },
  accept: {
    logKey: 'request.headers.accept',
    facetCol: '`request.headers.accept`',
    label: 'Accept',
  },
  acceptEncoding: {
    logKey: 'request.headers.accept_encoding',
    facetCol: '`request.headers.accept_encoding`',
    label: 'Accept Encoding',
  },
  cacheControl: {
    logKey: 'request.headers.cache_control',
    facetCol: '`request.headers.cache_control`',
    label: 'Cache Control',
  },
  byoCdn: {
    logKey: 'request.headers.x_byo_cdn_type',
    facetCol: '`request.headers.x_byo_cdn_type`',
    label: 'BYO CDN',
  },
  location: {
    logKey: 'response.headers.location',
    facetCol: '`response.headers.location`',
    label: 'Location',
  },
};

/**
 * Log columns in preferred display order (also used for color-coding priority).
 * @type {string[]}
 */
export const LOG_COLUMN_ORDER = [
  'timestamp',
  COLUMN_DEFS.status.logKey,
  COLUMN_DEFS.method.logKey,
  COLUMN_DEFS.host.logKey,
  COLUMN_DEFS.url.logKey,
  COLUMN_DEFS.cacheStatus.logKey,
  COLUMN_DEFS.contentType.logKey,
  COLUMN_DEFS.requestType.logKey,
  COLUMN_DEFS.backendType.logKey,
  COLUMN_DEFS.forwardedHost.logKey,
  COLUMN_DEFS.referer.logKey,
  COLUMN_DEFS.userAgent.logKey,
  COLUMN_DEFS.clientIp.logKey,
  COLUMN_DEFS.forwardedFor.logKey,
  COLUMN_DEFS.error.logKey,
  COLUMN_DEFS.accept.logKey,
  COLUMN_DEFS.acceptEncoding.logKey,
  COLUMN_DEFS.cacheControl.logKey,
  COLUMN_DEFS.byoCdn.logKey,
  COLUMN_DEFS.location.logKey,
];

/**
 * Log columns that map to facets with optional transforms.
 * @type {Record<string, { col: string, transform?: (value: unknown) => string }>}
 */
export const LOG_COLUMN_TO_FACET = Object.fromEntries(
  Object.values(COLUMN_DEFS)
    .filter((def) => def.logKey && def.facetCol)
    .map((def) => [
      def.logKey,
      {
        col: def.facetCol,
        transform: def.filterTransform,
      },
    ]),
);

/**
 * Short label mapping for log columns.
 * @type {Record<string, string>}
 */
export const LOG_COLUMN_SHORT_LABELS = Object.fromEntries(
  Object.values(COLUMN_DEFS)
    .filter((def) => def.shortLabel)
    .map((def) => [def.logKey, def.shortLabel]),
);
