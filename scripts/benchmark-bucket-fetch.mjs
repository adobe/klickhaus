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
 * Benchmark ClickHouse query response times for different row counts.
 * Measures fetch latency for the same columns used by the dashboard logs view.
 *
 * Usage: node scripts/benchmark-bucket-fetch.mjs <username> <password>
 */

const CLICKHOUSE_HOST = 's2p5b8wmt5.eastus2.azure.clickhouse.cloud';
const CLICKHOUSE_PORT = 8443;
const DATABASE = 'helix_logs_production';
const RUNS_PER_TEST = 3;
const DELAY_BETWEEN_RUNS_MS = 500;

const COLUMNS = [
  '`timestamp`',
  '`source`',
  '`response.status`',
  '`request.method`',
  '`request.host`',
  '`request.url`',
  '`cdn.cache_status`',
  '`response.headers.content_type`',
  '`helix.request_type`',
  '`helix.backend_type`',
  '`request.headers.x_forwarded_host`',
  '`request.headers.referer`',
  '`request.headers.user_agent`',
  '`client.ip`',
  '`request.headers.x_forwarded_for`',
  '`response.headers.x_error`',
  '`request.headers.accept`',
  '`request.headers.accept_encoding`',
  '`request.headers.cache_control`',
  '`request.headers.x_byo_cdn_type`',
  '`response.headers.location`',
].join(', ');

const TABLE = `${DATABASE}.cdn_requests_v2`;

const TEST_CASES = [
  {
    name: 'LIMIT 100 (initial viewport)',
    limit: 100,
    timeWindow: '15 min',
    sql: `SELECT ${COLUMNS} FROM ${TABLE}
WHERE timestamp >= now() - INTERVAL 15 MINUTE
ORDER BY timestamp DESC LIMIT 100`,
  },
  {
    name: 'LIMIT 500 (one page)',
    limit: 500,
    timeWindow: '15 min',
    sql: `SELECT ${COLUMNS} FROM ${TABLE}
WHERE timestamp >= now() - INTERVAL 15 MINUTE
ORDER BY timestamp DESC LIMIT 500`,
  },
  {
    name: 'LIMIT 2000 (medium bucket)',
    limit: 2000,
    timeWindow: '15 min',
    sql: `SELECT ${COLUMNS} FROM ${TABLE}
WHERE timestamp >= now() - INTERVAL 15 MINUTE
ORDER BY timestamp DESC LIMIT 2000`,
  },
  {
    name: 'LIMIT 6000 (full large bucket)',
    limit: 6000,
    timeWindow: '15 min',
    sql: `SELECT ${COLUMNS} FROM ${TABLE}
WHERE timestamp >= now() - INTERVAL 15 MINUTE
ORDER BY timestamp DESC LIMIT 6000`,
  },
  {
    name: '5-second bucket, all rows',
    limit: 10000,
    timeWindow: '5 sec',
    sql: `SELECT ${COLUMNS} FROM ${TABLE}
WHERE timestamp >= now() - INTERVAL 5 SECOND
ORDER BY timestamp DESC LIMIT 10000`,
  },
  {
    name: '5-min bucket, LIMIT 500',
    limit: 500,
    timeWindow: '5 min',
    sql: `SELECT ${COLUMNS} FROM ${TABLE}
WHERE timestamp >= now() - INTERVAL 5 MINUTE
ORDER BY timestamp DESC LIMIT 500`,
  },
  {
    name: '5-min bucket, LIMIT 5000',
    limit: 5000,
    timeWindow: '5 min',
    sql: `SELECT ${COLUMNS} FROM ${TABLE}
WHERE timestamp >= now() - INTERVAL 5 MINUTE
ORDER BY timestamp DESC LIMIT 5000`,
  },
  {
    name: '5-min bucket, LIMIT 50000',
    limit: 50000,
    timeWindow: '5 min',
    sql: `SELECT ${COLUMNS} FROM ${TABLE}
WHERE timestamp >= now() - INTERVAL 5 MINUTE
ORDER BY timestamp DESC LIMIT 50000`,
  },
];

function printUsage() {
  console.log('Usage: node scripts/benchmark-bucket-fetch.mjs <username> <password>');
  console.log('');
  console.log('Benchmarks ClickHouse query response times for different row counts');
  console.log('using the same columns as the dashboard logs view.');
  console.log('');
  console.log('Arguments:');
  console.log('  username   ClickHouse username');
  console.log('  password   ClickHouse password');
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function sleep(ms) {
  // eslint-disable-next-line no-promise-executor-return
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runQuery(sql, auth, runIndex) {
  const taggedSql = `/* run=${runIndex} t=${Date.now()} */ ${sql}`;
  const url = `https://${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT}/?database=${DATABASE}&use_query_cache=0`;

  const start = performance.now();
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(auth).toString('base64')}`,
      'Content-Type': 'text/plain',
    },
    body: `${taggedSql} FORMAT JSON`,
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`ClickHouse HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }

  const json = await resp.json();
  const elapsed = performance.now() - start;

  return {
    elapsed,
    rows: json.rows,
    transferBytes: JSON.stringify(json.data).length,
    serverElapsed: json.statistics?.elapsed ?? null,
  };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  if (args.length < 2) {
    console.error('Error: username and password are required.\n');
    printUsage();
    process.exit(1);
  }

  const [username, password] = args;
  const auth = `${username}:${password}`;

  console.log(`Running benchmark against ${CLICKHOUSE_HOST} as ${username}`);
  console.log(`${RUNS_PER_TEST} runs per test, reporting median\n`);

  const results = [];

  for (const testCase of TEST_CASES) {
    const timings = [];
    let lastResult = null;

    process.stdout.write(`  ${testCase.name} ...`);

    // eslint-disable-next-line no-await-in-loop -- sequential runs required for stable timings
    for (let i = 0; i < RUNS_PER_TEST; i += 1) {
      if (i > 0) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(DELAY_BETWEEN_RUNS_MS);
      }
      // eslint-disable-next-line no-await-in-loop
      const result = await runQuery(testCase.sql, auth, i);
      timings.push(result.elapsed);
      lastResult = result;
    }

    const medianTime = median(timings);
    const transferKb = (lastResult.transferBytes / 1024).toFixed(1);

    process.stdout.write(` ${medianTime.toFixed(0)} ms (${lastResult.rows} rows, ${transferKb} KB)\n`);

    results.push({
      name: testCase.name,
      limit: testCase.limit,
      timeWindow: testCase.timeWindow,
      rows: lastResult.rows,
      medianMs: medianTime,
      transferKb: parseFloat(transferKb),
      serverElapsedMs: lastResult.serverElapsed !== null
        ? (lastResult.serverElapsed * 1000).toFixed(0)
        : 'n/a',
    });
  }

  console.log('\n## Results\n');
  console.log('| # | Test | Limit | Time Window | Rows Returned | Median Time (ms) | Server Time (ms) | Transfer Size (KB) |');
  console.log('|---|------|-------|-------------|---------------|-------------------|-------------------|--------------------|');

  results.forEach((r, i) => {
    console.log(
      `| ${i + 1} | ${r.name} | ${r.limit} | ${r.timeWindow} | ${r.rows} | ${r.medianMs.toFixed(0)} | ${r.serverElapsedMs} | ${r.transferKb} |`,
    );
  });
}

main().catch((err) => {
  console.error('Benchmark failed:', err.message);
  process.exit(1);
});
