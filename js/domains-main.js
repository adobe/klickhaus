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
import { state } from './state.js';
import { query, setForceRefresh } from './api.js';
import { DATABASE } from './config.js';
import { formatNumber, formatQueryTime } from './format.js';
import { escapeHtml } from './utils.js';
import { loadSql } from './sql-loader.js';
import {
  setElements, loadStoredCredentials, handleLogin, handleLogout, showLogin, showDashboard,
} from './auth.js';

// State
let rows = [];
let sortCol = 'age_days';
let sortAsc = true;

/** Cached rum-bundler-token from ClickHouse optel_admin (for OpTel domain key lookup). */
const optelTokenState = { value: null };

/** Domain -> domainkey from bundles.aem.page API (fallback: incognito). */
const domainKeyCache = new Map();

const BUNDLER_OPTEL_DOMAIN = 'https://bundles.aem.page';

// DOM refs
const els = {
  loginSection: document.getElementById('login'),
  dashboardSection: document.getElementById('dashboard'),
  loginError: document.getElementById('loginError'),
  queryTimer: document.getElementById('queryTimer'),
  searchInput: document.getElementById('searchInput'),
  rowCount: document.getElementById('rowCount'),
  loadingState: document.getElementById('loadingState'),
  errorState: document.getElementById('errorState'),
  tableContainer: document.getElementById('tableContainer'),
  domainsBody: document.getElementById('domainsBody'),
};

/**
 * Fetch rum-bundler-token from ClickHouse (optel_admin table).
 * Same token the OpTel explorer reads from localStorage; we also write it there
 * so the explorer can use it when the user opens an OPTEL link.
 * @returns {Promise<string|null>}
 */
async function getOptelToken() {
  if (optelTokenState.value !== null) return optelTokenState.value;
  try {
    const sql = await loadSql('optel-token', { database: DATABASE });
    const result = await query(sql, { cacheTtl: 300 });
    const token = result?.data?.[0]?.value?.trim() || null;
    if (token) {
      optelTokenState.value = token;
      try {
        localStorage.setItem('rum-bundler-token', token);
      } catch {
        // ignore storage errors
      }
    }
    return token;
  } catch {
    return null;
  }
}

/**
 * Look up domain key for a domain using the rum-bundler token (bundles.aem.page API).
 * Mirrors OpTel explorer incognito-checkbox: GET domainkey/{domain} with Bearer token;
 * on 403 or empty, probe with domainkey=open.
 * @param {string} domain
 * @param {string} token
 * @returns {Promise<string>} domainkey or 'incognito'
 */
async function fetchDomainKeyFromBundler(domain, token) {
  try {
    const resp = await fetch(`${BUNDLER_OPTEL_DOMAIN}/domainkey/${encodeURIComponent(domain)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    let domainkey = '';
    try {
      const json = await resp.json();
      domainkey = json?.domainkey?.trim() || '';
    } catch {
      // no domainkey in response
    }
    if (resp.status === 403 || domainkey === '') {
      const n = new Date();
      const y = n.getFullYear();
      const m = String(n.getMonth() + 1).padStart(2, '0');
      const d = String(n.getDate()).padStart(2, '0');
      const probeResp = await fetch(
        `${BUNDLER_OPTEL_DOMAIN}/bundles/${encodeURIComponent(domain)}/${y}/${m}/${d}?domainkey=open`,
      );
      if (probeResp.status === 200) return 'open';
    }
    return domainkey || 'incognito';
  } catch {
    return 'incognito';
  }
}

/**
 * Resolve domain key for one domain (used when user clicks OPTEL link).
 * Uses cache so repeat clicks for the same domain do not refetch.
 * @param {string} domain
 * @returns {Promise<string>} domainkey (or 'incognito')
 */
async function resolveDomainKey(domain) {
  const cached = domainKeyCache.get(domain);
  if (cached !== undefined) return cached;
  const token = await getOptelToken();
  const domainkey = token
    ? await fetchDomainKeyFromBundler(domain, token)
    : 'incognito';
  domainKeyCache.set(domain, domainkey);
  return domainkey;
}

function updateAriaSort() {
  document.querySelectorAll('.domains-table th.sortable').forEach((th) => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === sortCol) {
      th.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');
      th.setAttribute('aria-sort', sortAsc ? 'ascending' : 'descending');
    } else {
      th.setAttribute('aria-sort', 'none');
    }
  });
}

function renderTable() {
  const sorted = [...rows].sort((a, b) => {
    let va = a[sortCol];
    let vb = b[sortCol];
    if (typeof va === 'string') {
      va = va.toLowerCase();
      vb = vb.toLowerCase();
    }
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    // Secondary sort: total descending
    if (a.total > b.total) return -1;
    if (a.total < b.total) return 1;
    return 0;
  });

  const filterText = els.searchInput.value.toLowerCase().trim();

  let visibleCount = 0;
  const html = sorted.map((row) => {
    const matchesFilter = !filterText
      || row.domain.toLowerCase().includes(filterText)
      || row.owner.toLowerCase().includes(filterText)
      || row.repo.toLowerCase().includes(filterText);

    if (matchesFilter) visibleCount += 1;

    const statusBadge = row.age_days <= 1
      ? `<span class="badge badge-new">New (${row.age_days}d)</span>`
      : `<span class="badge badge-existing">${row.age_days}d</span>`;

    const domainParam = encodeURIComponent(row.domain);
    const optelUrl = `https://tools.aem.live/tools/optel/explorer/explorer.html?domain=${domainParam}&view=month&domainkey=incognito`;
    return `<tr class="${matchesFilter ? '' : 'hidden'}">
      <td class="domain-cell"><a href="https://${escapeHtml(row.domain)}" target="_blank" rel="noopener">${escapeHtml(row.domain)}</a> <a href="${escapeHtml(optelUrl)}" target="_blank" rel="noopener noreferrer" class="optel-link" data-domain="${escapeHtml(row.domain)}" title="Open in OpTel Explorer">OPTEL</a></td>
      <td class="owner-cell">${escapeHtml(row.owner)}</td>
      <td class="repo-cell">${escapeHtml(row.repo)}</td>
      <td class="cdn-cell">${escapeHtml(row.cdn_type || '\u2014')}</td>
      <td class="numeric">${formatNumber(row.req_per_hour)}</td>
      <td class="numeric">${formatNumber(row.total)}</td>
      <td>${statusBadge}</td>
    </tr>`;
  }).join('');

  els.domainsBody.innerHTML = html;
  els.rowCount.textContent = filterText
    ? `${visibleCount} of ${rows.length} domains`
    : `${rows.length} domains`;

  updateAriaSort();
}

async function loadData(refresh = false) {
  els.loadingState.style.display = '';
  els.errorState.classList.remove('visible');
  els.tableContainer.style.display = 'none';

  try {
    setForceRefresh(refresh);
    const sql = await loadSql('domains', { database: DATABASE });
    const start = performance.now();
    const data = await query(sql, { cacheTtl: 300 });
    const elapsed = performance.now() - start;
    setForceRefresh(false);

    rows = data.data.map((r) => ({
      domain: r.domain,
      owner: r.owner,
      repo: r.repo,
      cdn_type: r.cdn_type,
      req_per_hour: parseFloat(r.req_per_hour),
      total: parseInt(r.total, 10),
      age_days: parseInt(r.age_days, 10),
    }));

    els.queryTimer.textContent = `(${formatQueryTime(elapsed)})`;
    els.loadingState.style.display = 'none';
    els.tableContainer.style.display = '';
    renderTable();
  } catch (err) {
    setForceRefresh(false);
    els.loadingState.style.display = 'none';
    els.errorState.textContent = `Failed to load: ${err.message}`;
    els.errorState.classList.add('visible');
  }
}

// Sort on column header click
document.querySelectorAll('.domains-table th.sortable').forEach((th) => {
  th.addEventListener('click', () => {
    const { col } = th.dataset;
    if (sortCol === col) {
      sortAsc = !sortAsc;
    } else {
      sortCol = col;
      sortAsc = col === 'domain' || col === 'owner' || col === 'repo' || col === 'cdn_type';
    }
    renderTable();
  });
});

// Search filtering
els.searchInput.addEventListener('input', () => {
  renderTable();
});

// OPTEL link: resolve domain key on click and open with correct domainkey
els.domainsBody.addEventListener('click', async (e) => {
  const link = e.target.closest('a.optel-link');
  if (!link) return;
  e.preventDefault();
  const { domain } = link.dataset;
  if (!domain) return;
  const domainkey = await resolveDomainKey(domain);
  const url = new URL(link.href);
  url.searchParams.set('domainkey', domainkey);
  window.open(url.toString(), '_blank', 'noopener,noreferrer');
});

// Kebab menu
const moreMenu = document.getElementById('moreMenu');
const moreBtn = document.getElementById('moreBtn');

moreBtn.addEventListener('click', () => {
  if (moreMenu.open) {
    moreMenu.close();
    return;
  }
  const rect = moreBtn.getBoundingClientRect();
  moreMenu.style.top = `${rect.bottom + 4}px`;
  moreMenu.style.right = `${document.documentElement.clientWidth - rect.right}px`;
  moreMenu.style.left = 'auto';
  moreMenu.show();
});

document.addEventListener('click', (e) => {
  if (moreMenu.open && !moreMenu.contains(e.target) && !moreBtn.contains(e.target)) {
    moreMenu.close();
  }
});

// Refresh
document.getElementById('refreshBtn').addEventListener('click', () => {
  moreMenu.close();
  loadData(true);
});

// Logout
document.getElementById('logoutBtn').addEventListener('click', () => {
  moreMenu.close();
  handleLogout();
});

// Wire up auth module
setElements({
  loginSection: els.loginSection,
  dashboardSection: els.dashboardSection,
  loginError: els.loginError,
});

// Login form
document.getElementById('loginForm').addEventListener('submit', handleLogin);

// On successful login, show dashboard and load data
window.addEventListener('login-success', () => {
  showDashboard();
  loadData();
});

// Auto-login from stored credentials
const stored = loadStoredCredentials();
if (stored) {
  state.credentials = stored;
  query('SELECT 1').then(() => {
    showDashboard();
    loadData();
  }).catch(() => {
    showLogin();
  });
} else {
  showLogin();
}
