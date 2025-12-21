/**
 * Klickhaus TUI - Main Entry Point
 */

import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { state } from './state.js';
import { testConnection, fetchChartData, fetchAllBreakdowns, fetchLogs, fetchSummary } from './api.js';
import { BREAKDOWNS, TIME_RANGES } from './config.js';
import {
  formatBytes, formatNumber, formatDuration, formatPercent, truncate,
  formatTimestamp, getStatusColor, getCacheColor, statusBar, parseArgs, showHelp
} from './utils.js';

let screen, grid, chart, summaryTable, breakdownList, breakdownTable, logsTable, statusBar_, hostFilterBox;
let currentBreakdownData = {};
let refreshInterval = null;
let hostFilterVisible = false;

/**
 * Initialize the TUI screen
 */
function initScreen() {
  screen = blessed.screen({
    smartCSR: true,
    title: 'Klickhaus - CDN Analytics',
    fullUnicode: true
  });

  // Create 12x12 grid layout
  grid = new contrib.grid({
    rows: 12,
    cols: 12,
    screen: screen
  });

  // Header with title and status
  const header = grid.set(0, 0, 1, 12, blessed.box, {
    content: '{bold}{cyan-fg}Klickhaus{/cyan-fg}{/bold} - CDN Analytics Dashboard',
    tags: true,
    style: {
      fg: 'white',
      bg: 'black'
    }
  });

  // Time series chart (top portion)
  chart = grid.set(1, 0, 4, 8, contrib.line, {
    label: ' Requests Over Time ',
    showLegend: true,
    legend: { width: 20 },
    wholeNumbersOnly: true,
    style: {
      line: 'green',
      text: 'white',
      baseline: 'white'
    }
  });

  // Summary statistics (top right)
  summaryTable = grid.set(1, 8, 4, 4, contrib.table, {
    label: ' Summary ',
    columnWidth: [15, 15],
    columnSpacing: 2,
    fg: 'white',
    interactive: false,
    style: {
      header: { fg: 'cyan', bold: true },
      cell: { fg: 'white' }
    }
  });

  // Breakdown facet list (left sidebar)
  breakdownList = grid.set(5, 0, 6, 3, blessed.list, {
    label: ' Facets ',
    keys: true,
    vi: true,
    mouse: true,
    border: { type: 'line' },
    style: {
      selected: { bg: 'blue', fg: 'white' },
      item: { fg: 'white' },
      border: { fg: 'cyan' }
    },
    items: BREAKDOWNS.map(b => b.label)
  });

  // Breakdown table (main content area)
  breakdownTable = grid.set(5, 3, 6, 9, contrib.table, {
    label: ' Breakdown ',
    columnWidth: [40, 12, 8, 8, 8, 30],
    columnSpacing: 1,
    fg: 'white',
    keys: true,
    vi: true,
    interactive: true,
    style: {
      header: { fg: 'cyan', bold: true },
      cell: { fg: 'white' }
    }
  });

  // Status bar at bottom
  statusBar_ = grid.set(11, 0, 1, 12, blessed.box, {
    content: getStatusBarContent(),
    tags: true,
    style: {
      fg: 'white',
      bg: 'blue'
    }
  });

  // Hidden logs table (toggled with 'l')
  logsTable = contrib.table({
    label: ' Logs ',
    columnWidth: [20, 6, 7, 30, 40, 10, 20, 10],
    columnSpacing: 1,
    fg: 'white',
    keys: true,
    vi: true,
    interactive: true,
    hidden: true,
    border: { type: 'line' },
    style: {
      header: { fg: 'cyan', bold: true },
      cell: { fg: 'white' },
      border: { fg: 'cyan' }
    }
  });

  screen.append(logsTable);

  // Host filter input (hidden by default, toggled with 'f')
  hostFilterBox = blessed.textbox({
    top: 1,
    left: 'center',
    width: 50,
    height: 3,
    label: ' Host Filter ',
    hidden: true,
    inputOnFocus: true,
    border: { type: 'line' },
    style: {
      fg: 'white',
      bg: 'black',
      border: { fg: 'cyan' },
      focus: { border: { fg: 'yellow' } }
    }
  });

  screen.append(hostFilterBox);

  setupKeyBindings();
  setupEvents();
}

/**
 * Get status bar content
 */
function getStatusBarContent() {
  const timeRange = state.get('timeRange');
  const hostFilter = state.get('hostFilter');
  const filters = state.get('filters');
  const loading = state.get('loading');
  const topN = state.get('topN');
  const currentView = state.get('currentView');

  let content = ` {bold}[${timeRange}]{/bold}`;

  if (currentView === 'logs') {
    const offset = state.get('logsOffset');
    const limit = state.get('logsLimit');
    const page = Math.floor(offset / limit) + 1;
    content += ` Page:${page}`;
  } else {
    content += ` Top:${topN}`;
  }

  if (hostFilter) {
    content += ` | Host: {yellow-fg}${truncate(hostFilter, 12)}{/yellow-fg}`;
  }

  if (filters.length > 0) {
    content += ` | Filters: {green-fg}${filters.length}{/green-fg}`;
  }

  if (loading) {
    content += ' | {yellow-fg}Loading...{/yellow-fg}';
  }

  let help;
  if (currentView === 'logs') {
    help = ' | {gray-fg}n/p{/gray-fg}:page {gray-fg}l{/gray-fg}:dashboard {gray-fg}Enter{/gray-fg}:detail {gray-fg}q{/gray-fg}:quit';
  } else {
    help = ' | {gray-fg}q{/gray-fg}:quit {gray-fg}r{/gray-fg}:refresh {gray-fg}1-5{/gray-fg}:time {gray-fg}l{/gray-fg}:logs {gray-fg}f{/gray-fg}:filter {gray-fg}?{/gray-fg}:help';
  }
  content += help;

  return content;
}

/**
 * Setup keyboard bindings
 */
function setupKeyBindings() {
  // Quit
  screen.key(['q', 'C-c'], () => {
    if (refreshInterval) clearInterval(refreshInterval);
    process.exit(0);
  });

  // Refresh
  screen.key(['r'], () => {
    state.set('queryTimestamp', new Date());
    loadDashboard();
  });

  // Time range shortcuts
  screen.key(['1'], () => changeTimeRange('15m'));
  screen.key(['2'], () => changeTimeRange('1h'));
  screen.key(['3'], () => changeTimeRange('12h'));
  screen.key(['4'], () => changeTimeRange('24h'));
  screen.key(['5'], () => changeTimeRange('7d'));

  // Toggle logs view
  screen.key(['l'], () => {
    if (state.get('currentView') === 'logs') {
      showDashboard();
    } else {
      showLogs();
    }
  });

  // Focus breakdown list
  screen.key(['b'], () => {
    showDashboard();
    breakdownList.focus();
  });

  // Tab between panels
  screen.key(['tab'], () => {
    if (breakdownList.focused) {
      breakdownTable.focus();
    } else {
      breakdownList.focus();
    }
  });

  // Escape to clear filters
  screen.key(['escape'], () => {
    state.clearFilters();
    loadDashboard();
  });

  // Help
  screen.key(['?'], () => {
    showHelpDialog();
  });

  // Host filter
  screen.key(['f'], () => {
    showHostFilter();
  });

  // Clear host filter with Ctrl+u
  screen.key(['C-u'], () => {
    state.set('hostFilter', '');
    state.set('queryTimestamp', new Date());
    loadDashboard();
  });

  // TopN controls - Page Up/Down to increase/decrease
  screen.key(['pageup', '+', '='], () => {
    const topN = state.get('topN');
    const newTopN = Math.min(topN * 2, 100);
    if (newTopN !== topN) {
      state.set('topN', newTopN);
      loadDashboard();
    }
  });

  screen.key(['pagedown', '-'], () => {
    const topN = state.get('topN');
    const newTopN = Math.max(Math.floor(topN / 2), 5);
    if (newTopN !== topN) {
      state.set('topN', newTopN);
      loadDashboard();
    }
  });

  // Breakdown list selection
  breakdownList.on('select', (item, index) => {
    state.set('selectedBreakdown', index);
    renderBreakdownTable();
  });

  // Breakdown table row selection (add filter)
  breakdownTable.rows.on('select', (item, index) => {
    if (index > 0) { // Skip header row
      const breakdown = BREAKDOWNS[state.get('selectedBreakdown')];
      const data = currentBreakdownData[breakdown.id];
      if (data && data.data && data.data[index - 1]) {
        const value = data.data[index - 1].dim;
        state.addFilter(breakdown.col, value);
        loadDashboard();
      }
    }
  });

  // Logs table row selection (show detail)
  logsTable.rows.on('select', (item, index) => {
    if (index > 0) { // Skip header row
      const logs = state.get('logsData');
      if (logs && logs[index - 1]) {
        showLogDetail(logs[index - 1]);
      }
    }
  });

  // Logs pagination - 'n' for next page, 'p' for previous
  screen.key(['n'], async () => {
    if (state.get('currentView') === 'logs') {
      const offset = state.get('logsOffset');
      const limit = state.get('logsLimit');
      const currentLogs = state.get('logsData') || [];
      if (currentLogs.length === limit) { // More data likely available
        state.set('logsOffset', offset + limit);
        await loadLogsData();
      }
    }
  });

  screen.key(['p'], async () => {
    if (state.get('currentView') === 'logs') {
      const offset = state.get('logsOffset');
      const limit = state.get('logsLimit');
      if (offset > 0) {
        state.set('logsOffset', Math.max(0, offset - limit));
        await loadLogsData();
      }
    }
  });
}

/**
 * Setup state change events
 */
function setupEvents() {
  state.on('change', (key) => {
    if (['loading', 'timeRange', 'hostFilter', 'filters', 'topN', 'currentView', 'logsOffset'].includes(key)) {
      statusBar_.setContent(getStatusBarContent());
      screen.render();
    }
  });
}

/**
 * Change time range
 */
function changeTimeRange(range) {
  state.set('timeRange', range);
  state.set('queryTimestamp', new Date());
  loadDashboard();
}

/**
 * Show dashboard view
 */
function showDashboard() {
  state.set('currentView', 'dashboard');
  logsTable.hide();
  chart.show();
  summaryTable.show();
  breakdownList.show();
  breakdownTable.show();
  breakdownList.focus();
  screen.render();
}

/**
 * Show logs view
 */
async function showLogs() {
  state.set('currentView', 'logs');
  chart.hide();
  summaryTable.hide();
  breakdownList.hide();
  breakdownTable.hide();

  logsTable.position = {
    top: 1,
    left: 0,
    width: '100%',
    height: '90%'
  };
  logsTable.show();
  logsTable.focus();

  await loadLogsData();
  screen.render();
}

/**
 * Show host filter input
 */
function showHostFilter() {
  hostFilterVisible = true;
  hostFilterBox.setValue(state.get('hostFilter') || '');
  hostFilterBox.show();
  hostFilterBox.focus();
  screen.render();

  hostFilterBox.once('submit', (value) => {
    hostFilterVisible = false;
    hostFilterBox.hide();
    state.set('hostFilter', value.trim());
    state.set('queryTimestamp', new Date());
    loadDashboard();
    breakdownList.focus();
  });

  hostFilterBox.key(['escape'], () => {
    hostFilterVisible = false;
    hostFilterBox.hide();
    breakdownList.focus();
    screen.render();
  });
}

/**
 * Show help dialog
 */
function showHelpDialog() {
  const helpBox = blessed.box({
    top: 'center',
    left: 'center',
    width: 65,
    height: 24,
    label: ' Help ',
    content: `
{bold}{cyan-fg}Navigation{/cyan-fg}{/bold}
  Tab / Shift+Tab    Switch between panels
  Arrow keys         Navigate within panel
  Enter              Select item / Apply filter
  Escape             Clear all filters / Close dialogs

{bold}{cyan-fg}Commands{/cyan-fg}{/bold}
  q                  Quit
  r                  Refresh data
  1-5                Time range (15m, 1h, 12h, 24h, 7d)
  l                  Toggle logs view
  b                  Focus breakdowns panel
  f                  Open host filter input
  Ctrl+u             Clear host filter
  +/-                Increase/decrease results (topN)
  ?                  Show this help

{bold}{cyan-fg}Filtering{/cyan-fg}{/bold}
  Select a breakdown row to add it as a filter.
  Multiple filters are combined with AND logic.
  Press Escape to clear all active filters.
`,
    tags: true,
    border: { type: 'line' },
    style: {
      border: { fg: 'cyan' },
      bg: 'black'
    }
  });

  screen.append(helpBox);
  helpBox.focus();
  helpBox.key(['escape', 'enter', 'q', '?'], () => {
    helpBox.destroy();
    screen.render();
  });
  screen.render();
}

/**
 * Load all dashboard data
 */
async function loadDashboard() {
  state.set('loading', true);
  screen.render();

  try {
    // Load data in parallel
    const [chartData, breakdowns, summary] = await Promise.all([
      fetchChartData(),
      fetchAllBreakdowns(),
      fetchSummary()
    ]);

    state.set('chartData', chartData);
    currentBreakdownData = breakdowns;

    renderChart(chartData);
    renderSummary(summary);
    renderBreakdownTable();
  } catch (err) {
    showError(err.message);
  } finally {
    state.set('loading', false);
    screen.render();
  }
}

/**
 * Show log detail view
 */
function showLogDetail(log) {
  const content = Object.entries(log)
    .map(([key, value]) => {
      const displayValue = value === null || value === undefined ? '{gray-fg}null{/gray-fg}' :
        typeof value === 'string' ? value :
          JSON.stringify(value);
      return `{cyan-fg}${key}{/cyan-fg}: ${displayValue}`;
    })
    .join('\n');

  const detailBox = blessed.box({
    top: 'center',
    left: 'center',
    width: '80%',
    height: '80%',
    label: ' Log Details ',
    content: content,
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: ' ',
      track: { bg: 'gray' },
      style: { inverse: true }
    },
    keys: true,
    vi: true,
    border: { type: 'line' },
    style: {
      border: { fg: 'cyan' },
      bg: 'black'
    }
  });

  screen.append(detailBox);
  detailBox.focus();

  detailBox.key(['escape', 'enter', 'q'], () => {
    detailBox.destroy();
    logsTable.focus();
    screen.render();
  });

  screen.render();
}

/**
 * Load logs data
 */
async function loadLogsData() {
  state.set('loading', true);
  screen.render();

  try {
    const logs = await fetchLogs();
    state.set('logsData', logs);
    renderLogsTable(logs);
  } catch (err) {
    showError(err.message);
  } finally {
    state.set('loading', false);
    screen.render();
  }
}

/**
 * Render time series chart
 */
function renderChart(data) {
  if (!data || data.length === 0) {
    chart.setData([{ title: 'No data', x: [], y: [] }]);
    return;
  }

  const labels = data.map(d => {
    const date = new Date(d.t);
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  });

  // Only show every Nth label to avoid crowding
  const step = Math.ceil(labels.length / 20);
  const sparseLabels = labels.map((l, i) => i % step === 0 ? l : '');

  chart.setData([
    {
      title: 'OK (2xx/3xx)',
      x: sparseLabels,
      y: data.map(d => parseInt(d.cnt_ok) || 0),
      style: { line: 'green' }
    },
    {
      title: '4xx',
      x: sparseLabels,
      y: data.map(d => parseInt(d.cnt_4xx) || 0),
      style: { line: 'yellow' }
    },
    {
      title: '5xx',
      x: sparseLabels,
      y: data.map(d => parseInt(d.cnt_5xx) || 0),
      style: { line: 'red' }
    }
  ]);
}

/**
 * Render summary statistics
 */
function renderSummary(summary) {
  if (!summary) {
    summaryTable.setData({ headers: ['Metric', 'Value'], data: [] });
    return;
  }

  const total = parseInt(summary.total) || 0;
  const cacheHits = parseInt(summary.cache_hits) || 0;
  const cacheRate = total > 0 ? cacheHits / total : 0;
  const errorRate = total > 0 ? (parseInt(summary.cnt_4xx) + parseInt(summary.cnt_5xx)) / total : 0;

  summaryTable.setData({
    headers: ['Metric', 'Value'],
    data: [
      ['Total Requests', formatNumber(total)],
      ['2xx/3xx', formatNumber(parseInt(summary.cnt_ok))],
      ['4xx Errors', formatNumber(parseInt(summary.cnt_4xx))],
      ['5xx Errors', formatNumber(parseInt(summary.cnt_5xx))],
      ['Cache Hit Rate', formatPercent(cacheRate)],
      ['Error Rate', formatPercent(errorRate)],
      ['Avg Response', formatDuration(parseFloat(summary.avg_time))],
      ['P95 Response', formatDuration(parseFloat(summary.p95_time))],
      ['Total Bytes', formatBytes(parseInt(summary.total_bytes))]
    ]
  });
}

/**
 * Render breakdown table for selected facet
 */
function renderBreakdownTable() {
  const index = state.get('selectedBreakdown');
  const breakdown = BREAKDOWNS[index];
  const data = currentBreakdownData[breakdown.id];

  breakdownTable.setLabel(` ${breakdown.label} `);

  if (!data || data.error) {
    breakdownTable.setData({
      headers: ['Value', 'Count', 'OK', '4xx', '5xx', 'Distribution'],
      data: [[data?.error || 'No data', '', '', '', '', '']]
    });
    screen.render();
    return;
  }

  const totals = data.totals || { cnt: 1 };
  const totalCount = parseInt(totals.cnt) || 1;

  const tableData = data.data.map(row => {
    const cnt = parseInt(row.cnt) || 0;
    const ok = parseInt(row.cnt_ok) || 0;
    const e4xx = parseInt(row.cnt_4xx) || 0;
    const e5xx = parseInt(row.cnt_5xx) || 0;
    const pct = (cnt / totalCount * 100).toFixed(1) + '%';

    return [
      truncate(String(row.dim || '(empty)'), 38),
      formatNumber(cnt) + ` (${pct})`,
      formatNumber(ok),
      formatNumber(e4xx),
      formatNumber(e5xx),
      statusBar(ok, e4xx, e5xx, 25)
    ];
  });

  breakdownTable.setData({
    headers: ['Value', 'Count', 'OK', '4xx', '5xx', 'Distribution'],
    data: tableData
  });
  screen.render();
}

/**
 * Render logs table
 */
function renderLogsTable(logs) {
  if (!logs || logs.length === 0) {
    logsTable.setData({
      headers: ['Time', 'Status', 'Method', 'Host', 'Path', 'Cache', 'Content-Type', 'Time(ms)'],
      data: [['No logs found', '', '', '', '', '', '', '']]
    });
    return;
  }

  const tableData = logs.map(row => [
    formatTimestamp(row.timestamp),
    String(row.response_status),
    row.request_method || '',
    truncate(row.request_host || '', 28),
    truncate(row.request_url || '', 38),
    row.cache_status || '',
    truncate(row.content_type || '', 18),
    String(row.time_elapsed_msec || '')
  ]);

  logsTable.setData({
    headers: ['Time', 'Status', 'Method', 'Host', 'Path', 'Cache', 'Content-Type', 'Time(ms)'],
    data: tableData
  });
}

/**
 * Show error message
 */
function showError(message) {
  const errorBox = blessed.message({
    top: 'center',
    left: 'center',
    width: 50,
    height: 'shrink',
    label: ' Error ',
    border: { type: 'line' },
    style: {
      border: { fg: 'red' }
    }
  });

  screen.append(errorBox);
  errorBox.error(message, 3, () => {
    errorBox.destroy();
    screen.render();
  });
}

/**
 * Show login prompt
 */
function showLoginPrompt() {
  return new Promise((resolve) => {
    const form = blessed.form({
      top: 'center',
      left: 'center',
      width: 50,
      height: 12,
      label: ' Login to ClickHouse ',
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' }
      }
    });

    blessed.text({
      parent: form,
      top: 1,
      left: 2,
      content: 'Username:'
    });

    const userInput = blessed.textbox({
      parent: form,
      top: 1,
      left: 12,
      width: 30,
      height: 1,
      inputOnFocus: true,
      style: {
        fg: 'white',
        bg: 'black',
        focus: { bg: 'blue' }
      }
    });

    blessed.text({
      parent: form,
      top: 3,
      left: 2,
      content: 'Password:'
    });

    const passInput = blessed.textbox({
      parent: form,
      top: 3,
      left: 12,
      width: 30,
      height: 1,
      censor: true,
      inputOnFocus: true,
      style: {
        fg: 'white',
        bg: 'black',
        focus: { bg: 'blue' }
      }
    });

    const submitBtn = blessed.button({
      parent: form,
      top: 6,
      left: 'center',
      width: 12,
      height: 1,
      content: ' Login ',
      style: {
        fg: 'white',
        bg: 'blue',
        focus: { bg: 'cyan' }
      }
    });

    screen.append(form);
    userInput.focus();

    userInput.key('enter', () => passInput.focus());
    passInput.key('enter', () => {
      form.submit();
    });
    submitBtn.on('press', () => form.submit());

    form.on('submit', () => {
      const user = userInput.getValue().trim();
      const password = passInput.getValue();
      form.destroy();
      screen.render();
      resolve({ user, password });
    });

    screen.key(['C-c'], () => {
      process.exit(0);
    });

    screen.render();
  });
}

/**
 * Main entry point
 */
export async function start() {
  const args = parseArgs(process.argv.slice(2));

  if (args.showHelp) {
    showHelp();
    process.exit(0);
  }

  // Initialize screen
  initScreen();

  // Check for credentials from args or environment
  let credentials = null;
  if (args.user && args.password) {
    credentials = { user: args.user, password: args.password };
  } else if (args.password) {
    credentials = { user: 'default', password: args.password };
  }

  // Prompt for login if no credentials
  if (!credentials) {
    credentials = await showLoginPrompt();
  }

  state.set('credentials', credentials);

  if (args.timeRange) {
    state.set('timeRange', args.timeRange);
  }
  if (args.hostFilter) {
    state.set('hostFilter', args.hostFilter);
  }

  // Test connection
  state.set('loading', true);
  screen.render();

  const connected = await testConnection();
  if (!connected) {
    showError('Failed to connect to ClickHouse. Check credentials.');
    setTimeout(() => process.exit(1), 3000);
    return;
  }

  // Set initial query timestamp
  state.set('queryTimestamp', new Date());

  // Load dashboard
  await loadDashboard();
  breakdownList.focus();

  // Auto-refresh based on time range
  const setupAutoRefresh = () => {
    if (refreshInterval) clearInterval(refreshInterval);
    const timeRange = state.get('timeRange');
    const intervalMs = TIME_RANGES[timeRange].cacheTtl * 1000;
    refreshInterval = setInterval(() => {
      state.set('queryTimestamp', new Date());
      loadDashboard();
    }, intervalMs);
  };

  state.on('change:timeRange', setupAutoRefresh);
  setupAutoRefresh();

  screen.render();
}
