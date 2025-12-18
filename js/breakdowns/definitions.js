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

export const allBreakdowns = [
  { id: 'breakdown-status-range', col: "concat(toString(intDiv(`response.status`, 100)), 'xx')" },
  { id: 'breakdown-hosts', col: '`request.host`', linkFn: hostLink, dimPrefixes: ['main--'] },
  { id: 'breakdown-forwarded-hosts', col: '`request.headers.x_forwarded_host`', linkFn: forwardedHostLink },
  { id: 'breakdown-content-types', col: '`response.headers.content_type`' },
  { id: 'breakdown-status', col: 'toString(`response.status`)' },
  { id: 'breakdown-errors', col: '`response.headers.x_error`', extraFilter: "AND `response.headers.x_error` != ''" },
  { id: 'breakdown-cache', col: 'upper(`cdn.cache_status`)' },
  { id: 'breakdown-paths', col: '`request.url`', linkFn: pathLink },
  { id: 'breakdown-referers', col: '`request.headers.referer`', linkFn: refererLink, dimPrefixes: ['https://', 'http://'] },
  { id: 'breakdown-user-agents', col: '`request.headers.user_agent`', dimPrefixes: ['Mozilla/5.0 '] },
  { id: 'breakdown-ips', col: "if(`request.headers.x_forwarded_for` != '', `request.headers.x_forwarded_for`, `client.ip`)", linkPrefix: 'https://centralops.net/co/DomainDossier?dom_whois=1&net_whois=1&addr=' },
  { id: 'breakdown-request-type', col: '`helix.request_type`', extraFilter: "AND `helix.request_type` != ''" },
  { id: 'breakdown-backend-type', col: '`helix.backend_type`', extraFilter: "AND `helix.backend_type` != ''" },
  { id: 'breakdown-methods', col: '`request.method`' },
  { id: 'breakdown-datacenters', col: '`cdn.datacenter`' },
  { id: 'breakdown-asn', col: "concat(toString(`client.asn`), ' ', dictGet('helix_logs_production.asn_dict', 'name', `client.asn`))", filterCol: '`client.asn`', filterValueFn: (v) => parseInt(v.split(' ')[0]), dimFormatFn: formatAsn, extraFilter: "AND `client.asn` != 0", linkPrefix: 'https://mxtoolbox.com/SuperTool.aspx?action=asn%3aAS', linkSuffix: '&run=toolpage' }
];
