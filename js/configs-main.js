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
import { state } from './state.js';
import { query, setForceRefresh } from './api.js';
import { DATABASE } from './config.js';
import { formatNumber, formatQueryTime } from './format.js';
import { escapeHtml } from './utils.js';
import { loadSql } from './sql-loader.js';
import {
  setElements, loadStoredCredentials, handleLogin, handleLogout, showLogin, showDashboard,
} from './auth.js';

const PAGE_SIZE = 200;

// All mutable state in one const object to avoid formatter const/let conflicts
const s = {
  rows: [],
  resolvedMap: new Map(),
  rawMap: new Map(),
  typeRowsData: [],
  contentTypeRowsData: [],
  codeSourceTypeRowsData: [],
  statsData: {},
  // chip (boolean presence) filters
  chipFilters: {
    cdn_host: false, cdn_type: false, folders: false, profile: false,
  },
  sortCol: 'org',
  sortAsc: true,
  currentPage: 1,
  cdnTypeFilter: null,
  contentTypeFilter: null,
  codeSourceTypeFilter: null,
  resolvedView: false,
};

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
  configsBody: document.getElementById('configsBody'),
  statsSection: document.getElementById('statsSection'),
  statsChips: document.getElementById('statsChips'),
  typeBody: document.getElementById('typeBody'),
  contentTypeBody: document.getElementById('contentTypeBody'),
  codeSourceTypeBody: document.getElementById('codeSourceTypeBody'),
  pagination: document.getElementById('pagination'),
  pageInfo: document.getElementById('pageInfo'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  configDetail: document.getElementById('configDetail'),
  detailTitle: document.getElementById('detailTitle'),
  detailSubtitle: document.getElementById('detailSubtitle'),
  detailBody: document.getElementById('detailBody'),
};

function updateAriaSort() {
  document.querySelectorAll('.configs-table th.sortable').forEach((th) => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === s.sortCol) {
      th.classList.add(s.sortAsc ? 'sort-asc' : 'sort-desc');
      th.setAttribute('aria-sort', s.sortAsc ? 'ascending' : 'descending');
    } else {
      th.setAttribute('aria-sort', 'none');
    }
  });
}

function renderStats(stats, total) {
  s.statsData = stats;
  const pct = (n) => (total > 0 ? ` (${Math.round((n / total) * 100)}%)` : '');
  const anyChip = Object.values(s.chipFilters).some(Boolean);

  const chips = [
    {
      label: anyChip ? 'Clear filters' : 'Total sites',
      value: formatNumber(total),
      key: null,
    },
    {
      label: 'With CDN host',
      value: formatNumber(Number(stats.with_cdn_host)),
      pct: pct(Number(stats.with_cdn_host)),
      key: 'cdn_host',
    },
    {
      label: 'With CDN type',
      value: formatNumber(Number(stats.with_cdn_type)),
      pct: pct(Number(stats.with_cdn_type)),
      key: 'cdn_type',
    },
    {
      label: 'With folders',
      value: formatNumber(Number(stats.with_folders)),
      pct: pct(Number(stats.with_folders)),
      key: 'folders',
    },
    {
      label: 'With profile',
      value: formatNumber(Number(stats.with_profile)),
      pct: pct(Number(stats.with_profile)),
      key: 'profile',
    },
  ];

  els.statsChips.innerHTML = chips.map(({
    label, value, pct: p, key,
  }) => {
    const active = key ? s.chipFilters[key] : anyChip;
    const dataAttr = key ? `data-key="${escapeHtml(key)}"` : 'data-clear="1"';
    return `<button type="button" class="stat-chip${active ? ' active' : ''}" ${dataAttr}>
      <span class="stat-value">${escapeHtml(value)}</span>
      <span class="stat-label">${escapeHtml(label)}</span>
      ${p ? `<span class="stat-pct">${escapeHtml(p)}</span>` : ''}
    </button>`;
  }).join('');
}

function renderFacetBreakdown(tbodyEl, data, activeFilter) {
  const maxCnt = data.reduce((m, r) => Math.max(m, Number(r.cnt)), 0);
  const el = tbodyEl;
  el.innerHTML = data.map((r) => {
    const cnt = Number(r.cnt);
    const barPct = maxCnt > 0 ? Math.round((cnt / maxCnt) * 100) : 0;
    const active = activeFilter === r.type;
    return `<tr class="type-row${active ? ' active' : ''}" data-type="${escapeHtml(r.type)}">
      <td>${escapeHtml(r.type)}</td>
      <td class="type-bar-cell">
        <div class="type-bar-wrap"><div class="type-bar-fill" style="width:${barPct}%"></div></div>
      </td>
      <td>${formatNumber(cnt)}</td>
    </tr>`;
  }).join('');
}

function matchesText(row, filterText) {
  if (!filterText) { return true; }
  return row.org.toLowerCase().includes(filterText)
    || row.site.toLowerCase().includes(filterText)
    || row.cdn_prod_host.toLowerCase().includes(filterText);
}

function matchesFacets(row) {
  if (s.cdnTypeFilter) {
    const want = s.cdnTypeFilter === '(none)' ? '' : s.cdnTypeFilter;
    if (row.cdn_prod_type !== want) { return false; }
  }
  if (s.contentTypeFilter) {
    const want = s.contentTypeFilter === '(none)' ? '' : s.contentTypeFilter;
    if (row.content_source_type !== want) { return false; }
  }
  if (s.codeSourceTypeFilter) {
    const want = s.codeSourceTypeFilter === '(none)' ? '' : s.codeSourceTypeFilter;
    if (row.code_source_type !== want) { return false; }
  }
  return true;
}

function matchesChips(row) {
  const {
    cdn_host: fCdnHost, cdn_type: fCdnType, folders: fFolders, profile: fProfile,
  } = s.chipFilters;
  if (fCdnHost && !row.cdn_prod_host) { return false; }
  if (fCdnType && !row.cdn_prod_type) { return false; }
  if (fFolders && row.folders !== '1' && row.folders !== true) { return false; }
  if (fProfile && !row.profile) { return false; }
  return true;
}

function matchesRow(row, filterText) {
  return matchesText(row, filterText) && matchesFacets(row) && matchesChips(row);
}

function renderTable() {
  const filterText = els.searchInput.value.toLowerCase().trim();

  const sorted = [...s.rows].sort((a, b) => {
    const va = (a[s.sortCol] || '').toString().toLowerCase();
    const vb = (b[s.sortCol] || '').toString().toLowerCase();
    if (va < vb) { return s.sortAsc ? -1 : 1; }
    if (va > vb) { return s.sortAsc ? 1 : -1; }
    return 0;
  });

  const filtered = sorted.filter((row) => matchesRow(row, filterText));

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (s.currentPage > totalPages) { s.currentPage = totalPages; }

  const start = (s.currentPage - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, filtered.length);
  const pageRows = filtered.slice(start, end);

  els.configsBody.innerHTML = pageRows.map((row) => {
    const cdnHost = row.cdn_prod_host
      ? `<span class="cdn-host-cell">${escapeHtml(row.cdn_prod_host)}</span>`
      : '<span style="color:var(--text-secondary)">—</span>';
    return `<tr data-org="${escapeHtml(row.org)}" data-site="${escapeHtml(row.site)}">
      <td class="org-cell">${escapeHtml(row.org)}</td>
      <td class="site-cell">${escapeHtml(row.site)}</td>
      <td>${cdnHost}</td>
      <td class="cdn-type-cell">${escapeHtml(row.cdn_prod_type || '—')}</td>
      <td class="source-type-cell">${escapeHtml(row.code_source_type || '—')}</td>
      <td class="source-type-cell">${escapeHtml(row.content_source_type || '—')}</td>
      <td class="profile-cell">${escapeHtml(row.profile || '—')}</td>
      <td class="date-cell">${escapeHtml(row.last_modified_date || '—')}</td>
      <td class="date-cell">${escapeHtml(row.created_date || '—')}</td>
    </tr>`;
  }).join('');

  const anyFilter = filterText || s.cdnTypeFilter || s.contentTypeFilter
    || Object.values(s.chipFilters).some(Boolean);
  els.rowCount.textContent = anyFilter
    ? `${formatNumber(filtered.length)} of ${formatNumber(s.rows.length)} sites`
    : `${formatNumber(s.rows.length)} sites`;

  if (totalPages > 1) {
    els.pagination.style.display = '';
    els.pageInfo.textContent = `${formatNumber(start + 1)}–${formatNumber(end)} of ${formatNumber(filtered.length)}`;
    els.prevBtn.disabled = s.currentPage <= 1;
    els.nextBtn.disabled = s.currentPage >= totalPages;
  } else {
    els.pagination.style.display = 'none';
  }

  updateAriaSort();
}

function buildResolvedMap(data) {
  const map = new Map();
  data.forEach((r) => { map.set(`${r.org}/${r.site}`, r); });
  return map;
}

function normVal(v) {
  if (v === true || v === 1) { return 'true'; }
  if (v === false || v === 0) { return 'false'; }
  return String(v == null ? '' : v);
}

function profileBadge(rawVal, resolvedVal, profileSrc) {
  if (resolvedVal === null || resolvedVal === undefined || resolvedVal === '') { return ''; }
  if (normVal(rawVal) === normVal(resolvedVal)) { return ''; }
  return ` <span class="profile-badge" title="inherited from profile">&#8593;&nbsp;${escapeHtml(profileSrc)}</span>`;
}

function detailRowResolved(label, rawVal, resolvedVal, profileSrc) {
  const isEmpty = resolvedVal === null || resolvedVal === undefined || resolvedVal === '';
  const display = isEmpty ? '—' : escapeHtml(String(resolvedVal));
  return `<div class="detail-label">${escapeHtml(label)}</div>
          <div class="detail-value${isEmpty ? ' empty' : ''}">${display}${profileBadge(rawVal, resolvedVal, profileSrc)}</div>`;
}

function formatJson(raw) {
  if (!raw || raw === '{}' || raw === '[]' || raw === 'null' || raw === '') {
    return null;
  }
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function detailRowResolvedWithCopy(label, rawVal, resolvedVal, profileSrc) {
  const isEmpty = resolvedVal === null || resolvedVal === undefined || resolvedVal === '';
  const display = isEmpty ? '—' : escapeHtml(String(resolvedVal));
  const btn = isEmpty ? '' : ` <button type="button" class="copy-btn" data-copy="${escapeHtml(String(resolvedVal))}" title="Copy to clipboard">copy</button>`;
  return `<div class="detail-label">${escapeHtml(label)}</div>
          <div class="detail-value${isEmpty ? ' empty' : ''}" style="white-space: nowrap">${display}${profileBadge(rawVal, resolvedVal, profileSrc)}${btn}</div>`;
}

function detailRow(label, value) {
  const isEmpty = value === null || value === undefined || value === '';
  const display = isEmpty ? '—' : escapeHtml(String(value));
  return `<div class="detail-label">${escapeHtml(label)}</div>
          <div class="detail-value${isEmpty ? ' empty' : ''}">${display}</div>`;
}

function foldersLabel(v) {
  return (v === 1 || v === true || v === '1') ? 'Yes' : 'No';
}

function jsonBadge(json, rawJson, profileSrc) {
  return (json && json !== rawJson)
    ? ` <span class="profile-badge" title="merged with profile">&#8593;&nbsp;${escapeHtml(profileSrc)}</span>`
    : '';
}

function showDetail(row) {
  const key = `${row.org}/${row.site}`;
  // res = the resolved (effective) row; rawRow = the raw site-only row
  const res = s.resolvedView ? row : (s.resolvedMap.get(key) || row);
  const rawRow = s.resolvedView ? (s.rawMap.get(key) || row) : row;
  const profileSrc = row.profile || 'default';
  const dr = (label, field) => detailRowResolved(label, rawRow[field], res[field], profileSrc);

  const configLink = `<a href="https://admin.hlx.page/config/${encodeURIComponent(row.org)}/sites/${encodeURIComponent(row.site)}.json" target="_blank" rel="noopener" class="detail-config-link">config</a>`;
  const previewLink = `<a href="https://main--${encodeURIComponent(row.site)}--${encodeURIComponent(row.org)}.aem.page/" target="_blank" rel="noopener" class="detail-config-link">preview</a>`;
  const s3Link = res.content_bus_id
    ? ` &mdash; <a href="https://us-east-1.console.aws.amazon.com/s3/buckets/helix-content-bus?prefix=${encodeURIComponent(res.content_bus_id)}/" target="_blank" rel="noopener" class="detail-config-link">content bus</a>`
    : '';
  const codeBusLink = (res.code_owner && res.code_repo)
    ? ` &mdash; <a href="https://us-east-1.console.aws.amazon.com/s3/buckets/helix-code-bus?prefix=${encodeURIComponent(res.code_owner)}/${encodeURIComponent(res.code_repo)}" target="_blank" rel="noopener" class="detail-config-link">code bus</a>`
    : '';
  els.detailTitle.textContent = `${row.org} / ${row.site}`;
  els.detailSubtitle.innerHTML = res.cdn_prod_host
    ? `${escapeHtml(res.cdn_prod_host)} &mdash; ${configLink} &mdash; ${previewLink}${s3Link}${codeBusLink}`
    : `${configLink} &mdash; ${previewLink}${s3Link}${codeBusLink}`;

  const featuresJson = formatJson(res.features);
  const rawFeaturesJson = formatJson(rawRow.features);
  const limitsJson = formatJson(res.limits);
  const rawLimitsJson = formatJson(rawRow.limits);
  const featuresBadge = jsonBadge(featuresJson, rawFeaturesJson, profileSrc);
  const limitsBadge = jsonBadge(limitsJson, rawLimitsJson, profileSrc);

  els.detailBody.innerHTML = `
    <div class="detail-group">
      <div class="detail-group-title">CDN</div>
      <div class="detail-rows">
        ${dr('Prod host', 'cdn_prod_host')}
        ${dr('Prod type', 'cdn_prod_type')}
      </div>
    </div>
    <div class="detail-group">
      <div class="detail-group-title">Code Source</div>
      <div class="detail-rows">
        ${dr('Owner', 'code_owner')}
        ${dr('Repo', 'code_repo')}
        ${dr('Source type', 'code_source_type')}
        ${dr('Source URL', 'code_source_url')}
      </div>
    </div>
    <div class="detail-group">
      <div class="detail-group-title">Content Source</div>
      <div class="detail-rows">
        ${detailRowResolvedWithCopy('Content bus ID', rawRow.content_bus_id, res.content_bus_id, profileSrc)}
        ${dr('Source type', 'content_source_type')}
        ${dr('Source URL', 'content_source_url')}
        ${dr('Overlay type', 'content_source_overlay_type')}
        ${dr('Overlay URL', 'content_source_overlay_url')}
      </div>
    </div>
    <div class="detail-group">
      <div class="detail-group-title">Config</div>
      <div class="detail-rows">
        ${detailRow('Profile', row.profile)}
        ${detailRowResolved('Folders', foldersLabel(rawRow.folders), foldersLabel(res.folders), profileSrc)}
        ${detailRow('Version', row.version)}
        ${detailRow('Created', row.created_date)}
        ${detailRow('Last modified', row.last_modified_date)}
      </div>
    </div>
    ${featuresJson ? `
    <div class="detail-group">
      <div class="detail-group-title">Features${featuresBadge}</div>
      <pre class="detail-json">${escapeHtml(featuresJson)}</pre>
    </div>` : ''}
    ${limitsJson ? `
    <div class="detail-group">
      <div class="detail-group-title">Limits${limitsBadge}</div>
      <pre class="detail-json">${escapeHtml(limitsJson)}</pre>
    </div>` : ''}
  `;

  els.configDetail.showModal();
}

async function loadData(refresh = false) {
  els.loadingState.style.display = '';
  els.errorState.classList.remove('visible');
  els.tableContainer.style.display = 'none';
  els.statsSection.style.display = 'none';

  try {
    setForceRefresh(refresh);
    const source = s.resolvedView ? 'site_configs_resolved' : 'site_configs FINAL';
    const compareSource = s.resolvedView ? 'site_configs FINAL' : 'site_configs_resolved';
    const params = { database: DATABASE, source };
    const compareParams = { database: DATABASE, source: compareSource };
    // eslint-disable-next-line max-len
    const [sqlStats, sqlByType, sqlByContentType, sqlByCodeSourceType, sqlList, sqlCompare] = await Promise.all([
      loadSql('configs-stats', params),
      loadSql('configs-by-type', params),
      loadSql('configs-by-content-type', params),
      loadSql('configs-by-code-source-type', params),
      loadSql('configs-list', params),
      loadSql('configs-resolved-list', compareParams),
    ]);

    const start = performance.now();
    // eslint-disable-next-line max-len
    const [statsResult, typeResult, contentTypeResult, codeSourceTypeResult, listResult, compareResult] = await Promise.all([
      query(sqlStats, { cacheTtl: 300 }),
      query(sqlByType, { cacheTtl: 300 }),
      query(sqlByContentType, { cacheTtl: 300 }),
      query(sqlByCodeSourceType, { cacheTtl: 300 }),
      query(sqlList, { cacheTtl: 300 }),
      query(sqlCompare, { cacheTtl: 300 }),
    ]);
    const elapsed = performance.now() - start;
    setForceRefresh(false);

    s.rows = listResult.data;
    const compareMap = buildResolvedMap(compareResult.data || []);
    s.resolvedMap = s.resolvedView ? new Map() : compareMap;
    s.rawMap = s.resolvedView ? compareMap : new Map();
    s.currentPage = 1;

    els.queryTimer.textContent = `(${formatQueryTime(elapsed)})`;
    renderStats(statsResult.data[0] || {}, s.rows.length);
    s.typeRowsData = typeResult.data || [];
    renderFacetBreakdown(els.typeBody, s.typeRowsData, s.cdnTypeFilter);
    s.contentTypeRowsData = contentTypeResult.data || [];
    renderFacetBreakdown(els.contentTypeBody, s.contentTypeRowsData, s.contentTypeFilter);
    s.codeSourceTypeRowsData = codeSourceTypeResult.data || [];
    renderFacetBreakdown(els.codeSourceTypeBody, s.codeSourceTypeRowsData, s.codeSourceTypeFilter);
    els.statsSection.style.display = '';
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

// Raw / Resolved toggle
function updateViewToggle() {
  document.querySelectorAll('#viewToggle .view-opt').forEach((btn) => {
    const active = (btn.dataset.view === 'resolved') === s.resolvedView;
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

document.getElementById('viewToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.view-opt');
  if (!btn) { return; }
  const wantResolved = btn.dataset.view === 'resolved';
  if (wantResolved === s.resolvedView) { return; }
  s.resolvedView = wantResolved;
  s.cdnTypeFilter = null;
  s.contentTypeFilter = null;
  Object.keys(s.chipFilters).forEach((k) => { s.chipFilters[k] = false; });
  s.currentPage = 1;
  updateViewToggle();
  loadData();
});

// Sort on column header click
document.querySelectorAll('.configs-table th.sortable').forEach((th) => {
  th.addEventListener('click', () => {
    const { col } = th.dataset;
    if (s.sortCol === col) {
      s.sortAsc = !s.sortAsc;
    } else {
      s.sortCol = col;
      s.sortAsc = true;
    }
    s.currentPage = 1;
    renderTable();
  });
});

// Search filtering — reset to page 1
els.searchInput.addEventListener('input', () => {
  s.currentPage = 1;
  renderTable();
});

// Stat chips — toggle presence filter; "Total sites" / "Clear filters" clears all
els.statsChips.addEventListener('click', (e) => {
  const chip = e.target.closest('.stat-chip');
  if (!chip) { return; }
  if (chip.dataset.clear) {
    Object.keys(s.chipFilters).forEach((k) => { s.chipFilters[k] = false; });
  } else if (chip.dataset.key) {
    s.chipFilters[chip.dataset.key] = !s.chipFilters[chip.dataset.key];
  }
  s.currentPage = 1;
  renderStats(s.statsData, s.rows.length);
  renderTable();
});

// CDN type facet — click to filter, click again to clear
document.getElementById('typeTable').addEventListener('click', (e) => {
  const tr = e.target.closest('tr.type-row');
  if (!tr) { return; }
  s.cdnTypeFilter = s.cdnTypeFilter === tr.dataset.type ? null : tr.dataset.type;
  s.currentPage = 1;
  renderFacetBreakdown(els.typeBody, s.typeRowsData, s.cdnTypeFilter);
  renderTable();
});

// Content source type facet — click to filter, click again to clear
document.getElementById('contentTypeTable').addEventListener('click', (e) => {
  const tr = e.target.closest('tr.type-row');
  if (!tr) { return; }
  s.contentTypeFilter = s.contentTypeFilter === tr.dataset.type ? null : tr.dataset.type;
  s.currentPage = 1;
  renderFacetBreakdown(els.contentTypeBody, s.contentTypeRowsData, s.contentTypeFilter);
  renderTable();
});

// Code source type facet — click to filter, click again to clear
document.getElementById('codeSourceTypeTable').addEventListener('click', (e) => {
  const tr = e.target.closest('tr.type-row');
  if (!tr) { return; }
  s.codeSourceTypeFilter = s.codeSourceTypeFilter === tr.dataset.type ? null : tr.dataset.type;
  s.currentPage = 1;
  renderFacetBreakdown(els.codeSourceTypeBody, s.codeSourceTypeRowsData, s.codeSourceTypeFilter);
  renderTable();
});

// Pagination
els.prevBtn.addEventListener('click', () => {
  if (s.currentPage > 1) {
    s.currentPage -= 1;
    renderTable();
    els.tableContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

els.nextBtn.addEventListener('click', () => {
  s.currentPage += 1;
  renderTable();
  els.tableContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Row click → detail dialog
els.configsBody.addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (!tr) { return; }
  const { org, site } = tr.dataset;
  const row = s.rows.find((r) => r.org === org && r.site === site);
  if (row) { showDetail(row); }
});

// Copy-to-clipboard buttons inside detail dialog
els.detailBody.addEventListener('click', (e) => {
  const btn = e.target.closest('.copy-btn');
  if (!btn) { return; }
  navigator.clipboard.writeText(btn.dataset.copy).then(() => {
    btn.textContent = '✓';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'copy';
      btn.classList.remove('copied');
    }, 1500);
  });
});

// Close detail dialog
document.getElementById('detailClose').addEventListener('click', () => {
  els.configDetail.close();
});

els.configDetail.addEventListener('click', (e) => {
  if (e.target === els.configDetail) { els.configDetail.close(); }
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

document.getElementById('refreshBtn').addEventListener('click', () => {
  moreMenu.close();
  loadData(true);
});

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

document.getElementById('loginForm').addEventListener('submit', handleLogin);

window.addEventListener('login-success', () => {
  showDashboard();
  loadData();
});

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
