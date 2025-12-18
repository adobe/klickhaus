// Main entry point - CDN Analytics Dashboard
import { state, togglePinnedColumn } from './state.js';
import { setForceRefresh } from './api.js';
import { setElements, handleLogin, handleLogout, showDashboard, showLogin } from './auth.js';
import { loadStateFromURL, saveStateToURL, syncUIFromState, setUrlStateElements } from './url-state.js';
import { queryTimestamp, setQueryTimestamp } from './time.js';
import { startQueryTimer, stopQueryTimer, hasVisibleUpdatingFacets, initFacetObservers } from './timer.js';
import { loadTimeSeries, setupChartNavigation } from './chart.js';
import { loadAllBreakdowns, loadBreakdown, allBreakdowns, markSlowestFacet, resetFacetTimings } from './breakdowns/index.js';
import { getNextTopN } from './breakdowns/render.js';
import { addFilter, removeFilter, removeFilterByValue, clearFiltersForColumn, setFilterCallbacks } from './filters.js';
import { loadLogs, toggleLogsView, setLogsElements } from './logs.js';
import { loadHostAutocomplete } from './autocomplete.js';
import { initModal, closeQuickLinksModal } from './modal.js';
import { getTimeFilter, getHostFilter } from './time.js';

// DOM Elements
const elements = {
  loginSection: document.getElementById('login'),
  dashboardSection: document.getElementById('dashboard'),
  loginForm: document.getElementById('loginForm'),
  loginError: document.getElementById('loginError'),
  timeRangeSelect: document.getElementById('timeRange'),
  topNSelect: document.getElementById('topN'),
  hostFilterInput: document.getElementById('hostFilter'),
  refreshBtn: document.getElementById('refreshBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  logsBtn: document.getElementById('logsBtn'),
  logsView: document.getElementById('logsView'),
  dashboardContent: document.getElementById('dashboardContent'),
};

// Pass elements to modules that need them
setElements(elements);
setUrlStateElements(elements);
setLogsElements(elements.logsView, elements.logsBtn, elements.dashboardContent);

// Set up filter callbacks to avoid circular dependencies
setFilterCallbacks(saveStateToURL, loadDashboard);

// Load Dashboard Data
async function loadDashboard(refresh = false) {
  setForceRefresh(refresh);
  // Only set new timestamp if not already set from URL or if refreshing
  if (!queryTimestamp || refresh) {
    setQueryTimestamp(new Date());
  }
  saveStateToURL();
  startQueryTimer();
  resetFacetTimings();

  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();

  // Prioritize based on which view is active
  if (state.showLogs) {
    // Logs view is active - load logs first, then dashboard
    await loadLogs();
    loadDashboardQueries(timeFilter, hostFilter);
  } else {
    // Dashboard view is active - load dashboard first, then logs
    await loadDashboardQueries(timeFilter, hostFilter);
    loadLogs();
  }

  setForceRefresh(false);
}

// Load dashboard queries (chart and facets)
async function loadDashboardQueries(timeFilter, hostFilter) {
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
}

// Increase topN and reload breakdowns
function increaseTopN() {
  const next = getNextTopN();
  if (next) {
    state.topN = next;
    elements.topNSelect.value = next;
    saveStateToURL();
    loadAllBreakdowns();
  }
}

// Initialize
async function init() {
  // Load state from URL first
  loadStateFromURL();

  // Initialize facet observers
  initFacetObservers();

  // Initialize modal
  initModal();

  // Set up chart navigation
  setupChartNavigation(() => loadDashboard());

  // Check for stored credentials - show dashboard immediately if they exist
  const stored = localStorage.getItem('clickhouse_credentials');
  if (stored) {
    try {
      const creds = JSON.parse(stored);
      // Basic validation: must have user and password
      if (creds && creds.user && creds.password) {
        state.credentials = creds;
        syncUIFromState();
        showDashboard();
        // Start loading dashboard - auth errors will be handled by query()
        loadDashboard();
      }
    } catch (err) {
      // Invalid JSON in localStorage, clear it
      localStorage.removeItem('clickhouse_credentials');
      console.log('Invalid credentials in localStorage');
    }
  }

  // Event listeners
  elements.loginForm.addEventListener('submit', handleLogin);
  elements.logoutBtn.addEventListener('click', handleLogout);
  elements.refreshBtn.addEventListener('click', () => loadDashboard(true));
  elements.timeRangeSelect.addEventListener('change', (e) => {
    state.timeRange = e.target.value;
    // Reset timestamp when changing time range to show most recent window
    setQueryTimestamp(new Date());
    saveStateToURL();
    loadDashboard();
  });

  elements.topNSelect.addEventListener('change', (e) => {
    state.topN = parseInt(e.target.value);
    saveStateToURL();
    loadAllBreakdowns();
  });

  let filterTimeout;
  elements.hostFilterInput.addEventListener('input', (e) => {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
      state.hostFilter = e.target.value;
      saveStateToURL();
      loadDashboard();
    }, 500);
  });

  elements.logsBtn.addEventListener('click', () => toggleLogsView(saveStateToURL));

  // Listen for login success event from auth.js
  window.addEventListener('login-success', () => {
    syncUIFromState();
    showDashboard();
    loadDashboard();
  });
}

// Expose functions needed by onclick handlers in HTML
window.removeFilter = removeFilter;
window.addFilter = addFilter;
window.removeFilterByValue = removeFilterByValue;
window.clearFiltersForColumn = clearFiltersForColumn;
window.togglePinnedColumn = togglePinnedColumn;
window.increaseTopN = increaseTopN;
window.closeQuickLinksModal = closeQuickLinksModal;

// Load host autocomplete when dashboard is shown
window.addEventListener('dashboard-shown', () => {
  setTimeout(loadHostAutocomplete, 100);
});

// Start
init();
