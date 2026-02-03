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
import { escapeHtml } from './utils.js';
import { loadSql } from './sql-loader.js';

const HOST_CACHE_KEY = 'hostAutocompleteSuggestions';
const HOST_CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds

function populateHostDatalist(hosts) {
  const datalist = document.getElementById('hostSuggestions');
  datalist.innerHTML = hosts.map((h) => `<option value="${escapeHtml(h)}">`).join('');
}

export async function loadHostAutocomplete() {
  // Check cache first
  const cached = localStorage.getItem(HOST_CACHE_KEY);
  if (cached) {
    try {
      const { hosts, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < HOST_CACHE_TTL) {
        populateHostDatalist(hosts);
        return;
      }
    } catch (e) {
      // Cache invalid, continue to fetch
    }
  }

  // Fetch hosts and forwarded hosts in parallel (lower priority, background task)
  try {
    const sqlParams = { database: DATABASE, table: getTable() };
    const [hostsSql, forwardedSql] = await Promise.all([
      loadSql('autocomplete-hosts', sqlParams),
      loadSql('autocomplete-forwarded', sqlParams),
    ]);
    const [hostsResult, forwardedHostsResult] = await Promise.all([
      query(hostsSql),
      query(forwardedSql),
    ]);

    // Collect all hosts
    const hostSet = new Set();

    // Add request.host values
    for (const row of hostsResult.data) {
      if (row.host) hostSet.add(row.host);
    }

    // Add forwarded hosts (split comma-separated values)
    for (const row of forwardedHostsResult.data) {
      if (row.host) {
        const hosts = row.host.split(',').map((h) => h.trim()).filter((h) => h);
        hosts.forEach((h) => hostSet.add(h));
      }
    }

    // Convert to sorted array, limit to 200
    const hosts = Array.from(hostSet).sort().slice(0, 200);

    // Cache in localStorage
    localStorage.setItem(HOST_CACHE_KEY, JSON.stringify({
      hosts,
      timestamp: Date.now(),
    }));

    populateHostDatalist(hosts);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to load host autocomplete:', err);
  }
}
