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
import { query } from './api.js';
import { DATABASE } from './config.js';
import { getTable } from './time.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { loadSql } from './sql-loader.js';
import { isUsingCoralogix } from './backend-adapter.js';
import { fetchBreakdownData as fetchCoralogixBreakdown } from './coralogix/adapter.js';

const HOST_CACHE_KEY = 'hostAutocompleteSuggestions';
const FUNCTION_CACHE_KEY = 'functionAutocompleteSuggestions';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds

function populateHostDatalist(values) {
  const datalist = document.getElementById('hostSuggestions');
  datalist.innerHTML = values.map((v) => `<option value="${escapeHtml(v)}">`).join('');
}

async function loadCoralogixHosts() {
  const [hostsResult, forwardedResult] = await Promise.all([
    fetchCoralogixBreakdown({
      facet: '`request.host`',
      topN: 100,
      timeRange: state.timeRange,
    }),
    fetchCoralogixBreakdown({
      facet: '`request.headers.x_forwarded_host`',
      topN: 100,
      timeRange: state.timeRange,
      extraFilter: "AND `request.headers.x_forwarded_host` != ''",
    }),
  ]);

  const hostSet = new Set();
  for (const row of hostsResult.data) {
    if (row.dim) hostSet.add(row.dim);
  }
  for (const row of forwardedResult.data) {
    if (row.dim) {
      row.dim.split(',').map((h) => h.trim()).filter(Boolean)
        .forEach((h) => hostSet.add(h));
    }
  }
  return Array.from(hostSet).sort().slice(0, 200);
}

export async function loadHostAutocomplete() {
  const isFunctionFilter = state.hostFilterColumn === 'function_name';
  const cacheKey = isFunctionFilter ? FUNCTION_CACHE_KEY : HOST_CACHE_KEY;

  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const { hosts, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL) {
        populateHostDatalist(hosts);
        return;
      }
    } catch (e) {
      // Cache invalid, continue to fetch
    }
  }

  try {
    if (isUsingCoralogix()) {
      const hosts = await loadCoralogixHosts();
      localStorage.setItem(cacheKey, JSON.stringify({ hosts, timestamp: Date.now() }));
      populateHostDatalist(hosts);
      return;
    }

    const sqlParams = { database: DATABASE, table: getTable() };

    if (isFunctionFilter) {
      const sql = await loadSql('autocomplete-functions', sqlParams);
      const result = await query(sql);
      const values = (result.data || [])
        .map((row) => row.host)
        .filter(Boolean)
        .sort()
        .slice(0, 200);
      localStorage.setItem(cacheKey, JSON.stringify({ hosts: values, timestamp: Date.now() }));
      populateHostDatalist(values);
      return;
    }

    // CDN: hosts and forwarded hosts in parallel
    const [hostsSql, forwardedSql] = await Promise.all([
      loadSql('autocomplete-hosts', sqlParams),
      loadSql('autocomplete-forwarded', sqlParams),
    ]);
    const [hostsResult, forwardedHostsResult] = await Promise.all([
      query(hostsSql),
      query(forwardedSql),
    ]);

    const hostSet = new Set();
    for (const row of hostsResult.data) {
      if (row.host) hostSet.add(row.host);
    }
    for (const row of forwardedHostsResult.data) {
      if (row.host) {
        row.host.split(',').map((h) => h.trim()).filter(Boolean).forEach((h) => hostSet.add(h));
      }
    }

    const hosts = Array.from(hostSet).sort().slice(0, 200);
    localStorage.setItem(cacheKey, JSON.stringify({ hosts, timestamp: Date.now() }));
    populateHostDatalist(hosts);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to load host autocomplete:', err);
  }
}
