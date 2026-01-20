#!/usr/bin/env node

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
  const [, , apiToken, specificZone] = process.argv;

  if (!apiToken) {
    console.error('Usage: node update-logpush.mjs <cloudflare-api-token> [zone-id-or-name]');
    process.exit(1);
  }

  const zonesToUpdate = specificZone ? [specificZone] : ENTERPRISE_ZONES;

  for (const zoneName of zonesToUpdate) {
    try {
      console.log(`\n=== ${zoneName} ===`);
      const zoneId = await getZoneId(apiToken, zoneName);

      const job = await getClickHouseLogpushJob(apiToken, zoneId);
      if (!job) {
        console.log('No ClickHouse logpush job found, skipping');
        continue;
      }

      const currentFields = job.output_options?.field_names?.length || 0;
      console.log(`Job ID: ${job.id}`);
      console.log(`Current fields: ${currentFields}`);
      console.log(`Target fields: ${LOGPUSH_FIELDS.length}`);

      if (currentFields === LOGPUSH_FIELDS.length) {
        console.log('Already up to date');
        continue;
      }

      console.log('Updating...');
      const updated = await updateLogpushJob(apiToken, zoneId, job.id, zoneName);
      console.log(`Updated! New field count: ${updated.output_options?.field_names?.length || 0}`);
    } catch (err) {
      console.error(`Error: ${err.message}`);
    }
  }

  console.log('\nDone!');
}

main();
