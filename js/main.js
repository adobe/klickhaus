// Main entry point - CDN Analytics Dashboard
import { state, togglePinnedColumn, togglePinnedFacet, toggleHiddenFacet, setOnFacetOrderChange } from './state.js';
import { setForceRefresh } from './api.js';
import { setElements, handleLogin, handleLogout, showDashboard } from './auth.js';
import {
  loadStateFromURL,
  saveStateToURL,
  syncUIFromState,
  setUrlStateElements,
  setOnStateRestored,
} from './url-state.js';
import { queryTimestamp, setQueryTimestamp, clearCustomTimeRange, getTimeFilter, getHostFilter } from './time.js';
import { startQueryTimer, stopQueryTimer, hasVisibleUpdatingFacets, initFacetObservers } from './timer.js';
import { loadTimeSeries, setupChartNavigation, getDetectedAnomalies, getLastChartData, renderChart } from './chart.js';
import {
  loadAllBreakdowns,
  loadBreakdown,
  allBreakdowns,
  markSlowestFacet,
  resetFacetTimings,
} from './breakdowns/index.js';
import { getNextTopN } from './breakdowns/render.js';
import { addFilter, removeFilter, removeFilterByValue, clearFiltersForColumn, setFilterCallbacks } from './filters.js';
import { loadLogs, toggleLogsView, setLogsElements, setOnShowFiltersView } from './logs.js';
import { loadHostAutocomplete } from './autocomplete.js';
import { initModal, closeQuickLinksModal } from './modal.js';
import { initKeyboardNavigation, restoreKeyboardFocus, initScrollTracking, getFocusedFacetId } from './keyboard.js';
import { initFacetPalette } from './facet-palette.js';
import { investigateAnomalies, reapplyHighlightsIfCached, hasCachedInvestigation } from './anomaly-investigation.js';
import { populateTimeRangeSelect, populateTopNSelect, updateTimeRangeLabels } from './ui/selects.js';
import {
  initHostFilterDoubleTap,
  initMobileTouchSupport,
  initPullToRefresh,
  initMobileFiltersPosition,
} from './ui/mobile.js';
import { initActionHandlers } from './ui/actions.js';

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

// Set up callback to redraw chart when switching from logs to filters view
setOnShowFiltersView(() => {
  if (state.chartData) {
    renderChart(state.chartData);
  }
});

// Set up filter callbacks to avoid circular dependencies
setFilterCallbacks(saveStateToURL, loadDashboard);

// Set up callback for browser back/forward navigation
setOnStateRestored(loadDashboard);

// Move facets between pinned/normal/hidden sections based on state
// If toggledFacetId is provided, update that facet's display state
function reorderFacets(toggledFacetId = null) {
  const pinnedSection = document.getElementById('breakdowns-pinned');
  const normalSection = document.getElementById('breakdowns');
  const hiddenSection = document.getElementById('breakdowns-hidden');

  // Move each card to its appropriate section
  document.querySelectorAll('.breakdown-card').forEach((card) => {
    const { id } = card;
    const isPinned = state.pinnedFacets.includes(id);
    const isHidden = state.hiddenFacets.includes(id);

    if (isPinned && card.parentElement !== pinnedSection) {
      pinnedSection.appendChild(card);
    } else if (isHidden && card.parentElement !== hiddenSection) {
      hiddenSection.appendChild(card);
    } else if (!isPinned && !isHidden && card.parentElement !== normalSection) {
      normalSection.appendChild(card);
    }
  });

  saveStateToURL();

  // If a facet was toggled, call loadBreakdown to update its state
  // (handles both hiding and unhiding)
  if (toggledFacetId) {
    const breakdown = allBreakdowns.find((b) => b.id === toggledFacetId);
    if (breakdown) {
      const timeFilter = getTimeFilter();
      const hostFilter = getHostFilter();
      loadBreakdown(breakdown, timeFilter, hostFilter);
    }
  }
}

// Set up callback for facet order changes
setOnFacetOrderChange(reorderFacets);

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

  // Capture focused facet before loading starts
  const focusedFacetId = getFocusedFacetId();

  // Start loading all facets in parallel (they manage their own blur state)
  const facetPromises = allBreakdowns.map((b) =>
    loadBreakdown(b, timeFilter, hostFilter).then(() => {
      // After each facet completes, check if timer should stop
      if (!hasVisibleUpdatingFacets()) {
        stopQueryTimer();
      }
      // Restore keyboard focus immediately when the focused facet finishes
      if (focusedFacetId === b.id) {
        restoreKeyboardFocus();
      }
      // Re-apply cached highlights as each facet loads
      reapplyHighlightsIfCached();
    }),
  );

  // Wait for time series to complete first
  await timeSeriesPromise;

  // If no visible facets are updating after time series, stop timer
  if (!hasVisibleUpdatingFacets()) {
    stopQueryTimer();
  }

  // Check for anomalies to investigate
  const anomalies = getDetectedAnomalies();
  const chartData = getLastChartData();

  if (anomalies.length > 0 && chartData) {
    // Check if we have cached investigation (synchronous check)
    const hasCache = hasCachedInvestigation();

    if (hasCache) {
      // Cache available - apply highlights immediately, facets will re-apply as they load
      investigateAnomalies(anomalies, chartData);
      // Let facets complete independently
      Promise.all(facetPromises).then(() => markSlowestFacet());
    } else {
      // No cache - wait for ALL facets first to avoid connection competition
      await Promise.all(facetPromises);
      markSlowestFacet();
      // Now run investigation with full connection availability
      await investigateAnomalies(anomalies, chartData);
    }
  } else {
    // No anomalies, just wait for facets
    Promise.all(facetPromises).then(() => markSlowestFacet());
  }
}

// Update keyboard hint for time range to show next option number
function updateTimeRangeHint() {
  const hint = document.getElementById('timeRangeHint');
  const select = document.getElementById('timeRange');
  if (!hint || !select) return;

  // Show next option number (wraps to 1 if at last option)
  const nextIndex = (select.selectedIndex + 1) % select.options.length;
  hint.textContent = nextIndex + 1;
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

// Toggle facet aggregation mode (e.g., count vs bytes for content-types)
function toggleFacetMode(stateKey) {
  // Toggle between 'count' and 'bytes'
  state[stateKey] = state[stateKey] === 'count' ? 'bytes' : 'count';
  saveStateToURL();

  // Find and reload all breakdowns that use this mode toggle
  const timeFilter = getTimeFilter();
  const hostFilter = getHostFilter();
  const breakdowns = allBreakdowns.filter((b) => b.modeToggle === stateKey);
  for (const breakdown of breakdowns) {
    loadBreakdown(breakdown, timeFilter, hostFilter);
  }
}

// Initialize
async function init() {
  // Load state from URL first
  loadStateFromURL();

  // Populate select options from constants
  populateTimeRangeSelect(elements.timeRangeSelect);
  populateTopNSelect(elements.topNSelect);

  // Initialize facet observers
  initFacetObservers();

  // Initialize modal
  initModal();

  // Initialize keyboard navigation and scroll tracking
  initKeyboardNavigation({ toggleFacetMode, reloadDashboard: loadDashboard });
  initFacetPalette();
  initScrollTracking();

  // Set up chart navigation
  setupChartNavigation(() => loadDashboard());

  // Set up delegated action handlers (replaces inline onclick)
  initActionHandlers({
    togglePinnedColumn,
    addFilter,
    removeFilter,
    removeFilterByValue,
    clearFiltersForColumn,
    increaseTopN,
    toggleFacetPin: togglePinnedFacet,
    toggleFacetHide: toggleHiddenFacet,
    toggleFacetMode,
    closeQuickLinksModal,
    closeDialog: (el) => el.closest('dialog')?.close(),
  });

  // Check for stored credentials - show dashboard immediately if they exist
  const stored = localStorage.getItem('clickhouse_credentials');
  if (stored) {
    try {
      const creds = JSON.parse(stored);
      // Basic validation: must have user and password
      if (creds && creds.user && creds.password) {
        state.credentials = creds;
        syncUIFromState();
        reorderFacets();
        showDashboard();
        updateTimeRangeHint();
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
  elements.refreshBtn.addEventListener('click', () => {
    // Clear anomaly focus on refresh - user wants fresh data
    saveStateToURL(null);
    loadDashboard(true);
  });
  elements.timeRangeSelect.addEventListener('change', (e) => {
    state.timeRange = e.target.value;
    // Reset timestamp when changing time range to show most recent window
    setQueryTimestamp(new Date());
    // Clear any custom zoom range
    clearCustomTimeRange();
    saveStateToURL();
    loadDashboard();
    updateTimeRangeHint();
  });

  // Update time range keyboard hint to show next option
  updateTimeRangeHint();

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

  // Track original value for ESC reset
  let hostFilterOriginalValue = '';
  elements.hostFilterInput.addEventListener('focus', () => {
    hostFilterOriginalValue = elements.hostFilterInput.value;
  });

  // Enter applies filter and unfocuses, ESC resets and unfocuses
  elements.hostFilterInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(filterTimeout);
      state.hostFilter = e.target.value;
      saveStateToURL();
      loadDashboard();
      e.target.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      clearTimeout(filterTimeout);
      e.target.value = hostFilterOriginalValue;
      state.hostFilter = hostFilterOriginalValue;
      e.target.blur();
    }
  });

  elements.logsBtn.addEventListener('click', () => toggleLogsView(saveStateToURL));

  // Listen for login success event from auth.js
  window.addEventListener('login-success', () => {
    syncUIFromState();
    showDashboard();
    loadDashboard();
  });
}

// Load host autocomplete when dashboard is shown
window.addEventListener('dashboard-shown', () => {
  setTimeout(loadHostAutocomplete, 100);
});

// Start
init();
initHostFilterDoubleTap(elements.hostFilterInput);
initMobileTouchSupport();
initPullToRefresh(() => loadDashboard(true));
initMobileFiltersPosition();

// Responsive time range labels
updateTimeRangeLabels(elements.timeRangeSelect);
window.addEventListener('resize', () => updateTimeRangeLabels(elements.timeRangeSelect));

// Expose only for chart.js double-tap without inline handlers
window.toggleLogsViewMobile = () => toggleLogsView(saveStateToURL);
