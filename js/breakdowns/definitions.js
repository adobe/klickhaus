/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import {
  hostLink, forwardedHostLink, refererLink, pathLink,
} from './links.js';
import { escapeHtml } from '../utils.js';
import {
  contentLengthBuckets, timeElapsedBuckets, getContentLengthLabels, getTimeElapsedLabels,
} from './buckets.js';
import { COLUMN_DEFS } from '../columns.js';

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
  {
    id: 'breakdown-status-range', col: "concat(toString(intDiv(`response.status`, 100)), 'xx')", summaryCountIf: '`response.status` >= 500', summaryLabel: 'error rate', summaryColor: 'error',
  },
  {
    id: 'breakdown-hosts', col: COLUMN_DEFS.host.facetCol, linkFn: hostLink, dimPrefixes: ['main--'], summaryCountIf: "`request.host` LIKE '%.aem.live'", summaryLabel: 'live',
  },
  {
    id: 'breakdown-forwarded-hosts', col: "if(`request.headers.x_forwarded_host` = `request.host`, '(same)', `request.headers.x_forwarded_host`)", linkFn: forwardedHostLink, dimFormatFn: formatForwardedHost, summaryCountIf: "`request.headers.x_forwarded_host` != '' AND `request.headers.x_forwarded_host` != `request.host`", summaryLabel: 'production',
  },
  { id: 'breakdown-content-types', col: COLUMN_DEFS.contentType.facetCol, modeToggle: 'contentTypeMode' },
  { id: 'breakdown-status', col: COLUMN_DEFS.status.facetCol, modeToggle: 'contentTypeMode' },
  {
    id: 'breakdown-errors',
    col: COLUMN_DEFS.errorGrouped.facetCol,
    filterCol: '`response.headers.x_error`',
    // Convert grouped display value to LIKE pattern (replace /... with %)
    filterValueFn: (v) => v.replace(/\/\.\.\./g, '/%'),
    filterOp: 'LIKE',
    extraFilter: "AND `response.headers.x_error` != ''",
  },
  {
    id: 'breakdown-cache', col: COLUMN_DEFS.cacheStatus.facetCol, summaryCountIf: "upper(`cdn.cache_status`) LIKE 'HIT%'", summaryLabel: 'cache efficiency',
  },
  {
    id: 'breakdown-paths', col: COLUMN_DEFS.url.facetCol, linkFn: pathLink, modeToggle: 'contentTypeMode',
  },
  {
    id: 'breakdown-referers', col: COLUMN_DEFS.referer.facetCol, linkFn: refererLink, dimPrefixes: ['https://', 'http://'],
  },
  {
    id: 'breakdown-user-agents', col: COLUMN_DEFS.userAgent.facetCol, dimPrefixes: ['Mozilla/5.0 '], summaryCountIf: "NOT `request.headers.user_agent` LIKE 'Mozilla/%' OR `request.headers.user_agent` LIKE '%+http%'", summaryLabel: 'bot rate', summaryColor: 'warning',
  },
  {
    id: 'breakdown-ips', col: COLUMN_DEFS.clientIp.facetCol, linkPrefix: 'https://centralops.net/co/DomainDossier?dom_whois=1&net_whois=1&addr=', summaryCountIf: "if(`request.headers.x_forwarded_for` != '', `request.headers.x_forwarded_for`, `client.ip`) LIKE '%:%'", summaryLabel: 'IPv6',
  },
  {
    id: 'breakdown-request-type', col: COLUMN_DEFS.requestType.facetCol, extraFilter: "AND `helix.request_type` != ''", modeToggle: 'contentTypeMode',
  },
  {
    id: 'breakdown-backend-type', col: COLUMN_DEFS.backendType.facetCol, extraFilter: "AND `helix.backend_type` != ''", modeToggle: 'contentTypeMode',
  },
  {
    id: 'breakdown-methods', col: COLUMN_DEFS.method.facetCol, summaryCountIf: "`request.method` IN ('POST', 'PUT', 'PATCH', 'DELETE')", summaryLabel: 'writes', summaryColor: 'warning',
  },
  { id: 'breakdown-datacenters', col: '`cdn.datacenter`', modeToggle: 'contentTypeMode' },
  {
    id: 'breakdown-asn', col: "concat(toString(`client.asn`), ' ', dictGet('helix_logs_production.asn_dict', 'name', `client.asn`))", filterCol: '`client.asn`', filterValueFn: (v) => parseInt(v.split(' ')[0], 10), dimFormatFn: formatAsn, extraFilter: 'AND `client.asn` != 0', linkPrefix: 'https://mxtoolbox.com/SuperTool.aspx?action=asn%3aAS', linkSuffix: '&run=toolpage', modeToggle: 'contentTypeMode',
  },
  {
    id: 'breakdown-accept', col: COLUMN_DEFS.accept.facetCol, extraFilter: "AND `request.headers.accept` != ''", modeToggle: 'contentTypeMode',
  },
  {
    id: 'breakdown-accept-encoding', col: COLUMN_DEFS.acceptEncoding.facetCol, extraFilter: "AND `request.headers.accept_encoding` != ''", modeToggle: 'contentTypeMode',
  },
  {
    id: 'breakdown-req-cache-control', col: COLUMN_DEFS.cacheControl.facetCol, extraFilter: "AND `request.headers.cache_control` != ''", modeToggle: 'contentTypeMode',
  },
  {
    id: 'breakdown-byo-cdn', col: COLUMN_DEFS.byoCdn.facetCol, extraFilter: "AND `request.headers.x_byo_cdn_type` != ''", modeToggle: 'contentTypeMode',
  },
  { id: 'breakdown-push-invalidation', col: '`request.headers.x_push_invalidation`', extraFilter: "AND `request.headers.x_push_invalidation` != ''" },
  {
    id: 'breakdown-content-length', col: contentLengthBuckets, orderBy: 'min(`response.headers.content_length`)', modeToggle: 'contentTypeMode', getExpectedLabels: getContentLengthLabels,
  },
  { id: 'breakdown-location', col: COLUMN_DEFS.location.facetCol, extraFilter: "AND `response.headers.location` != ''" },
  {
    id: 'breakdown-time-elapsed', col: timeElapsedBuckets, orderBy: 'min(`cdn.time_elapsed_msec`)', summaryCountIf: '`cdn.time_elapsed_msec` >= 1000', summaryLabel: 'slow (≥1s)', summaryColor: 'warning', getExpectedLabels: getTimeElapsedLabels,
  },
];
