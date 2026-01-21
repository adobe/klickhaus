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
 * Update ClickHouse logpush jobs with full field set
 * Usage: node update-logpush.mjs <cloudflare-api-token> [zone-id-or-name]
 *
 * If no zone is specified, updates all Enterprise zones.
 */

import {
  LOGPUSH_FIELDS,
  ENTERPRISE_ZONES,
  cfApi,
  getZoneId,
  buildJobConfig,
  requireClickHousePassword,
} from './logpush-config.mjs';

requireClickHousePassword();

async function getClickHouseLogpushJob(token, zoneId) {
  const data = await cfApi(`/zones/${zoneId}/logpush/jobs`, token);
  const jobs = data.result || [];
  return jobs.find((j) => j.destination_conf?.includes('clickhouse.cloud'));
}

async function updateLogpushJob(token, zoneId, jobId, zoneName) {
  const jobConfig = buildJobConfig(zoneName);
  delete jobConfig.name; // Don't update the name
  delete jobConfig.dataset; // Can't change dataset

  const data = await cfApi(`/zones/${zoneId}/logpush/jobs/${jobId}`, token, 'PUT', jobConfig);
  return data.result;
}

async function main() {
  const [,, apiToken, specificZone] = process.argv;

  if (!apiToken) {
    console.error('Usage: node update-logpush.mjs <cloudflare-api-token> [zone-id-or-name]');
    process.exit(1);
  }

  const zonesToUpdate = specificZone ? [specificZone] : ENTERPRISE_ZONES;

  for (const zoneName of zonesToUpdate) {
    try {
      console.log(`\n=== ${zoneName} ===`);
      // eslint-disable-next-line no-await-in-loop -- Sequential API calls for rate limiting
      const zoneId = await getZoneId(apiToken, zoneName);

      // eslint-disable-next-line no-await-in-loop -- Sequential API calls for rate limiting
      const job = await getClickHouseLogpushJob(apiToken, zoneId);
      if (!job) {
        console.log('No ClickHouse logpush job found, skipping');
      } else {
        const currentFields = job.output_options?.field_names?.length || 0;
        console.log(`Job ID: ${job.id}`);
        console.log(`Current fields: ${currentFields}`);
        console.log(`Target fields: ${LOGPUSH_FIELDS.length}`);

        if (currentFields === LOGPUSH_FIELDS.length) {
          console.log('Already up to date');
        } else {
          console.log('Updating...');
          // eslint-disable-next-line no-await-in-loop -- Sequential API calls for rate limiting
          const updated = await updateLogpushJob(apiToken, zoneId, job.id, zoneName);
          console.log(`Updated! New field count: ${updated.output_options?.field_names?.length || 0}`);
        }
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
    }
  }

  console.log('\nDone!');
}

main();
