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
import { query } from './api.js';
import { DATABASE } from './config.js';
import { formatNumber, formatQueryTime } from './format.js';
import {
  setElements, loadStoredCredentials, handleLogin, handleLogout, showLogin, showDashboard,
} from './auth.js';

const DOMAIN_QUERY = `
SELECT
  lower(trimRight(splitByChar(':',
    trimBoth(splitByChar(',', \`request.headers.x_forwarded_host\`)[1])
  )[1], '.')) AS domain,
  splitByString('--', replaceOne(\`request.host\`, '.aem.live', ''))[3] AS owner,
  splitByString('--', replaceOne(\`request.host\`, '.aem.live', ''))[2] AS repo,
  \`request.headers.x_byo_cdn_type\` AS cdn_type,
  round(count() / (dateDiff('hour', min(timestamp), max(timestamp)) + 1), 1) AS req_per_hour,
  count() AS total,
  dateDiff('day', min(timestamp), now()) AS age_days
FROM {database}.cdn_requests_v2
WHERE \`request.host\` LIKE '%.aem.live'
  AND \`request.headers.x_forwarded_host\` != ''
  AND \`request.headers.x_forwarded_host\` != \`request.host\`
  AND \`request.headers.x_forwarded_host\` NOT LIKE '%.aem.live'
  AND \`request.headers.x_forwarded_host\` NOT LIKE '%.aem.page'
  AND \`request.headers.x_forwarded_host\` NOT LIKE 'localhost%'
  AND \`request.headers.x_forwarded_host\` NOT LIKE '%.workers.dev%'
  AND \`request.headers.x_forwarded_host\` NOT LIKE '%<%'
  AND \`request.headers.x_forwarded_host\` NOT LIKE '%{%'
  AND \`request.headers.x_forwarded_host\` NOT LIKE '%/%'
  AND \`request.headers.x_forwarded_host\` NOT LIKE '%oast%'
  AND timestamp > now() - INTERVAL 7 DAY
GROUP BY domain, owner, repo, cdn_type
HAVING NOT match(domain, '^[0-9.]+$')
  AND domain NOT IN ('da.live', 'da.page', 'aem.live', 'docs.da.live', 'docs.da.page')
  AND domain NOT LIKE '%.aem.reviews'
  AND match(domain, '^[a-z0-9][a-z0-9.-]+\\.[a-z]{2,}$')
ORDER BY total DESC
`.replace('{database}', DATABASE);

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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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

  // Update sort indicators
  document.querySelectorAll('.domains-table th').forEach((th) => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === sortCol) {
      th.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');
    }
  });
}

async function loadData() {
  els.loadingState.style.display = '';
  els.errorState.classList.remove('visible');
  els.tableContainer.style.display = 'none';

  try {
    const start = performance.now();
    const data = await query(DOMAIN_QUERY, { cacheTtl: 300 });
    const elapsed = performance.now() - start;

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
  loadData();
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
