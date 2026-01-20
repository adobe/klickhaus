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

async function main() {
  const [,, apiToken, specificZone] = process.argv;

  if (!apiToken) {
    console.error('Usage: node set-custom-fields.mjs <cloudflare-api-token> [zone-id-or-name]');
    process.exit(1);
  }

  const zonesToUpdate = specificZone ? [specificZone] : ENTERPRISE_ZONES;

  console.log(`Target: ${REQUEST_HEADERS.length} request headers, ${RESPONSE_HEADERS.length} response headers\n`);

  for (const zoneName of zonesToUpdate) {
    try {
      console.log(`=== ${zoneName} ===`);
      // eslint-disable-next-line no-await-in-loop -- Sequential API calls for rate limiting
      const zoneId = await getZoneId(apiToken, zoneName);

      // eslint-disable-next-line no-await-in-loop -- Sequential API calls for rate limiting
      const rulesetId = await getCustomFieldsRuleset(apiToken, zoneId);
      // eslint-disable-next-line no-await-in-loop -- Sequential API calls for rate limiting
      const current = rulesetId ? await getCurrentCustomFields(apiToken, zoneId, rulesetId) : null;

      const currentReqFields = current?.rules?.[0]?.action_parameters?.request_fields;
      const currentRespFields = current?.rules?.[0]?.action_parameters?.response_fields;

      const reqDiff = compareHeaders(currentReqFields, REQUEST_HEADERS);
      const respDiff = compareHeaders(currentRespFields, RESPONSE_HEADERS);

      const currentReqCount = currentReqFields?.length || 0;
      const currentRespCount = currentRespFields?.length || 0;

      console.log(`Current: ${currentReqCount} request, ${currentRespCount} response`);

      const alreadyUpToDate = reqDiff.missing.length === 0 && reqDiff.extra.length === 0
          && respDiff.missing.length === 0 && respDiff.extra.length === 0;

      if (alreadyUpToDate) {
        console.log('Already up to date');
      } else {
        if (reqDiff.missing.length > 0) {
          console.log(`  Missing request headers: ${reqDiff.missing.join(', ')}`);
        }
        if (reqDiff.extra.length > 0) {
          console.log(`  Extra request headers: ${reqDiff.extra.join(', ')}`);
        }
        if (respDiff.missing.length > 0) {
          console.log(`  Missing response headers: ${respDiff.missing.join(', ')}`);
        }
        if (respDiff.extra.length > 0) {
          console.log(`  Extra response headers: ${respDiff.extra.join(', ')}`);
        }

        console.log('Updating...');
        // eslint-disable-next-line no-await-in-loop -- Sequential API calls for rate limiting
        const updated = await setCustomFields(apiToken, zoneId, rulesetId);
        const newReqCount = updated.rules?.[0]?.action_parameters?.request_fields?.length || 0;
        const newRespCount = updated.rules?.[0]?.action_parameters?.response_fields?.length || 0;
        console.log(`Updated! Now: ${newReqCount} request, ${newRespCount} response`);
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
    }
  }

  console.log('\nDone!');
}

main();
