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

const HOST_CACHE_KEY = 'hostAutocompleteSuggestions';
const FUNCTION_CACHE_KEY = 'functionAutocompleteSuggestions';
const OWNER_REPO_CACHE_KEY = 'ownerRepoAutocompleteSuggestions';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds

function populateDatalist(datalistId, values) {
  const datalist = document.getElementById(datalistId);
  if (!datalist) { return; }
  datalist.innerHTML = values.map((v) => `<option value="${escapeHtml(v)}">`).join('');
}

function populateHostDatalist(values) {
  populateDatalist('hostSuggestions', values);
}

export async function loadHostAutocomplete() {
  const isFunctionFilter = state.hostFilterColumn === 'function_name';
  // No suggestions for arbitrary column filters (e.g. request.url paths).
  if (state.hostFilterColumn && !isFunctionFilter) {
    populateHostDatalist([]);
    return;
  }
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
      if (row.host) { hostSet.add(row.host); }
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

// All owner/repo values held in memory for client-side filtering
let ownerRepoAllValues = [];

/**
 * Filter the ownerRepoSuggestions datalist to entries matching `text`,
 * with prefix matches ranked before contains matches.
 * Called on every input event so Chrome always sees the right top N options.
 */
export function filterOwnerRepoDatalist(text) {
  const datalist = document.getElementById('ownerRepoSuggestions');
  if (!datalist) { return; }
  if (!text) {
    datalist.innerHTML = '';
    return;
  }
  const lower = text.toLowerCase();
  const prefix = [];
  const contains = [];
  for (const v of ownerRepoAllValues) {
    const vl = v.toLowerCase();
    if (vl.startsWith(lower)) {
      prefix.push(v);
    } else if (vl.includes(lower)) {
      contains.push(v);
    }
  }
  const top = [...prefix, ...contains].slice(0, 20);
  datalist.innerHTML = top.map((v) => `<option value="${escapeHtml(v)}">`).join('');
}

export async function loadOwnerRepoAutocomplete() {
  const table = getTable();
  const cacheKey = `${OWNER_REPO_CACHE_KEY}_${table}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const { values, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL) {
        ownerRepoAllValues = values;
        return;
      }
    } catch (e) {
      // Cache invalid, continue to fetch
    }
  }

  try {
    const sqlParams = { database: DATABASE, table };
    const sql = await loadSql('autocomplete-owner-repo', sqlParams);
    const result = await query(sql);
    const values = (result.data || []).map((row) => row.owner_repo).filter(Boolean)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    localStorage.setItem(cacheKey, JSON.stringify({ values, timestamp: Date.now() }));
    ownerRepoAllValues = values;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to load owner/repo autocomplete:', err);
  }
}
