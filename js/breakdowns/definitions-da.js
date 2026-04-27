/*
 * Copyright 2026 Adobe. All rights reserved.
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
import {
  contentLengthBuckets, timeElapsedBuckets, getContentLengthLabels, getTimeElapsedLabels,
} from './buckets.js';
import { COLUMN_DEFS } from '../columns.js';
import { formatAsn, formatForwardedHost } from './definitions.js';

// The `da` table has no source/byo_cdn/helix.*/surrogate-key/ratelimit columns,
// but adds cdn.script_name and cdn.request_source (Cloudflare worker subrequests).
export const daBreakdowns = [
  {
    id: 'breakdown-status-range', col: "concat(toString(intDiv(`response.status`, 100)), 'xx')", summaryCountIf: '`response.status` >= 500', summaryDimCondition: "dim = '5xx'", summaryLabel: 'error rate', summaryColor: 'error',
  },
  {
    id: 'breakdown-hosts', col: COLUMN_DEFS.host.facetCol, linkFn: hostLink, summaryCountIf: "`request.host` LIKE '%da.live'", summaryDimCondition: "dim LIKE '%da.live'", summaryLabel: 'live', highCardinality: true,
  },
  {
    id: 'breakdown-forwarded-hosts', col: '`request.headers.x_forwarded_host`', linkFn: forwardedHostLink, dimFormatFn: formatForwardedHost, summaryCountIf: "`request.headers.x_forwarded_host` != ''", summaryDimCondition: "dim != ''", summaryLabel: 'forwarded', highCardinality: true,
  },
  {
    id: 'breakdown-content-types', col: COLUMN_DEFS.contentType.facetCol, modeToggle: 'contentTypeMode',
  },
  {
    id: 'breakdown-status', col: COLUMN_DEFS.status.facetCol, modeToggle: 'contentTypeMode',
  },
  {
    id: 'breakdown-errors',
    col: COLUMN_DEFS.errorGrouped.facetCol,
    filterCol: '`response.headers.x_error`',
    filterValueFn: (v) => v.replace(/\/\.\.\./g, '/%'),
    filterOp: 'LIKE',
    extraFilter: "AND `response.headers.x_error` != ''",
  },
  {
    id: 'breakdown-paths', col: COLUMN_DEFS.url.facetCol, linkFn: pathLink, modeToggle: 'contentTypeMode', highCardinality: true,
  },
  {
    id: 'breakdown-referers', col: COLUMN_DEFS.referer.facetCol, linkFn: refererLink, dimPrefixes: ['https://', 'http://'], highCardinality: true,
  },
  {
    id: 'breakdown-user-agents', col: COLUMN_DEFS.userAgent.facetCol, dimPrefixes: ['Mozilla/5.0 '], summaryCountIf: "NOT `request.headers.user_agent` LIKE 'Mozilla/%' OR `request.headers.user_agent` LIKE '%+http%'", summaryDimCondition: "NOT dim LIKE 'Mozilla/%' OR dim LIKE '%+http%'", summaryLabel: 'bot rate', summaryColor: 'warning', highCardinality: true,
  },
  {
    id: 'breakdown-ips', col: COLUMN_DEFS.originatingIp.facetCol, linkPrefix: 'https://centralops.net/co/DomainDossier?dom_whois=1&net_whois=1&addr=', summaryCountIf: '`cdn.originating_ip` LIKE \'%:%\'', summaryDimCondition: "dim LIKE '%:%'", summaryLabel: 'IPv6', highCardinality: true,
  },
  {
    id: 'breakdown-methods', col: COLUMN_DEFS.method.facetCol, summaryCountIf: "`request.method` IN ('POST', 'PUT', 'PATCH', 'DELETE')", summaryDimCondition: "dim IN ('POST', 'PUT', 'PATCH', 'DELETE')", summaryLabel: 'writes', summaryColor: 'warning',
  },
  {
    id: 'breakdown-datacenters', col: '`cdn.datacenter`', modeToggle: 'contentTypeMode',
  },
  {
    id: 'breakdown-asn', col: "concat(toString(`client.asn`), ' ', dictGet('helix_logs_production.asn_dict', 'name', `client.asn`))", filterCol: '`client.asn`', filterValueFn: (v) => parseInt(v.split(' ')[0], 10), dimFormatFn: formatAsn, extraFilter: 'AND `client.asn` != 0', linkPrefix: 'https://mxtoolbox.com/SuperTool.aspx?action=asn%3aAS', linkSuffix: '&run=toolpage', modeToggle: 'contentTypeMode',
  },
  {
    id: 'breakdown-script-name', col: '`cdn.script_name`', extraFilter: "AND `cdn.script_name` != ''",
  },
  {
    id: 'breakdown-accept-encoding', col: COLUMN_DEFS.acceptEncoding.facetCol, extraFilter: "AND `request.headers.accept_encoding` != ''", modeToggle: 'contentTypeMode',
  },
  {
    id: 'breakdown-content-length', col: contentLengthBuckets, rawCol: '`response.headers.content_length`', orderBy: 'min(`response.headers.content_length`)', modeToggle: 'contentTypeMode', getExpectedLabels: getContentLengthLabels,
  },
  {
    id: 'breakdown-content-encoding', col: COLUMN_DEFS.contentEncoding.facetCol,
  },
  {
    id: 'breakdown-time-elapsed', col: timeElapsedBuckets, rawCol: '`cdn.time_elapsed_msec`', orderBy: 'min(`cdn.time_elapsed_msec`)', summaryCountIf: '`cdn.time_elapsed_msec` >= 1000', summaryLabel: 'slow (≥1s)', summaryColor: 'warning', getExpectedLabels: getTimeElapsedLabels,
  },
];
