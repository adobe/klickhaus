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

    return `<tr class="${matchesFilter ? '' : 'hidden'}">
      <td class="domain-cell"><a href="https://${escapeHtml(row.domain)}" target="_blank" rel="noopener">${escapeHtml(row.domain)}</a></td>
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
