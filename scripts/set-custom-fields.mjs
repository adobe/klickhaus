#!/usr/bin/env node

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
/**
 * Set custom fields (headers) for Cloudflare logpush
 * Usage: node set-custom-fields.mjs <cloudflare-api-token> [zone-id-or-name]
 *
 * If no zone is specified, updates all Enterprise zones.
 * This configures which request/response headers are included in
 * RequestHeaders/ResponseHeaders fields.
 */

import {
  REQUEST_HEADERS,
  RESPONSE_HEADERS,
  ENTERPRISE_ZONES,
  cfApi,
  getZoneId,
} from './logpush-config.mjs';

async function getCustomFieldsRuleset(token, zoneId) {
  const data = await cfApi(`/zones/${zoneId}/rulesets?phase=http_log_custom_fields`, token);
  const ruleset = data.result?.find((r) => r.phase === 'http_log_custom_fields');
  return ruleset?.id;
}

async function getCurrentCustomFields(token, zoneId, rulesetId) {
  if (!rulesetId) return null;
  const data = await cfApi(`/zones/${zoneId}/rulesets/${rulesetId}`, token);
  return data.result;
}

async function setCustomFields(token, zoneId, rulesetId) {
  const rule = {
    action: 'log_custom_field',
    action_parameters: {
      request_fields: REQUEST_HEADERS.map((name) => ({ name })),
      response_fields: RESPONSE_HEADERS.map((name) => ({ name })),
    },
    description: 'Set Logpush custom fields for HTTP requests',
    enabled: true,
    expression: 'true',
  };

  if (rulesetId) {
    // Update existing ruleset
    const data = await cfApi(`/zones/${zoneId}/rulesets/${rulesetId}`, token, 'PUT', {
      rules: [rule],
    });
    return data.result;
  } else {
    // Create new ruleset
    const data = await cfApi(`/zones/${zoneId}/rulesets`, token, 'POST', {
      name: 'default',
      kind: 'zone',
      phase: 'http_log_custom_fields',
      rules: [rule],
    });
    return data.result;
  }
}

function compareHeaders(current, target) {
  if (!current) return { missing: target, extra: [] };

  const currentSet = new Set(current.map((f) => f.name.toLowerCase().trim()));
  const targetSet = new Set(target.map((h) => h.toLowerCase()));

  const missing = target.filter((h) => !currentSet.has(h.toLowerCase()));
  const extra = [...currentSet].filter((h) => !targetSet.has(h));

  return { missing, extra };
}

/**
 * Check if zone needs update based on header diffs
 */
function isUpToDate(reqDiff, respDiff) {
  return reqDiff.missing.length === 0
    && reqDiff.extra.length === 0
    && respDiff.missing.length === 0
    && respDiff.extra.length === 0;
}

/**
 * Log a diff category if non-empty
 */
function logDiffCategory(items, label) {
  if (items.length > 0) console.log(`  ${label}: ${items.join(', ')}`);
}

/**
 * Log header differences
 */
function logDiffs(reqDiff, respDiff) {
  logDiffCategory(reqDiff.missing, 'Missing request headers');
  logDiffCategory(reqDiff.extra, 'Extra request headers');
  logDiffCategory(respDiff.missing, 'Missing response headers');
  logDiffCategory(respDiff.extra, 'Extra response headers');
}

/**
 * Fetch current zone configuration
 */
async function fetchZoneConfig(apiToken, zoneName) {
  const zoneId = await getZoneId(apiToken, zoneName);
  const rulesetId = await getCustomFieldsRuleset(apiToken, zoneId);
  const current = rulesetId ? await getCurrentCustomFields(apiToken, zoneId, rulesetId) : null;
  return { zoneId, rulesetId, current };
}

/**
 * Log current and update zone if needed
 */
async function updateZone(apiToken, zoneId, rulesetId, reqDiff, respDiff) {
  logDiffs(reqDiff, respDiff);

  console.log('Updating...');
  const updated = await setCustomFields(apiToken, zoneId, rulesetId);
  const actionParams = updated.rules?.[0]?.action_parameters;
  const newReqCount = actionParams?.request_fields?.length || 0;
  const newRespCount = actionParams?.response_fields?.length || 0;
  console.log(`Updated! Now: ${newReqCount} request, ${newRespCount} response`);
}

/**
 * Process a single zone update
 */
async function processZone(apiToken, zoneName) {
  console.log(`=== ${zoneName} ===`);

  const { zoneId, rulesetId, current } = await fetchZoneConfig(apiToken, zoneName);

  const actionParams = current?.rules?.[0]?.action_parameters;
  const currentReqFields = actionParams?.request_fields;
  const currentRespFields = actionParams?.response_fields;

  const reqDiff = compareHeaders(currentReqFields, REQUEST_HEADERS);
  const respDiff = compareHeaders(currentRespFields, RESPONSE_HEADERS);

  console.log(`Current: ${currentReqFields?.length || 0} request, ${currentRespFields?.length || 0} response`);

  if (isUpToDate(reqDiff, respDiff)) {
    console.log('Already up to date');
    return;
  }

  await updateZone(apiToken, zoneId, rulesetId, reqDiff, respDiff);
}

async function main() {
  const [,, apiToken, specificZone] = process.argv;

  if (!apiToken) {
    console.error('Usage: node set-custom-fields.mjs <cloudflare-api-token> [zone-id-or-name]');
    process.exit(1);
  }

  const zonesToUpdate = specificZone ? [specificZone] : ENTERPRISE_ZONES;
  const reqCount = REQUEST_HEADERS.length;
  const respCount = RESPONSE_HEADERS.length;
  console.log(`Target: ${reqCount} request headers, ${respCount} response headers\n`);

  for (const zoneName of zonesToUpdate) {
    try {
      // eslint-disable-next-line no-await-in-loop -- Sequential API calls for rate limiting
      await processZone(apiToken, zoneName);
    } catch (err) {
      console.error(`Error: ${err.message}`);
    }
  }

  console.log('\nDone!');
}

main();
