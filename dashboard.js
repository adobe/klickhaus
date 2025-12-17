// Configuration
const CLICKHOUSE_URL = 'https://ogadftwx3q.us-east1.gcp.clickhouse.cloud:8443/';
const DATABASE = 'helix_logs_production';
// Use partitioned table for recent queries, old table for historical
// TODO: expand to ['15m', '1h', '12h'] once v2 has 12h of data
function getTable() {
  return ['15m', '1h'].includes(state.timeRange)
    ? 'cdn_requests_v2'
    : 'cdn_requests_combined';
}

// State
const state = {
  credentials: null,
  timeRange: '1h',
  hostFilter: '',
  topN: 5,
  filters: [],    // [{col: '`request.url`', value: '/foo', exclude: false}]
  logsData: null,
  logsLoading: false,
  logsReady: false,
  showLogs: false,
  pinnedColumns: JSON.parse(localStorage.getItem('pinnedColumns') || '[]'),
};

function togglePinnedColumn(col) {
  const idx = state.pinnedColumns.indexOf(col);
  if (idx === -1) {
    state.pinnedColumns.push(col);
  } else {
    state.pinnedColumns.splice(idx, 1);
  }
  localStorage.setItem('pinnedColumns', JSON.stringify(state.pinnedColumns));
  if (state.logsData) {
    renderLogsTable(state.logsData);
  }
}

// URL State Management
function saveStateToURL() {
  const params = new URLSearchParams();

  if (state.timeRange !== '1h') params.set('t', state.timeRange);
  if (state.hostFilter) params.set('host', state.hostFilter);
  if (state.topN !== 5) params.set('n', state.topN);
  if (state.showLogs) params.set('view', 'logs');

  // Save query timestamp as ISO string
  if (queryTimestamp) {
    params.set('ts', queryTimestamp.toISOString());
  }

  // Encode filters as JSON array
  if (state.filters.length > 0) {
    params.set('filters', JSON.stringify(state.filters));
  }

  const newURL = params.toString()
    ? `${window.location.pathname}?${params}`
    : window.location.pathname;
  window.history.replaceState({}, '', newURL);
}

function loadStateFromURL() {
  const params = new URLSearchParams(window.location.search);

  if (params.has('t')) {
    const t = params.get('t');
    if (['15m', '1h', '12h', '24h', '7d'].includes(t)) {
      state.timeRange = t;
    }
  }

  if (params.has('host')) {
    state.hostFilter = params.get('host');
  }

  if (params.has('n')) {
    const n = parseInt(params.get('n'));
    if ([5, 10, 20, 50, 100].includes(n)) {
      state.topN = n;
    }
  }

  if (params.has('view') && params.get('view') === 'logs') {
    state.showLogs = true;
  }

  if (params.has('ts')) {
    const ts = new Date(params.get('ts'));
    if (!isNaN(ts.getTime())) {
      queryTimestamp = ts;
    }
  }

  if (params.has('filters')) {
    try {
      const filters = JSON.parse(params.get('filters'));
      if (Array.isArray(filters)) {
        // Preserve filterCol and filterValue if present (for ASN integer filtering)
        state.filters = filters.filter(f => f.col && typeof f.value === 'string' && typeof f.exclude === 'boolean')
          .map(f => {
            const filter = { col: f.col, value: f.value, exclude: f.exclude };
            if (f.filterCol) filter.filterCol = f.filterCol;
            if (f.filterValue !== undefined) filter.filterValue = f.filterValue;
            return filter;
          });
      }
    } catch (e) {
      console.error('Failed to parse filters from URL:', e);
    }
  }
}

function syncUIFromState() {
  timeRangeSelect.value = state.timeRange;
  topNSelect.value = state.topN;
  hostFilterInput.value = state.hostFilter;
  renderActiveFilters();

  if (state.showLogs) {
    logsView.classList.add('visible');
    dashboardContent.classList.add('hidden');
    logsBtn.classList.add('active');
    logsBtn.textContent = 'Dashboard';
  }
}

// DOM Elements
const loginSection = document.getElementById('login');
const dashboardSection = document.getElementById('dashboard');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const timeRangeSelect = document.getElementById('timeRange');
const topNSelect = document.getElementById('topN');
const hostFilterInput = document.getElementById('hostFilter');
const refreshBtn = document.getElementById('refreshBtn');
const logoutBtn = document.getElementById('logoutBtn');
const logsBtn = document.getElementById('logsBtn');
const logsView = document.getElementById('logsView');
const dashboardContent = document.getElementById('dashboardContent');

// Initialize
async function init() {
  // Load state from URL first
  loadStateFromURL();

  // Check for stored credentials and validate them
  const stored = localStorage.getItem('clickhouse_credentials');
  if (stored) {
    state.credentials = JSON.parse(stored);
    try {
      // Validate stored credentials before showing dashboard
      await query('SELECT 1', { skipCache: true });
      syncUIFromState();
      showDashboard();
      loadDashboard();
    } catch (err) {
      // Stored credentials are invalid, clear them and show login
      state.credentials = null;
      localStorage.removeItem('clickhouse_credentials');
      console.log('Stored credentials invalid, showing login');
    }
  }

  // Event listeners
  loginForm.addEventListener('submit', handleLogin);
  logoutBtn.addEventListener('click', handleLogout);
  refreshBtn.addEventListener('click', () => loadDashboard(true));
  timeRangeSelect.addEventListener('change', (e) => {
    state.timeRange = e.target.value;
    // Reset timestamp when changing time range to show most recent window
    queryTimestamp = new Date();
    saveStateToURL();
    loadDashboard();
  });

  topNSelect.addEventListener('change', (e) => {
    state.topN = parseInt(e.target.value);
    saveStateToURL();
    loadAllBreakdowns();
  });

  let filterTimeout;
  hostFilterInput.addEventListener('input', (e) => {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
      state.hostFilter = e.target.value;
      saveStateToURL();
      loadDashboard();
    }, 500);
  });

  // Logs button - click to toggle, hover when ready
  logsBtn.addEventListener('click', toggleLogsView);
  logsBtn.addEventListener('mouseenter', () => {
    if (state.logsReady && !state.showLogs) {
      toggleLogsView();
    }
  });
}

// Auth
async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  state.credentials = { user: username, password };

  try {
    // Test connection
    await query('SELECT 1');
    localStorage.setItem('clickhouse_credentials', JSON.stringify(state.credentials));
    loginError.classList.remove('visible');
    showDashboard();
    loadDashboard();
  } catch (err) {
    state.credentials = null;
    loginError.textContent = 'Authentication failed. Please check your credentials.';
    loginError.classList.add('visible');
  }
}

function handleLogout() {
  state.credentials = null;
  localStorage.removeItem('clickhouse_credentials');
  showLogin();
}

function showLogin() {
  loginSection.classList.remove('hidden');
  dashboardSection.classList.remove('visible');
}

function showDashboard() {
  loginSection.classList.add('hidden');
  dashboardSection.classList.add('visible');
}

// Query Helper
async function query(sql, { cacheTtl = null, skipCache = false } = {}) {
  const params = new URLSearchParams();

  // Skip caching entirely for simple queries like auth check
  if (!skipCache) {
    // Short TTL (1s) when refresh button is clicked to bypass cache
    if (forceRefresh) {
      cacheTtl = 1;
    } else if (cacheTtl === null) {
      // Longer TTLs since we use fixed timestamps for deterministic queries
      // Cache is effectively invalidated by timestamp change on refresh/page load
      const ttls = {
        '15m': 60,     // 1 minute for last 15 minutes
        '1h': 300,     // 5 minutes for last hour
        '12h': 600,    // 10 minutes for last 12 hours
        '24h': 900,    // 15 minutes for last 24 hours
        '7d': 1800     // 30 minutes for last 7 days
      };
      cacheTtl = ttls[state.timeRange] || 300;
    }
    params.set('use_query_cache', '1');
    params.set('query_cache_ttl', cacheTtl.toString());
    params.set('query_cache_nondeterministic_function_handling', 'save');
  }

  // Normalize SQL whitespace for consistent cache keys
  const normalizedSql = sql.replace(/\s+/g, ' ').trim();

  const url = `${CLICKHOUSE_URL}?${params}`;
  const fetchStart = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(`${state.credentials.user}:${state.credentials.password}`)
    },
    body: normalizedSql + ' FORMAT JSON'
  });
  const fetchEnd = performance.now();

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text);
  }

  const data = await response.json();
  // Wall clock timing from fetch call to response
  data._networkTime = fetchEnd - fetchStart;
  return data;
}

// Time range helpers
function getInterval() {
  const intervals = {
    '15m': 'INTERVAL 15 MINUTE',
    '1h': 'INTERVAL 1 HOUR',
    '12h': 'INTERVAL 12 HOUR',
    '24h': 'INTERVAL 24 HOUR',
    '7d': 'INTERVAL 7 DAY'
  };
  return intervals[state.timeRange];
}

function getTimeBucket() {
  const buckets = {
    '15m': 'toStartOfInterval(timestamp, INTERVAL 30 SECOND)',
    '1h': 'toStartOfMinute(timestamp)',
    '12h': 'toStartOfTenMinutes(timestamp)',
    '24h': 'toStartOfFifteenMinutes(timestamp)',
    '7d': 'toStartOfHour(timestamp)'
  };
  return buckets[state.timeRange];
}

function getTimeFilter() {
  // Use fixed timestamp instead of now() for deterministic/cacheable queries
  const ts = queryTimestamp || new Date();
  // Format as 'YYYY-MM-DD HH:MM:SS' (no milliseconds)
  const isoTimestamp = ts.toISOString().replace('T', ' ').slice(0, 19);
  // Use BETWEEN to bound both start and end of the time window
  return `timestamp BETWEEN toDateTime('${isoTimestamp}') - ${getInterval()} AND toDateTime('${isoTimestamp}')`;
}

function getHostFilter() {
  if (!state.hostFilter) return '';
  const escaped = state.hostFilter.replace(/'/g, "\\'");
  return `AND (\`request.host\` LIKE '%${escaped}%' OR \`request.headers.x_forwarded_host\` LIKE '%${escaped}%')`;
}

function buildFacetFilterSQL(filters) {
  if (filters.length === 0) return '';

  // Group filters by column (use filterCol for SQL if present)
  const byColumn = {};
  for (const f of filters) {
    const sqlCol = f.filterCol || f.col;
    const sqlValue = f.filterValue ?? f.value;
    if (!byColumn[f.col]) byColumn[f.col] = { sqlCol, includes: [], excludes: [] };
    // Use numeric comparison for integer filter values, string otherwise
    const isNumeric = typeof sqlValue === 'number';
    const escaped = isNumeric ? sqlValue : sqlValue.replace(/'/g, "\\'");
    const comparison = isNumeric ? escaped : `'${escaped}'`;
    if (f.exclude) {
      byColumn[f.col].excludes.push(`${sqlCol} != ${comparison}`);
    } else {
      byColumn[f.col].includes.push(`${sqlCol} = ${comparison}`);
    }
  }

  // Build SQL for each column group
  const columnClauses = [];
  for (const col of Object.keys(byColumn)) {
    const { includes, excludes } = byColumn[col];
    const parts = [];
    // Include filters: OR together (match any of these values)
    if (includes.length > 0) {
      parts.push(includes.length === 1 ? includes[0] : `(${includes.join(' OR ')})`);
    }
    // Exclude filters: AND together (exclude all of these values)
    if (excludes.length > 0) {
      parts.push(excludes.join(' AND '));
    }
    // Combine includes and excludes for this column with AND
    columnClauses.push(parts.length === 1 ? parts[0] : `(${parts.join(' AND ')})`);
  }

  // Combine all column clauses with AND
  return columnClauses.map(c => `AND ${c}`).join(' ');
}

function getFacetFilters() {
  return buildFacetFilterSQL(state.filters);
}

function getFacetFiltersExcluding(col) {
  return buildFacetFilterSQL(state.filters.filter(f => f.col !== col));
}

function getFiltersForColumn(col) {
  return state.filters.filter(f => f.col === col);
}

function clearFiltersForColumn(col) {
  state.filters = state.filters.filter(f => f.col !== col);
  renderActiveFilters();
  saveStateToURL();
  loadDashboard();
}

function addFilter(col, value, exclude) {
  // Remove existing filter for same col+value
  state.filters = state.filters.filter(f => !(f.col === col && f.value === value));

  // Look up breakdown to get filterCol and filterValueFn if defined
  const breakdown = allBreakdowns.find(b => b.col === col);
  const filter = { col, value, exclude };
  if (breakdown?.filterCol) {
    filter.filterCol = breakdown.filterCol;
    filter.filterValue = breakdown.filterValueFn ? breakdown.filterValueFn(value) : value;
  }

  state.filters.push(filter);
  renderActiveFilters();
  saveStateToURL();
  loadDashboard();
}

function removeFilter(index) {
  state.filters.splice(index, 1);
  renderActiveFilters();
  saveStateToURL();
  loadDashboard();
}

function removeFilterByValue(col, value) {
  state.filters = state.filters.filter(f => !(f.col === col && f.value === value));
  renderActiveFilters();
  saveStateToURL();
  loadDashboard();
}

function renderActiveFilters() {
  const container = document.getElementById('activeFilters');
  if (state.filters.length === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = state.filters.map((f, i) => {
    const label = f.exclude ? `NOT ${f.value}` : f.value;
    return `<span class="filter-tag ${f.exclude ? 'exclude' : ''}">${escapeHtml(label)}<button onclick="removeFilter(${i})">×</button></span>`;
  }).join('');
}

// Format helpers
function formatNumber(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toString();
}

function formatBytes(bytes) {
  if (bytes >= 1e12) return (bytes / 1e12).toFixed(2) + ' TB';
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(2) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(2) + ' KB';
  return bytes + ' B';
}

function formatPercent(current, previous) {
  if (!previous || previous === 0) return { text: '', className: '' };
  const change = ((current - previous) / previous) * 100;
  const sign = change >= 0 ? '+' : '';
  return {
    text: `${sign}${change.toFixed(1)}%`,
    className: change >= 0 ? 'positive' : 'negative'
  };
}

// Query timer
let queryTimerInterval = null;
let queryStartTime = null;
const queryTimerEl = document.getElementById('queryTimer');

// Track visible facets with IntersectionObserver
const visibleFacets = new Set();
const facetObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      visibleFacets.add(entry.target.id);
    } else {
      visibleFacets.delete(entry.target.id);
    }
  });
}, { rootMargin: '50px' });

// Check if element is in viewport
function isInViewport(el) {
  const rect = el.getBoundingClientRect();
  return (
    rect.top < (window.innerHeight || document.documentElement.clientHeight) + 50 &&
    rect.bottom > -50 &&
    rect.left < (window.innerWidth || document.documentElement.clientWidth) + 50 &&
    rect.right > -50
  );
}

// Observe all breakdown cards and check initial visibility
document.querySelectorAll('.breakdown-card').forEach(card => {
  facetObserver.observe(card);
  // Check initial visibility for elements already in viewport
  if (isInViewport(card)) {
    visibleFacets.add(card.id);
  }
});

function getTimerClass(ms) {
  // Aligned with Google's LCP thresholds
  if (ms < 2500) return 'query-timer fast';    // Good: < 2.5s
  if (ms < 4000) return 'query-timer medium';  // Needs Improvement: 2.5-4s
  return 'query-timer slow';                   // Poor: > 4s
}

function startQueryTimer() {
  queryStartTime = performance.now();
  if (queryTimerInterval) clearInterval(queryTimerInterval);
  queryTimerInterval = setInterval(() => {
    const elapsed = performance.now() - queryStartTime;
    queryTimerEl.textContent = formatQueryTime(elapsed);
    queryTimerEl.className = getTimerClass(elapsed);
  }, 10);
}

function stopQueryTimer() {
  if (!queryTimerInterval) return; // Already stopped
  clearInterval(queryTimerInterval);
  queryTimerInterval = null;
  const elapsed = performance.now() - queryStartTime;
  queryTimerEl.textContent = formatQueryTime(elapsed);
  queryTimerEl.className = getTimerClass(elapsed);
}

function formatQueryTime(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// Load Dashboard Data
let forceRefresh = false;
let queryTimestamp = null;
let facetTimings = {}; // Track elapsed time per facet id

// Mark the slowest facet with a glow
function markSlowestFacet() {
  // Remove existing slowest markers
  document.querySelectorAll('.speed-indicator.slowest').forEach(el => {
    el.classList.remove('slowest');
  });

  // Find the slowest facet
  let slowestId = null;
  let slowestTime = 0;
  for (const [id, time] of Object.entries(facetTimings)) {
    if (time > slowestTime) {
      slowestTime = time;
      slowestId = id;
    }
  }

  // Add slowest class to the indicator
  if (slowestId) {
    const card = document.getElementById(slowestId);
    const indicator = card?.querySelector('.speed-indicator');
    if (indicator) {
      indicator.classList.add('slowest');
    }
  }
}

// Check if any visible facet is still updating
function hasVisibleUpdatingFacets() {
  for (const id of visibleFacets) {
    const card = document.getElementById(id);
    if (card && card.classList.contains('updating')) {
      return true;
    }
  }
  return false;
}

async function loadDashboard(refresh = false) {
  forceRefresh = refresh;
  // Only set new timestamp if not already set from URL or if refreshing
  if (!queryTimestamp || refresh) {
    queryTimestamp = new Date();
  }
  saveStateToURL();
  startQueryTimer();
  facetTimings = {}; // Reset timings for this load

  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();

  // Start loading time series
  const timeSeriesPromise = loadTimeSeries();

  // Start loading all facets in parallel (they manage their own blur state)
  const facetPromises = allBreakdowns.map(b =>
    loadBreakdown(b, timeFilter, hostFilter).then(() => {
      // After each facet completes, check if timer should stop
      if (!hasVisibleUpdatingFacets()) {
        stopQueryTimer();
      }
    })
  );

  // Wait for all facets to complete, then mark slowest
  Promise.all(facetPromises).then(() => {
    markSlowestFacet();
  });

  // Wait for time series to complete
  await timeSeriesPromise;

  // If no visible facets are updating after time series, stop timer
  if (!hasVisibleUpdatingFacets()) {
    stopQueryTimer();
  }

  // Load logs in background
  loadLogs();

  forceRefresh = false;
}

// Time Series Chart
async function loadTimeSeries() {
  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const facetFilters = getFacetFilters();
  const bucket = getTimeBucket();

  const sql = `
    SELECT
      ${bucket} as t,
      countIf(\`response.status\` >= 100 AND \`response.status\` < 400) as cnt_ok,
      countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx,
      countIf(\`response.status\` >= 500) as cnt_5xx
    FROM ${DATABASE}.${getTable()}
    WHERE ${timeFilter} ${hostFilter} ${facetFilters}
    GROUP BY t
    ORDER BY t
  `;

  try {
    const result = await query(sql);
    renderChart(result.data);
  } catch (err) {
    console.error('Chart error:', err);
  }
}

function renderChart(data) {
  const canvas = document.getElementById('chart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  // Set canvas size
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Clear
  ctx.clearRect(0, 0, width, height);

  // Get CSS variables for theming
  const styles = getComputedStyle(document.documentElement);
  const cssVar = (name) => styles.getPropertyValue(name).trim();

  if (data.length === 0) {
    ctx.fillStyle = cssVar('--text-secondary');
    ctx.textAlign = 'center';
    ctx.fillText('No data', width / 2, height / 2);
    return;
  }

  // Parse data into stacked values
  const series = {
    ok: data.map(d => parseInt(d.cnt_ok) || 0),
    client: data.map(d => parseInt(d.cnt_4xx) || 0),
    server: data.map(d => parseInt(d.cnt_5xx) || 0)
  };

  // Calculate stacked totals for max value
  const totals = data.map((_, i) => series.ok[i] + series.client[i] + series.server[i]);
  const maxValue = Math.max(...totals);
  const minValue = 0;

  // Colors from CSS variables
  const hexToRgba = (hex, alpha) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const okColor = cssVar('--status-ok');
  const clientColor = cssVar('--status-client-error');
  const serverColor = cssVar('--status-server-error');

  const colors = {
    ok: { line: okColor, fill: hexToRgba(okColor, 0.3) },
    client: { line: clientColor, fill: hexToRgba(clientColor, 0.3) },
    server: { line: serverColor, fill: hexToRgba(serverColor, 0.3) }
  };

  // Draw axes
  ctx.strokeStyle = cssVar('--axis-line');
  ctx.lineWidth = 1;

  // Y axis
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, height - padding.bottom);
  ctx.stroke();

  // X axis
  ctx.beginPath();
  ctx.moveTo(padding.left, height - padding.bottom);
  ctx.lineTo(width - padding.right, height - padding.bottom);
  ctx.stroke();

  // Y axis labels
  ctx.fillStyle = cssVar('--text-secondary');
  ctx.font = '11px -apple-system, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = minValue + (maxValue - minValue) * (i / 4);
    const y = height - padding.bottom - (chartHeight * i / 4);
    ctx.fillText(formatNumber(Math.round(val)), padding.left - 8, y + 4);

    // Grid line
    ctx.strokeStyle = cssVar('--grid-line');
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  // X axis labels
  ctx.fillStyle = cssVar('--text-secondary');
  ctx.textAlign = 'center';
  const labelStep = Math.ceil(data.length / 6);
  for (let i = 0; i < data.length; i += labelStep) {
    const x = padding.left + (chartWidth * i / (data.length - 1));
    const time = new Date(data[i].t);
    const label = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    ctx.fillText(label, x, height - padding.bottom + 20);
  }

  // Helper function to get Y coordinate
  const getY = (value) => height - padding.bottom - (chartHeight * value / (maxValue || 1));
  const getX = (i) => padding.left + (chartWidth * i / (data.length - 1 || 1));

  // Draw stacked areas (bottom to top: server, client, ok)
  // Reversed order: 5xx at bottom, then 4xx, then 1xx-3xx on top

  // Calculate cumulative values for stacking (reversed order)
  const stackedServer = series.server.slice();
  const stackedClient = series.server.map((v, i) => v + series.client[i]);
  const stackedOk = series.server.map((v, i) => v + series.client[i] + series.ok[i]);

  // Draw 1xx-3xx area (top layer - green)
  if (series.ok.some(v => v > 0)) {
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(stackedClient[0]));
    for (let i = 0; i < data.length; i++) {
      ctx.lineTo(getX(i), getY(stackedOk[i]));
    }
    for (let i = data.length - 1; i >= 0; i--) {
      ctx.lineTo(getX(i), getY(stackedClient[i]));
    }
    ctx.closePath();
    ctx.fillStyle = colors.ok.fill;
    ctx.fill();

    // Draw line on top
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(stackedOk[0]));
    for (let i = 1; i < data.length; i++) {
      ctx.lineTo(getX(i), getY(stackedOk[i]));
    }
    ctx.strokeStyle = colors.ok.line;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Draw 4xx area (middle layer - yellow/orange)
  if (series.client.some(v => v > 0)) {
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(stackedServer[0]));
    for (let i = 0; i < data.length; i++) {
      ctx.lineTo(getX(i), getY(stackedClient[i]));
    }
    for (let i = data.length - 1; i >= 0; i--) {
      ctx.lineTo(getX(i), getY(stackedServer[i]));
    }
    ctx.closePath();
    ctx.fillStyle = colors.client.fill;
    ctx.fill();

    // Draw line on top
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(stackedClient[0]));
    for (let i = 1; i < data.length; i++) {
      ctx.lineTo(getX(i), getY(stackedClient[i]));
    }
    ctx.strokeStyle = colors.client.line;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Draw 5xx area (bottom layer - red)
  if (series.server.some(v => v > 0)) {
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(0));
    for (let i = 0; i < data.length; i++) {
      ctx.lineTo(getX(i), getY(stackedServer[i]));
    }
    ctx.lineTo(getX(data.length - 1), getY(0));
    ctx.closePath();
    ctx.fillStyle = colors.server.fill;
    ctx.fill();

    // Draw line on top
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(stackedServer[0]));
    for (let i = 1; i < data.length; i++) {
      ctx.lineTo(getX(i), getY(stackedServer[i]));
    }
    ctx.strokeStyle = colors.server.line;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// Link generation helpers
function hostLink(val) {
  if (!val) return null;
  return 'https://' + val;
}

function forwardedHostLink(val) {
  if (!val) return null;
  // Take first host if comma-separated
  const firstHost = val.split(',')[0].trim();
  return 'https://' + firstHost;
}

function refererLink(val) {
  if (!val) return null;
  // Referer is already a full URL
  if (val.startsWith('http://') || val.startsWith('https://')) {
    return val;
  }
  return null;
}

function pathLink(val) {
  if (!val) return null;
  // Only link if we have an active host filter
  const hostFilter = state.filters.find(f => f.col === '`request.host`' && !f.exclude);
  if (hostFilter) {
    return 'https://' + hostFilter.value + val;
  }
  return null;
}

// Breakdown Tables
const allBreakdowns = [
  { id: 'breakdown-status-range', col: "concat(toString(intDiv(`response.status`, 100)), 'xx')" },
  { id: 'breakdown-hosts', col: '`request.host`', linkFn: hostLink, dimPrefixes: ['main--'] },
  { id: 'breakdown-forwarded-hosts', col: '`request.headers.x_forwarded_host`', linkFn: forwardedHostLink },
  { id: 'breakdown-content-types', col: '`response.headers.content_type`' },
  { id: 'breakdown-status', col: 'toString(`response.status`)' },
  { id: 'breakdown-errors', col: '`response.headers.x_error`', extraFilter: "AND `response.headers.x_error` != ''" },
  { id: 'breakdown-cache', col: 'upper(`cdn.cache_status`)' },
  { id: 'breakdown-paths', col: '`request.url`', linkFn: pathLink },
  { id: 'breakdown-referers', col: '`request.headers.referer`', linkFn: refererLink, dimPrefixes: ['https://', 'http://'] },
  { id: 'breakdown-user-agents', col: '`request.headers.user_agent`', dimPrefixes: ['Mozilla/5.0 '] },
  { id: 'breakdown-ips', col: "if(`request.headers.x_forwarded_for` != '', `request.headers.x_forwarded_for`, `client.ip`)", linkPrefix: 'https://centralops.net/co/DomainDossier?dom_whois=1&net_whois=1&addr=' },
  { id: 'breakdown-request-type', col: '`helix.request_type`', extraFilter: "AND `helix.request_type` != ''" },
  { id: 'breakdown-backend-type', col: '`helix.backend_type`', extraFilter: "AND `helix.backend_type` != ''" },
  { id: 'breakdown-methods', col: '`request.method`' },
  { id: 'breakdown-datacenters', col: '`cdn.datacenter`' },
  { id: 'breakdown-asn', col: "concat(toString(`client.asn`), ' - ', dictGet('helix_logs_production.asn_dict', 'name', `client.asn`))", filterCol: '`client.asn`', filterValueFn: (v) => parseInt(v.split(' - ')[0]), extraFilter: "AND `client.asn` != 0", linkPrefix: 'https://mxtoolbox.com/SuperTool.aspx?action=asn%3aAS', linkSuffix: '&run=toolpage' }
];

async function loadAllBreakdowns() {
  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  await Promise.all(allBreakdowns.map(b => loadBreakdown(b, timeFilter, hostFilter)));
}

async function loadBreakdown(b, timeFilter, hostFilter) {
  const card = document.getElementById(b.id);
  card.classList.add('updating');

  const extra = b.extraFilter || '';
  // Get filters excluding this facet's column to show all values for active facets
  const facetFilters = getFacetFiltersExcluding(b.col);
  const sql = `
    SELECT
      ${b.col} as dim,
      count() as cnt,
      countIf(\`response.status\` >= 100 AND \`response.status\` < 400) as cnt_ok,
      countIf(\`response.status\` >= 400 AND \`response.status\` < 500) as cnt_4xx,
      countIf(\`response.status\` >= 500) as cnt_5xx
    FROM ${DATABASE}.${getTable()}
    WHERE ${timeFilter} ${hostFilter} ${facetFilters} ${extra}
    GROUP BY dim
    ORDER BY cnt DESC
    LIMIT ${state.topN}
  `;

  const startTime = performance.now();
  try {
    const result = await query(sql);
    // Prefer actual network time from Resource Timing API, fallback to wall clock
    const elapsed = result._networkTime ?? (performance.now() - startTime);
    facetTimings[b.id] = elapsed; // Track timing for slowest detection
    renderBreakdownTable(b.id, result.data, b.col, b.linkPrefix, b.linkSuffix, b.linkFn, elapsed, b.dimPrefixes);
  } catch (err) {
    console.error(`Breakdown error (${b.id}):`, err);
    renderBreakdownError(b.id, err.message);
  } finally {
    card.classList.remove('updating');
  }
}

// Format dimension value with dimmed prefix if applicable
function formatDimWithPrefix(dim, dimPrefixes) {
  if (!dimPrefixes || dimPrefixes.length === 0) return escapeHtml(dim);
  for (const prefix of dimPrefixes) {
    if (dim.startsWith(prefix)) {
      return `<span class="dim-prefix">${escapeHtml(prefix)}</span>${escapeHtml(dim.slice(prefix.length))}`;
    }
  }
  return escapeHtml(dim);
}

function renderBreakdownTable(id, data, col, linkPrefix, linkSuffix, linkFn, elapsed, dimPrefixes) {
  const card = document.getElementById(id);
  // Store original title in data attribute, or read from h3 if first render
  if (!card.dataset.title) {
    card.dataset.title = card.querySelector('h3').textContent;
  }
  const title = card.dataset.title;

  // Get active filters for this column
  const columnFilters = getFiltersForColumn(col);
  const hasFilters = columnFilters.length > 0;
  const colEscaped = col.replace(/'/g, "\\'");

  // Speed indicator based on elapsed time (aligned with Google LCP thresholds)
  const speedClass = elapsed < 2500 ? 'fast' : (elapsed < 4000 ? 'medium' : 'slow');
  const speedTitle = formatQueryTime(elapsed);
  const speedIndicator = `<span class="speed-indicator ${speedClass}" title="${speedTitle}"></span>`;

  if (data.length === 0) {
    let html = `<h3>${speedIndicator}${title}`;
    if (hasFilters) {
      html += ` <button class="clear-facet-btn" onclick="clearFiltersForColumn('${colEscaped}')">Clear</button>`;
    }
    html += `</h3><div class="empty">No data</div>`;
    card.innerHTML = html;
    return;
  }

  const maxCount = Math.max(...data.map(d => parseInt(d.cnt)));
  const total = data.reduce((sum, d) => sum + parseInt(d.cnt), 0);

  let html = `<h3>${speedIndicator}${title}`;
  if (hasFilters) {
    html += ` <button class="clear-facet-btn" onclick="clearFiltersForColumn('${colEscaped}')">Clear</button>`;
  }
  html += `</h3><table class="breakdown-table">`;

  for (const row of data) {
    const cnt = parseInt(row.cnt);
    const cntOk = parseInt(row.cnt_ok) || 0;
    const cnt4xx = parseInt(row.cnt_4xx) || 0;
    const cnt5xx = parseInt(row.cnt_5xx) || 0;

    // Calculate percentages relative to max count (for bar width)
    const barWidth = (cnt / maxCount) * 100;
    // Calculate percentages within this row (for stacked segments)
    const pct5xx = cnt > 0 ? (cnt5xx / cnt) * 100 : 0;
    const pct4xx = cnt > 0 ? (cnt4xx / cnt) * 100 : 0;
    const pctOk = cnt > 0 ? (cntOk / cnt) * 100 : 0;

    const dim = row.dim || '(empty)';
    const dimEscaped = (row.dim || '').replace(/'/g, "\\'").replace(/\\/g, '\\\\');

    // Check if this value is currently filtered
    const activeFilter = columnFilters.find(f => f.value === (row.dim || ''));
    const isIncluded = activeFilter && !activeFilter.exclude;
    const isExcluded = activeFilter && activeFilter.exclude;
    const rowClass = isIncluded ? 'filter-included' : (isExcluded ? 'filter-excluded' : '');

    // Build dimension cell content - with optional link and dimmed prefix
    let dimContent;
    let linkUrl = null;
    if (linkFn && row.dim) {
      linkUrl = linkFn(row.dim);
    } else if (linkPrefix && row.dim) {
      // For ASN links, extract just the number (before " - ")
      const linkValue = row.dim.includes(' - ') ? row.dim.split(' - ')[0] : row.dim;
      linkUrl = linkPrefix + linkValue + (linkSuffix || '');
    }
    const formattedDim = formatDimWithPrefix(dim, dimPrefixes);
    if (linkUrl) {
      dimContent = `<a href="${linkUrl}" target="_blank" rel="noopener">${formattedDim}</a>`;
    } else {
      dimContent = formattedDim;
    }

    // Determine button actions based on current filter state
    const filterBtn = isIncluded
      ? `<button class="action-btn" onclick="removeFilterByValue('${colEscaped}', '${dimEscaped}')">Clear</button>`
      : `<button class="action-btn" onclick="addFilter('${colEscaped}', '${dimEscaped}', false)">Filter</button>`;
    const excludeBtn = isExcluded
      ? `<button class="action-btn" onclick="removeFilterByValue('${colEscaped}', '${dimEscaped}')">Clear</button>`
      : `<button class="action-btn exclude" onclick="addFilter('${colEscaped}', '${dimEscaped}', true)">Exclude</button>`;

    html += `
      <tr class="${rowClass}">
        <td class="dim" title="${escapeHtml(dim)}">${dimContent}</td>
        <td class="count">
          <span class="value">${formatNumber(cnt)}</span>
          ${filterBtn}
        </td>
        <td class="bar">
          <div class="bar-inner" style="width: ${barWidth}%">
            <div class="bar-segment bar-5xx" style="width: ${pct5xx}%"></div>
            <div class="bar-segment bar-4xx" style="width: ${pct4xx}%"></div>
            <div class="bar-segment bar-ok" style="width: ${pctOk}%"></div>
          </div>
          ${excludeBtn}
        </td>
      </tr>
    `;
  }
  html += '</table>';
  card.innerHTML = html;
}

function renderBreakdownError(id, message) {
  const card = document.getElementById(id);
  const title = card.querySelector('h3').textContent;
  card.innerHTML = `<h3>${title}</h3><div class="empty">Error loading data</div>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Logs View
function toggleLogsView() {
  state.showLogs = !state.showLogs;
  if (state.showLogs) {
    logsView.classList.add('visible');
    dashboardContent.classList.add('hidden');
    logsBtn.classList.add('active');
    logsBtn.textContent = 'Dashboard';
  } else {
    logsView.classList.remove('visible');
    dashboardContent.classList.remove('hidden');
    logsBtn.classList.remove('active');
    logsBtn.textContent = 'Logs';
  }
  saveStateToURL();
}

async function loadLogs() {
  if (state.logsLoading) return;
  state.logsLoading = true;
  state.logsReady = false;
  logsBtn.classList.remove('ready');

  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const facetFilters = getFacetFilters();

  const sql = `
    SELECT *
    FROM ${DATABASE}.${getTable()}
    WHERE ${timeFilter} ${hostFilter} ${facetFilters}
    ORDER BY timestamp DESC
    LIMIT 100
  `;

  try {
    const result = await query(sql);
    state.logsData = result.data;
    renderLogsTable(result.data);
    state.logsReady = true;
    logsBtn.classList.add('ready');
  } catch (err) {
    console.error('Logs error:', err);
    renderLogsError(err.message);
  } finally {
    state.logsLoading = false;
  }
}

function renderLogsTable(data) {
  const container = logsView.querySelector('.logs-table-container');

  if (data.length === 0) {
    container.innerHTML = '<div class="empty" style="padding: 60px;">No logs matching current filters</div>';
    return;
  }

  // Get all column names from first row
  const allColumns = Object.keys(data[0]);

  // Sort columns: pinned first (in pinned order), then unpinned (in original order)
  const pinned = state.pinnedColumns.filter(col => allColumns.includes(col));
  const unpinned = allColumns.filter(col => !state.pinnedColumns.includes(col));
  const columns = [...pinned, ...unpinned];

  // Calculate left offsets for sticky pinned columns
  // We'll measure after render, but estimate ~120px per column for now
  const COL_WIDTH = 120;

  let html = `
    <table class="logs-table">
      <thead>
        <tr>
          ${columns.map((col, idx) => {
            const isPinned = pinned.includes(col);
            const pinnedClass = isPinned ? 'pinned' : '';
            const leftOffset = isPinned ? `left: ${pinned.indexOf(col) * COL_WIDTH}px;` : '';
            const colEscaped = col.replace(/'/g, "\\'");
            return `<th class="${pinnedClass}" style="${leftOffset}" onclick="togglePinnedColumn('${colEscaped}')">${escapeHtml(col)}</th>`;
          }).join('')}
        </tr>
      </thead>
      <tbody>
  `;

  for (const row of data) {
    html += '<tr>';
    for (const col of columns) {
      let value = row[col];
      let cellClass = '';
      let displayValue = '';

      // Format specific columns
      if (col === 'timestamp' && value) {
        displayValue = new Date(value).toLocaleString();
        cellClass = 'timestamp';
      } else if (col === 'response.status' && value) {
        const status = parseInt(value);
        displayValue = String(status);
        if (status >= 500) cellClass = 'status-5xx';
        else if (status >= 400) cellClass = 'status-4xx';
        else cellClass = 'status-ok';
      } else if (col === 'response.body_size' && value) {
        displayValue = formatBytes(parseInt(value));
      } else if (col === 'request.method') {
        displayValue = value || '';
        cellClass = 'method';
      } else if (value === null || value === undefined || value === '') {
        displayValue = '';
      } else if (typeof value === 'object') {
        displayValue = JSON.stringify(value);
      } else {
        displayValue = String(value);
      }

      const isPinned = pinned.includes(col);
      if (isPinned) cellClass += ' pinned';
      const leftOffset = isPinned ? `left: ${pinned.indexOf(col) * COL_WIDTH}px;` : '';

      const escaped = escapeHtml(displayValue);
      html += `<td class="${cellClass.trim()}" style="${leftOffset}" title="${escaped}">${escaped}</td>`;
    }
    html += '</tr>';
  }

  html += '</tbody></table>';
  container.innerHTML = html;

  // After render, measure actual column widths and update left offsets
  if (pinned.length > 0) {
    requestAnimationFrame(() => {
      const table = container.querySelector('.logs-table');
      if (!table) return;
      const headerCells = table.querySelectorAll('thead th');
      const pinnedWidths = [];
      let cumLeft = 0;

      // Calculate cumulative widths for pinned columns
      for (let i = 0; i < pinned.length; i++) {
        pinnedWidths.push(cumLeft);
        cumLeft += headerCells[i].offsetWidth;
      }

      // Update all pinned cells with correct left values
      headerCells.forEach((th, idx) => {
        if (idx < pinned.length) {
          th.style.left = pinnedWidths[idx] + 'px';
        }
      });

      const rows = table.querySelectorAll('tbody tr');
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        cells.forEach((td, idx) => {
          if (idx < pinned.length) {
            td.style.left = pinnedWidths[idx] + 'px';
          }
        });
      });
    });
  }
}

function renderLogsError(message) {
  const container = logsView.querySelector('.logs-table-container');
  container.innerHTML = `<div class="empty" style="padding: 60px;">Error loading logs: ${escapeHtml(message)}</div>`;
}

// Start
init();
