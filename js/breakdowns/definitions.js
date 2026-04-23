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
  ratelimitRateBuckets, getRatelimitRateLabels,
} from './buckets.js';
import { COLUMN_DEFS } from '../columns.js';

// Format ASN as "15169 google llc" with number dimmed
export function formatAsn(dim) {
  const spaceIdx = dim.indexOf(' ');
  if (spaceIdx === -1) {
    return escapeHtml(dim);
  }
  const num = dim.slice(0, spaceIdx + 1); // include space
  const name = dim.slice(spaceIdx + 1);
  return `<span class="dim-prefix">${escapeHtml(num)}</span>${escapeHtml(name)}`;
}

// Format forwarded host as "customer.com, aem-host" with ", aem-host" dimmed
export function formatForwardedHost(dim) {
  const commaIdx = dim.indexOf(', ');
  if (commaIdx === -1) {
    return escapeHtml(dim);
  }
  const customerHost = dim.slice(0, commaIdx);
  const aemHost = dim.slice(commaIdx); // includes ", "
  return `${escapeHtml(customerHost)}<span class="dim-prefix">${escapeHtml(aemHost)}</span>`;
}

export const allBreakdowns = [
  {
    id: 'breakdown-status-range', col: "concat(toString(intDiv(`response.status`, 100)), 'xx')", facetName: 'status_range', summaryCountIf: '`response.status` >= 500', summaryDimCondition: "dim = '5xx'", summaryLabel: 'error rate', summaryColor: 'error',
  },
  {
    id: 'breakdown-source', col: '`source`', facetName: 'source', summaryCountIf: '`source` = \'fastly\'', summaryDimCondition: "dim = 'fastly'", summaryLabel: 'fastly',
  },
  {
    id: 'breakdown-hosts', col: COLUMN_DEFS.host.facetCol, facetName: 'host', linkFn: hostLink, dimPrefixes: ['main--'], summaryCountIf: "`request.host` LIKE '%.aem.live'", summaryDimCondition: "dim LIKE '%.aem.live'", summaryLabel: 'live', highCardinality: true,
  },
  {
    id: 'breakdown-forwarded-hosts', col: '`request.headers.x_forwarded_host`', facetName: 'x_forwarded_host', linkFn: forwardedHostLink, dimFormatFn: formatForwardedHost, summaryCountIf: "`request.headers.x_forwarded_host` != ''", summaryDimCondition: "dim != ''", summaryLabel: 'production', highCardinality: true,
  },
  {
    id: 'breakdown-content-types', col: COLUMN_DEFS.contentType.facetCol, facetName: 'content_type', modeToggle: 'contentTypeMode',
  },
  {
    id: 'breakdown-status', col: COLUMN_DEFS.status.facetCol, facetName: 'status', modeToggle: 'contentTypeMode',
  },
  {
    id: 'breakdown-errors',
    col: COLUMN_DEFS.errorGrouped.facetCol,
    facetName: 'x_error_grouped',
    filterCol: '`response.headers.x_error`',
    // Convert grouped display value to LIKE pattern (replace /... with %)
    filterValueFn: (v) => v.replace(/\/\.\.\./g, '/%'),
    filterOp: 'LIKE',
    extraFilter: "AND `response.headers.x_error` != ''",
  },

  {
    id: 'breakdown-paths', col: COLUMN_DEFS.url.facetCol, facetName: 'url', linkFn: pathLink, modeToggle: 'contentTypeMode', highCardinality: true,
  },
  {
    id: 'breakdown-referers', col: COLUMN_DEFS.referer.facetCol, facetName: 'referer', linkFn: refererLink, dimPrefixes: ['https://', 'http://'], highCardinality: true,
  },
  {
    id: 'breakdown-user-agents', col: COLUMN_DEFS.userAgent.facetCol, facetName: 'user_agent', dimPrefixes: ['Mozilla/5.0 '], summaryCountIf: "NOT `request.headers.user_agent` LIKE 'Mozilla/%' OR `request.headers.user_agent` LIKE '%+http%'", summaryDimCondition: "NOT dim LIKE 'Mozilla/%' OR dim LIKE '%+http%'", summaryLabel: 'bot rate', summaryColor: 'warning', highCardinality: true,
  },
  {
    id: 'breakdown-ips', col: COLUMN_DEFS.originatingIp.facetCol, facetName: 'originating_ip', linkPrefix: 'https://centralops.net/co/DomainDossier?dom_whois=1&net_whois=1&addr=', summaryCountIf: '`cdn.originating_ip` LIKE \'%:%\'', summaryDimCondition: "dim LIKE '%:%'", summaryLabel: 'IPv6', highCardinality: true,
  },
  {
    id: 'breakdown-request-type', col: COLUMN_DEFS.requestType.facetCol, facetName: 'request_type', extraFilter: "AND `helix.request_type` != ''", modeToggle: 'contentTypeMode',
  },
  {
    id: 'breakdown-tech-stack', col: COLUMN_DEFS.backendType.facetCol, facetName: 'backend_type', modeToggle: 'contentTypeMode',
  },
  {
    id: 'breakdown-methods', col: COLUMN_DEFS.method.facetCol, facetName: 'method', summaryCountIf: "`request.method` IN ('POST', 'PUT', 'PATCH', 'DELETE')", summaryDimCondition: "dim IN ('POST', 'PUT', 'PATCH', 'DELETE')", summaryLabel: 'writes', summaryColor: 'warning',
  },
  {
    id: 'breakdown-datacenters', col: '`cdn.datacenter`', facetName: 'datacenter', modeToggle: 'contentTypeMode',
  },
  {
    id: 'breakdown-asn', col: "concat(toString(`client.asn`), ' ', dictGet('helix_logs_production.asn_dict', 'name', `client.asn`))", facetName: 'asn', filterCol: '`client.asn`', filterValueFn: (v) => parseInt(v.split(' ')[0], 10), dimFormatFn: formatAsn, extraFilter: 'AND `client.asn` != 0', linkPrefix: 'https://mxtoolbox.com/SuperTool.aspx?action=asn%3aAS', linkSuffix: '&run=toolpage', modeToggle: 'contentTypeMode',
  },
  {
    id: 'breakdown-accept-encoding', col: COLUMN_DEFS.acceptEncoding.facetCol, facetName: 'accept_encoding', extraFilter: "AND `request.headers.accept_encoding` != ''", modeToggle: 'contentTypeMode',
  },
  {
    id: 'breakdown-byo-cdn', col: COLUMN_DEFS.byoCdn.facetCol, facetName: 'byo_cdn', extraFilter: "AND `request.headers.x_byo_cdn_type` != ''", modeToggle: 'contentTypeMode',
  },
  { id: 'breakdown-push-invalidation', col: '`request.headers.x_push_invalidation`', extraFilter: "AND `request.headers.x_push_invalidation` != ''" },
  {
    id: 'breakdown-content-length', col: contentLengthBuckets, rawCol: '`response.headers.content_length`', orderBy: 'min(`response.headers.content_length`)', modeToggle: 'contentTypeMode', getExpectedLabels: getContentLengthLabels,
  },
  {
    id: 'breakdown-location', col: COLUMN_DEFS.location.facetCol, facetName: 'location', extraFilter: "AND `response.headers.location` != ''", highCardinality: true,
  },
  {
    id: 'breakdown-content-encoding', col: COLUMN_DEFS.contentEncoding.facetCol,
  },
  {
    id: 'breakdown-surrogate-key', col: COLUMN_DEFS.surrogateKey.facetCol, extraFilter: "AND `response.headers.x_surrogate_key` != ''", highCardinality: true,
  },
  {
    id: 'breakdown-time-elapsed', col: timeElapsedBuckets, rawCol: '`cdn.time_elapsed_msec`', orderBy: 'min(`cdn.time_elapsed_msec`)', summaryCountIf: '`cdn.time_elapsed_msec` >= 1000', summaryLabel: 'slow (≥1s)', summaryColor: 'warning', getExpectedLabels: getTimeElapsedLabels,
  },
  {
    id: 'breakdown-subsystem', col: COLUMN_DEFS.subsystem.facetCol, extraFilter: "AND `subsystem` != ''",
  },
  {
    id: 'breakdown-rso', col: COLUMN_DEFS.rso.facetCol, extraFilter: "AND `helix.rso` != ''",
  },
  { id: 'breakdown-cdn-version', col: '`cdn.version`', extraFilter: "AND `cdn.version` != ''" },
  { id: 'breakdown-helix-route', col: '`helix.route`', extraFilter: "AND `helix.route` != ''" },
  { id: 'breakdown-severity', col: COLUMN_DEFS.severity.facetCol, extraFilter: "AND `response.headers.x_severity` != ''" },
  { id: 'breakdown-helix-topic', col: '`helix.topic`', extraFilter: "AND `helix.topic` != ''" },
  { id: 'breakdown-helix-org', col: '`helix.org`', extraFilter: "AND `helix.org` != ''" },
  {
    id: 'breakdown-helix-site', col: '`helix.site`', extraFilter: "AND `helix.site` != ''", highCardinality: true,
  },
  {
    id: 'breakdown-helix-repo', col: '`helix.repo`', extraFilter: "AND `helix.repo` != ''", highCardinality: true,
  },
  {
    id: 'breakdown-helix-owner', col: '`helix.owner`', extraFilter: "AND `helix.owner` != ''", highCardinality: true,
  },
  { id: 'breakdown-helix-ref', col: '`helix.ref`', extraFilter: "AND `helix.ref` != ''" },
  { id: 'breakdown-ratelimit-limit', col: '`response.headers.x_ratelimit_limit`', extraFilter: "AND `response.headers.x_ratelimit_limit` != ''" },
  {
    id: 'breakdown-ratelimit-rate', col: ratelimitRateBuckets, rawCol: 'toUInt64OrZero(`response.headers.x_ratelimit_rate`)', orderBy: 'min(toUInt64OrZero(`response.headers.x_ratelimit_rate`))', extraFilter: "AND `response.headers.x_ratelimit_rate` != ''", getExpectedLabels: getRatelimitRateLabels,
  },
  {
    id: 'breakdown-delivery-ratelimit-rate', col: (topN, colOverride) => ratelimitRateBuckets(topN, colOverride || 'toFloat64OrZero(`response.headers.x_rate_limited_rate`)'), rawCol: 'toFloat64OrZero(`response.headers.x_rate_limited_rate`)', orderBy: 'min(toFloat64OrZero(`response.headers.x_rate_limited_rate`))', extraFilter: "AND `response.headers.x_rate_limited_rate` != ''", getExpectedLabels: getRatelimitRateLabels,
  },
];
