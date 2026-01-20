/**
 * Shared configuration for Cloudflare logpush to ClickHouse
 *
 * Required environment variables:
 *   CLICKHOUSE_PASSWORD - Password for logpush_writer user
 *
 * Optional environment variables:
 *   CLICKHOUSE_HOST - ClickHouse host (default: s2p5b8wmt5.eastus2.azure.clickhouse.cloud)
 *   CLICKHOUSE_PORT - ClickHouse port (default: 8443)
 *   CLICKHOUSE_USER - ClickHouse user (default: logpush_writer)
 *   CLICKHOUSE_TABLE - Target table (default: helix_logs_production.cloudflare_http_requests)
 */

export const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || 's2p5b8wmt5.eastus2.azure.clickhouse.cloud';
export const CLICKHOUSE_PORT = process.env.CLICKHOUSE_PORT || 8443;
export const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || 'logpush_writer';
export const { CLICKHOUSE_PASSWORD } = process.env;
export const CLICKHOUSE_TABLE = process.env.CLICKHOUSE_TABLE || 'helix_logs_production.cloudflare_http_requests';

/**
 * Validate that ClickHouse credentials are available (call before using ClickHouse functions)
 */
export function requireClickHousePassword() {
  if (!CLICKHOUSE_PASSWORD) {
    console.error('Error: CLICKHOUSE_PASSWORD environment variable is required');
    process.exit(1);
  }
}

// All Enterprise zones in the Helix account
export const ENTERPRISE_ZONES = [
  'aem.live',
  'aem.page',
  'aem-cloudflare.live',
  'aem-cloudflare.page',
  'hlx.live',
  'hlx.page',
  'hlx-cloudflare.live',
  'hlx-cloudflare.page',
];

// Full field set - matches Coralogix plus Referer/UserAgent
export const LOGPUSH_FIELDS = [
  // Core identifiers
  'EdgeStartTimestamp',
  'EdgeEndTimestamp',
  'RayID',
  'ParentRayID',
  'ZoneName',
  // Client info
  'ClientIP',
  'ClientASN',
  'ClientCountry',
  'ClientRegionCode',
  'ClientDeviceType',
  'ClientIPClass',
  'ClientSrcPort',
  'ClientTCPRTTMs',
  'ClientSSLCipher',
  'ClientSSLProtocol',
  'ClientMTLSAuthCertFingerprint',
  'ClientMTLSAuthStatus',
  'ClientXRequestedWith',
  // Client request
  'ClientRequestHost',
  'ClientRequestMethod',
  'ClientRequestURI',
  'ClientRequestPath',
  'ClientRequestProtocol',
  'ClientRequestScheme',
  'ClientRequestSource',
  'ClientRequestBytes',
  'ClientRequestReferer',
  'ClientRequestUserAgent',
  'Cookies',
  'RequestHeaders',
  // Cache
  'CacheCacheStatus',
  'CacheResponseBytes',
  'CacheResponseStatus',
  'CacheTieredFill',
  // Edge response
  'EdgeColoCode',
  'EdgeColoID',
  'EdgeResponseStatus',
  'EdgeResponseContentType',
  'EdgeResponseBytes',
  'EdgeResponseBodyBytes',
  'EdgeResponseCompressionRatio',
  'EdgeTimeToFirstByteMs',
  'EdgeServerIP',
  'EdgeRequestHost',
  'EdgeCFConnectingO2O',
  'EdgePathingOp',
  'EdgePathingSrc',
  'EdgePathingStatus',
  'EdgeRateLimitAction',
  'EdgeRateLimitID',
  'ResponseHeaders',
  // Origin
  'OriginIP',
  'OriginResponseStatus',
  'OriginResponseBytes',
  'OriginResponseTime',
  'OriginResponseDurationMs',
  'OriginResponseHTTPExpires',
  'OriginResponseHTTPLastModified',
  'OriginResponseHeaderReceiveDurationMs',
  'OriginRequestHeaderSendDurationMs',
  'OriginDNSResponseTimeMs',
  'OriginTCPHandshakeDurationMs',
  'OriginTLSHandshakeDurationMs',
  'OriginSSLProtocol',
  // Routing
  'SmartRouteColoID',
  'UpperTierColoID',
  // Security
  'SecurityLevel',
  'ContentScanObjResults',
  'ContentScanObjTypes',
  // Worker
  'WorkerCPUTime',
  'WorkerStatus',
  'WorkerSubrequest',
  'WorkerSubrequestCount',
  'WorkerWallTimeUs',
];

// Custom fields for RequestHeaders - superset of all zones
export const REQUEST_HEADERS = [
  'accept',
  'accept-content',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'cdn-loop',
  'cf-connecting-ip',
  'if-modified-since',
  'if-none-match',
  'range',
  'referer',
  'true-client-ip',
  'user-agent',
  'via',
  'x-byo-cdn-type',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-hipaa',
  'x-push-invalidation',
];

// Custom fields for ResponseHeaders - superset of all zones
export const RESPONSE_HEADERS = [
  'cache-control',
  'cache-tag',
  'cdn-cache-control',
  'cf-resized',
  'content-encoding',
  'content-length',
  'content-range',
  'content-type',
  'edge-cache-tag',
  'edge-control',
  'etag',
  'expires',
  'last-modified',
  'location',
  'surrogate-control',
  'surrogate-key',
  'vary',
  'x-error',
  'x-robots-tag',
];

/**
 * Make a Cloudflare API request
 */
export async function cfApi(endpoint, token, method = 'GET', body = null) {
  const url = `https://api.cloudflare.com/client/v4${endpoint}`;
  const options = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!data.success) {
    const errors = data.errors?.map((e) => e.message).join(', ') || 'Unknown error';
    throw new Error(errors);
  }

  return data;
}

/**
 * Resolve a zone name to its ID
 */
export async function getZoneId(token, zoneIdOrName) {
  if (/^[a-f0-9]{32}$/i.test(zoneIdOrName)) {
    return zoneIdOrName;
  }
  const data = await cfApi(`/zones?name=${encodeURIComponent(zoneIdOrName)}`, token);
  if (!data.result || data.result.length === 0) {
    throw new Error(`Zone not found: ${zoneIdOrName}`);
  }
  return data.result[0].id;
}

/**
 * Build the ClickHouse destination URL for logpush
 */
export function buildDestinationUrl() {
  const query = `INSERT INTO ${CLICKHOUSE_TABLE} FORMAT JSONEachRow`;
  const destinationUrl = new URL(`https://${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT}/`);
  destinationUrl.searchParams.set('query', query);
  destinationUrl.searchParams.set('enable_http_compression', '1');
  destinationUrl.searchParams.set('async_insert', '1');
  destinationUrl.searchParams.set('wait_for_async_insert', '0');
  destinationUrl.searchParams.set('header_X-ClickHouse-User', CLICKHOUSE_USER);
  destinationUrl.searchParams.set('header_X-ClickHouse-Key', CLICKHOUSE_PASSWORD);
  return destinationUrl.toString();
}

/**
 * Build the logpush job configuration
 */
export function buildJobConfig(zoneName) {
  return {
    name: `${zoneName}-http-to-clickhouse`,
    destination_conf: buildDestinationUrl(),
    dataset: 'http_requests',
    enabled: true,
    logstream: true,
    frequency: 'high',
    output_options: {
      field_names: LOGPUSH_FIELDS,
      timestamp_format: 'unixnano',
    },
  };
}
