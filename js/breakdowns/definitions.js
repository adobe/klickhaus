// Breakdown table definitions
import { hostLink, forwardedHostLink, refererLink, pathLink } from './links.js';
import { escapeHtml } from '../utils.js';

// Format ASN as "15169 google llc" with number dimmed
export function formatAsn(dim) {
  const spaceIdx = dim.indexOf(' ');
  if (spaceIdx === -1) return escapeHtml(dim);
  const num = dim.slice(0, spaceIdx + 1); // include space
  const name = dim.slice(spaceIdx + 1);
  return `<span class="dim-prefix">${escapeHtml(num)}</span>${escapeHtml(name)}`;
}

// Format forwarded host as "customer.com, aem-host" with ", aem-host" dimmed
export function formatForwardedHost(dim) {
  const commaIdx = dim.indexOf(', ');
  if (commaIdx === -1) return escapeHtml(dim);
  const customerHost = dim.slice(0, commaIdx);
  const aemHost = dim.slice(commaIdx); // includes ", "
  return `${escapeHtml(customerHost)}<span class="dim-prefix">${escapeHtml(aemHost)}</span>`;
}

export const allBreakdowns = [
  { id: 'breakdown-status-range', col: "concat(toString(intDiv(`response.status`, 100)), 'xx')", summaryCountIf: "`response.status` >= 500", summaryLabel: 'error rate', summaryColor: 'error' },
  { id: 'breakdown-hosts', col: '`request.host`', linkFn: hostLink, dimPrefixes: ['main--'], summaryCountIf: "`request.host` LIKE '%.aem.live'", summaryLabel: 'live' },
  { id: 'breakdown-forwarded-hosts', col: "if(`request.headers.x_forwarded_host` = `request.host`, '(same)', `request.headers.x_forwarded_host`)", linkFn: forwardedHostLink, dimFormatFn: formatForwardedHost, summaryCountIf: "`request.headers.x_forwarded_host` != '' AND `request.headers.x_forwarded_host` != `request.host`", summaryLabel: 'production' },
  { id: 'breakdown-content-types', col: '`response.headers.content_type`' },
  { id: 'breakdown-status', col: 'toString(`response.status`)' },
  { id: 'breakdown-errors', col: '`response.headers.x_error`', extraFilter: "AND `response.headers.x_error` != ''" },
  { id: 'breakdown-cache', col: 'upper(`cdn.cache_status`)', summaryCountIf: "upper(`cdn.cache_status`) LIKE 'HIT%'", summaryLabel: 'cache efficiency' },
  { id: 'breakdown-paths', col: '`request.url`', linkFn: pathLink },
  { id: 'breakdown-referers', col: '`request.headers.referer`', linkFn: refererLink, dimPrefixes: ['https://', 'http://'] },
  { id: 'breakdown-user-agents', col: '`request.headers.user_agent`', dimPrefixes: ['Mozilla/5.0 '], summaryCountIf: "NOT `request.headers.user_agent` LIKE 'Mozilla/%' OR `request.headers.user_agent` LIKE '%+http%'", summaryLabel: 'bot rate', summaryColor: 'warning' },
  { id: 'breakdown-ips', col: "if(`request.headers.x_forwarded_for` != '', `request.headers.x_forwarded_for`, `client.ip`)", linkPrefix: 'https://centralops.net/co/DomainDossier?dom_whois=1&net_whois=1&addr=', summaryCountIf: "if(`request.headers.x_forwarded_for` != '', `request.headers.x_forwarded_for`, `client.ip`) LIKE '%:%'", summaryLabel: 'IPv6' },
  { id: 'breakdown-request-type', col: '`helix.request_type`', extraFilter: "AND `helix.request_type` != ''" },
  { id: 'breakdown-backend-type', col: '`helix.backend_type`', extraFilter: "AND `helix.backend_type` != ''" },
  { id: 'breakdown-methods', col: '`request.method`', summaryCountIf: "`request.method` IN ('POST', 'PUT', 'PATCH', 'DELETE')", summaryLabel: 'writes', summaryColor: 'warning' },
  { id: 'breakdown-datacenters', col: '`cdn.datacenter`' },
  { id: 'breakdown-asn', col: "concat(toString(`client.asn`), ' ', dictGet('helix_logs_production.asn_dict', 'name', `client.asn`))", filterCol: '`client.asn`', filterValueFn: (v) => parseInt(v.split(' ')[0]), dimFormatFn: formatAsn, extraFilter: "AND `client.asn` != 0", linkPrefix: 'https://mxtoolbox.com/SuperTool.aspx?action=asn%3aAS', linkSuffix: '&run=toolpage' },
  { id: 'breakdown-accept', col: '`request.headers.accept`', extraFilter: "AND `request.headers.accept` != ''" },
  { id: 'breakdown-accept-encoding', col: '`request.headers.accept_encoding`', extraFilter: "AND `request.headers.accept_encoding` != ''" },
  { id: 'breakdown-req-cache-control', col: '`request.headers.cache_control`', extraFilter: "AND `request.headers.cache_control` != ''" },
  { id: 'breakdown-byo-cdn', col: '`request.headers.x_byo_cdn_type`', extraFilter: "AND `request.headers.x_byo_cdn_type` != ''" },
  { id: 'breakdown-push-invalidation', col: '`request.headers.x_push_invalidation`', extraFilter: "AND `request.headers.x_push_invalidation` != ''" },
  { id: 'breakdown-content-length', col: "multiIf(`response.headers.content_length` = 0, '0 (empty)', `response.headers.content_length` < 100, '1-100 B', `response.headers.content_length` < 500, '100-500 B', `response.headers.content_length` < 1024, '500 B - 1 KB', `response.headers.content_length` < 5120, '1-5 KB', `response.headers.content_length` < 10240, '5-10 KB', `response.headers.content_length` < 51200, '10-50 KB', `response.headers.content_length` < 102400, '50-100 KB', `response.headers.content_length` < 512000, '100-500 KB', `response.headers.content_length` < 1048576, '500 KB - 1 MB', `response.headers.content_length` < 10485760, '1-10 MB', '> 10 MB')", orderBy: "min(`response.headers.content_length`)" },
  { id: 'breakdown-location', col: '`response.headers.location`', extraFilter: "AND `response.headers.location` != ''" },
  { id: 'breakdown-time-elapsed', col: "multiIf(`cdn.time_elapsed_msec` < 5, '< 5ms', `cdn.time_elapsed_msec` < 10, '5-10ms', `cdn.time_elapsed_msec` < 20, '10-20ms', `cdn.time_elapsed_msec` < 35, '20-35ms', `cdn.time_elapsed_msec` < 50, '35-50ms', `cdn.time_elapsed_msec` < 100, '50-100ms', `cdn.time_elapsed_msec` < 250, '100-250ms', `cdn.time_elapsed_msec` < 500, '250-500ms', `cdn.time_elapsed_msec` < 1000, '500ms - 1s', '≥ 1s')", orderBy: "min(`cdn.time_elapsed_msec`)", summaryCountIf: "`cdn.time_elapsed_msec` >= 1000", summaryLabel: 'slow (≥1s)', summaryColor: 'warning' }
];
