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
import { initDashboard } from './dashboard-init.js';

// Hosts excluded from delivery dashboard (backend/admin/RUM/docs services)
const EXCLUDED_DELIVERY_HOSTS = [
  'config.aem.page',
  'pipeline.aem-fastly.page',
  'config.aem-cloudflare.page',
  'admin.hlx.page',
  'media.aem-fastly.page',
  'admin.da.live',
  'static.aem-fastly.page',
  'rum.aem.page',
  'rum.hlx.page',
  'content.da.live',
  'da.live',
  'b4adf6cfdac0918eb6aa5ad033da0747.r2.cloudflarestorage.com',
  'docs.da.live',
  'rum.aem-cloudflare.page',
  'translate.da.live',
];

const DEFAULT_HIDDEN_FACETS = [
  'breakdown-content-types',
  'breakdown-status',
  'breakdown-cache',
  'breakdown-referers',
  'breakdown-ips',
  'breakdown-request-type',
  'breakdown-methods',
  'breakdown-datacenters',
  'breakdown-asn',
  'breakdown-accept',
  'breakdown-accept-encoding',
  'breakdown-req-cache-control',
  'breakdown-push-invalidation',
  'breakdown-content-length',
  'breakdown-location',
  'breakdown-time-elapsed',
];

const excludedList = EXCLUDED_DELIVERY_HOSTS.map((host) => `'${host}'`).join(', ');

initDashboard({
  title: 'Delivery',
  additionalWhereClause: `AND \`request.host\` NOT IN (${excludedList})`,
  defaultHiddenFacets: DEFAULT_HIDDEN_FACETS,
});
