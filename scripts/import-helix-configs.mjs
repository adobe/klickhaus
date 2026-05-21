#!/usr/bin/env node

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
/**
 * Import a helix-ctl config-bus dump into ClickHouse.
 *
 * Populates the helix_site_configs, helix_profile_configs, and helix_org_configs
 * tables in helix_logs_production from a JSON dump produced by helix-ctl.
 *
 * Usage: node import-helix-configs.mjs <dump-file> [--dry-run]
 *
 * Credentials are read from .env (CLICKHOUSE_HOST, CLICKHOUSE_USER,
 * CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE).
 */

import { readFile } from 'node:fs/promises';
import dotenv from 'dotenv';

dotenv.config();

const BATCH_SIZE = 500;

async function post(path, body, contentType = 'text/plain') {
  const host = process.env.CLICKHOUSE_HOST;
  const url = `https://${host}${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-ClickHouse-User': process.env.CLICKHOUSE_USER,
      'X-ClickHouse-Key': process.env.CLICKHOUSE_PASSWORD,
      'Content-Type': contentType,
    },
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text);
  }
  return text;
}

async function insertRows(table, rows) {
  if (rows.length === 0) {
    return;
  }
  const db = process.env.CLICKHOUSE_DATABASE;
  const ndjson = rows.map((r) => JSON.stringify(r)).join('\n');
  const query = `INSERT INTO ${db}.${table} FORMAT JSONEachRow`;
  await post(`/?query=${encodeURIComponent(query)}`, ndjson, 'application/x-ndjson');
}

function str(v) {
  return v == null ? '' : String(v);
}

function ts(v) {
  // ClickHouse DateTime64(3, 'UTC') accepts 'YYYY-MM-DD HH:MM:SS.sss'.
  if (!v) {
    return '1970-01-01 00:00:00.000';
  }
  return String(v).replace('T', ' ').replace('Z', '');
}

function num(v) {
  return Number.isFinite(Number(v)) ? Number(v) : 0;
}

function jsonField(v) {
  if (v == null) {
    return '{}';
  }
  return JSON.stringify(v);
}

function siteRow(org, site, data) {
  const code = data.code || {};
  const codeSource = code.source || {};
  const content = data.content || {};
  const contentSource = content.source || {};
  const contentOverlay = contentSource.overlay || {};
  const cdnProd = (data.cdn && data.cdn.prod) || {};
  return {
    org,
    site,
    version: num(data.version),
    created: ts(data.created),
    last_modified: ts(data.lastModified),
    code_owner: str(code.owner),
    code_repo: str(code.repo),
    code_source_type: str(codeSource.type),
    code_source_url: str(codeSource.url),
    content_bus_id: str(content.contentBusId),
    content_source_type: str(contentSource.type),
    content_source_url: str(contentSource.url),
    content_source_overlay_type: str(contentOverlay.type),
    content_source_overlay_url: str(contentOverlay.url),
    cdn_prod_host: str(cdnProd.host),
    cdn_prod_type: str(cdnProd.type),
    features: jsonField(data.features),
    limits: jsonField(data.limits),
  };
}

function profileRow(org, profile, data) {
  return {
    org,
    profile,
    version: num(data.version),
    created: ts(data.created),
    last_modified: ts(data.lastModified),
  };
}

function orgRow(org, config) {
  return {
    org,
    version: num(config.version),
    created: ts(config.created),
    last_modified: ts(config.lastModified),
  };
}

function buildRows(dump) {
  const orgRows = [];
  const siteRows = [];
  const profileRows = [];

  const orgs = (dump.helix5 && dump.helix5.orgs) || {};
  for (const [org, orgEntry] of Object.entries(orgs)) {
    if (orgEntry.config) {
      orgRows.push(orgRow(org, orgEntry.config));
    }
    for (const [site, siteEntry] of Object.entries(orgEntry.sites || {})) {
      siteRows.push(siteRow(org, site, siteEntry.data || {}));
    }
    for (const [profile, profileEntry] of Object.entries(orgEntry.profiles || {})) {
      profileRows.push(profileRow(org, profile, profileEntry.data || {}));
    }
  }

  return { orgRows, siteRows, profileRows };
}

async function flushBatched(table, rows) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop -- Sequential inserts to bound memory
    await insertRows(table, batch);
    console.log(`  ${table}: inserted ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const positional = args.filter((a) => !a.startsWith('--'));
  const [file] = positional;

  if (!file) {
    console.error('Usage: node import-helix-configs.mjs <dump-file> [--dry-run]');
    process.exit(1);
  }

  const {
    CLICKHOUSE_HOST, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE,
  } = process.env;
  const missingVars = !CLICKHOUSE_HOST || !CLICKHOUSE_USER
    || !CLICKHOUSE_PASSWORD || !CLICKHOUSE_DATABASE;
  if (!dryRun && missingVars) {
    console.error('Error: CLICKHOUSE_HOST, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD, and CLICKHOUSE_DATABASE must be set in .env');
    process.exit(1);
  }

  console.log(`Reading ${file}...`);
  const raw = await readFile(file, 'utf-8');
  const dump = JSON.parse(raw);

  const { orgRows, siteRows, profileRows } = buildRows(dump);
  console.log(`Parsed ${orgRows.length} orgs, ${siteRows.length} sites, ${profileRows.length} profiles.`);

  if (dryRun) {
    console.log('Dry run — skipping inserts.');
    return;
  }

  try {
    console.log(`Inserting into ClickHouse (batch size ${BATCH_SIZE})...`);
    await flushBatched('helix_org_configs', orgRows);
    await flushBatched('helix_site_configs', siteRows);
    await flushBatched('helix_profile_configs', profileRows);
    console.log(`Imported ${orgRows.length} orgs, ${siteRows.length} sites, ${profileRows.length} profiles.`);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
