#!/usr/bin/env node

/**
 * Add ClickHouse logpush to a Cloudflare zone
 * Usage: node add-logpush.mjs <cloudflare-api-token> <zone-id-or-name>
 *
 * The zone must be on an Enterprise plan.
 * Logpush will send HTTP request logs to the cloudflare_http_requests table.
 */

import {
  CLICKHOUSE_HOST,
  CLICKHOUSE_TABLE,
  LOGPUSH_FIELDS,
  cfApi,
  getZoneId,
  buildJobConfig,
  requireClickHousePassword
} from './logpush-config.mjs';

requireClickHousePassword();

async function getZoneInfo(token, zoneId) {
  const data = await cfApi(`/zones/${zoneId}`, token);
  return data.result;
}

async function getExistingLogpushJobs(token, zoneId) {
  const data = await cfApi(`/zones/${zoneId}/logpush/jobs`, token);
  return data.result || [];
}

async function createLogpushJob(token, zoneId, zoneName) {
  const jobConfig = buildJobConfig(zoneName);

  // First, get ownership challenge
  const ownershipData = await cfApi(
    `/zones/${zoneId}/logpush/ownership`,
    token,
    'POST',
    { destination_conf: jobConfig.destination_conf }
  );

  // For ClickHouse HTTP destination, we need to validate ownership
  if (ownershipData.result?.token) {
    jobConfig.ownership_challenge = ownershipData.result.token;
  }

  const data = await cfApi(`/zones/${zoneId}/logpush/jobs`, token, 'POST', jobConfig);
  return data.result;
}

async function main() {
  const [,, apiToken, zoneIdOrName] = process.argv;

  if (!apiToken || !zoneIdOrName) {
    console.error('Usage: node add-logpush.mjs <cloudflare-api-token> <zone-id-or-name>');
    console.error('');
    console.error('Examples:');
    console.error('  node add-logpush.mjs <token> aem.network');
    console.error('  node add-logpush.mjs <token> ef31c4c791eebc46ff8fd3b75c71493a');
    process.exit(1);
  }

  try {
    // Resolve zone ID
    console.log(`Resolving zone: ${zoneIdOrName}`);
    const zoneId = await getZoneId(apiToken, zoneIdOrName);

    // Get zone info
    const zoneInfo = await getZoneInfo(apiToken, zoneId);
    console.log(`Zone: ${zoneInfo.name} (${zoneId})`);
    console.log(`Plan: ${zoneInfo.plan.name}`);

    if (!zoneInfo.plan.name.includes('Enterprise')) {
      console.error('Error: Logpush requires an Enterprise plan');
      process.exit(1);
    }

    // Check for existing ClickHouse logpush
    const existingJobs = await getExistingLogpushJobs(apiToken, zoneId);
    const clickhouseJob = existingJobs.find(j =>
      j.destination_conf?.includes('clickhouse.cloud')
    );

    if (clickhouseJob) {
      console.log(`\nExisting ClickHouse logpush job found: ${clickhouseJob.id}`);
      console.log(`Enabled: ${clickhouseJob.enabled}`);
      console.log(`Fields: ${clickhouseJob.output_options?.field_names?.length || 0}`);
      process.exit(0);
    }

    // Create new logpush job
    console.log('\nCreating ClickHouse logpush job...');
    const job = await createLogpushJob(apiToken, zoneId, zoneInfo.name);

    console.log('\n--- Logpush Job Created ---');
    console.log(`Job ID: ${job.id}`);
    console.log(`Name: ${job.name}`);
    console.log(`Dataset: ${job.dataset}`);
    console.log(`Enabled: ${job.enabled}`);
    console.log(`Fields: ${LOGPUSH_FIELDS.length}`);
    console.log(`Destination: ClickHouse (${CLICKHOUSE_HOST})`);
    console.log(`Table: ${CLICKHOUSE_TABLE}`);

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
