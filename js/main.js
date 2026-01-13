// Main entry point - CDN Analytics Dashboard
import { state, togglePinnedColumn } from './state.js';
import { setForceRefresh } from './api.js';
import { setElements, handleLogin, handleLogout, showDashboard, showLogin } from './auth.js';
import { loadStateFromURL, saveStateToURL, syncUIFromState, setUrlStateElements } from './url-state.js';
import { queryTimestamp, setQueryTimestamp, clearCustomTimeRange, isCustomTimeRange } from './time.js';
import { startQueryTimer, stopQueryTimer, hasVisibleUpdatingFacets, initFacetObservers } from './timer.js';
import { loadTimeSeries, setupChartNavigation } from './chart.js';
import { loadAllBreakdowns, loadBreakdown, allBreakdowns, markSlowestFacet, resetFacetTimings } from './breakdowns/index.js';
import { getNextTopN } from './breakdowns/render.js';
import { addFilter, removeFilter, removeFilterByValue, clearFiltersForColumn, setFilterCallbacks } from './filters.js';
import { loadLogs, toggleLogsView, setLogsElements, setOnShowFiltersView } from './logs.js';
import { renderChart } from './chart.js';
import { loadHostAutocomplete } from './autocomplete.js';
import { initModal, closeQuickLinksModal } from './modal.js';
import { getTimeFilter, getHostFilter } from './time.js';
import { initKeyboardNavigation, restoreKeyboardFocus, initScrollTracking, getFocusedFacetId } from './keyboard.js';
import { initFacetPalette } from './facet-palette.js';

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
  const facetPromises = allBreakdowns.map(b =>
    loadBreakdown(b, timeFilter, hostFilter).then(() => {
      // After each facet completes, check if timer should stop
      if (!hasVisibleUpdatingFacets()) {
        stopQueryTimer();
      }
      // Restore keyboard focus immediately when the focused facet finishes
      if (focusedFacetId === b.id) {
        restoreKeyboardFocus();
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
  const breakdowns = allBreakdowns.filter(b => b.modeToggle === stateKey);
  for (const breakdown of breakdowns) {
    loadBreakdown(breakdown, timeFilter, hostFilter);
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

  // Initialize keyboard navigation and scroll tracking
  initKeyboardNavigation();
  initFacetPalette();
  initScrollTracking();

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
  elements.refreshBtn.addEventListener('click', () => loadDashboard(true));
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

// Expose functions needed by onclick handlers in HTML
window.removeFilter = removeFilter;
window.addFilter = addFilter;
window.removeFilterByValue = removeFilterByValue;
window.clearFiltersForColumn = clearFiltersForColumn;
window.togglePinnedColumn = togglePinnedColumn;
window.increaseTopN = increaseTopN;
window.closeQuickLinksModal = closeQuickLinksModal;
window.toggleLogsViewMobile = () => toggleLogsView(saveStateToURL);
window.toggleFacetMode = toggleFacetMode;
window.loadDashboard = loadDashboard;

// Load host autocomplete when dashboard is shown
window.addEventListener('dashboard-shown', () => {
  setTimeout(loadHostAutocomplete, 100);
});

// Double-tap to clear host filter on mobile
function initHostFilterDoubleTap() {
  if (!('ontouchstart' in window)) return;

  const hostFilter = document.getElementById('hostFilter');
  let lastTap = 0;

  hostFilter.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTap < 300 && now - lastTap > 0) {
      hostFilter.value = '';
      hostFilter.dispatchEvent(new Event('input'));
      lastTap = 0;
    } else {
      lastTap = now;
    }
  });
}

// Mobile touch support for breakdown rows
function initMobileTouchSupport() {
  // Only on touch devices
  if (!('ontouchstart' in window)) return;

  document.addEventListener('click', (e) => {
    const row = e.target.closest('.breakdown-table tr:not(.other-row)');
    const isActionBtn = e.target.closest('.mobile-action-btn');

    // If clicking an action button, clear touch-active after action fires
    if (isActionBtn) {
      setTimeout(() => {
        document.querySelectorAll('.breakdown-table tr.touch-active').forEach(r => {
          r.classList.remove('touch-active');
        });
      }, 100);
      return;
    }

    // If clicking a row, toggle touch-active on it
    if (row) {
      const wasActive = row.classList.contains('touch-active');
      // Clear all other touch-active states
      document.querySelectorAll('.breakdown-table tr.touch-active').forEach(r => {
        r.classList.remove('touch-active');
      });
      // Toggle on clicked row
      if (!wasActive) {
        row.classList.add('touch-active');
      }
      return;
    }

    // Clicking outside - clear all touch-active
    document.querySelectorAll('.breakdown-table tr.touch-active').forEach(r => {
      r.classList.remove('touch-active');
    });
  });
}

// Pull to refresh
function initPullToRefresh() {
  if (!('ontouchstart' in window)) return;

  // Create indicator element - insert before breakdowns
  const indicator = document.createElement('div');
  indicator.className = 'pull-to-refresh';
  indicator.innerHTML = '<span class="pull-arrow">↻</span><span class="pull-text">Pull to refresh</span>';
  const breakdowns = document.querySelector('.breakdowns');
  if (breakdowns) {
    breakdowns.parentNode.insertBefore(indicator, breakdowns);
  }

  let touchStartY = 0;
  let isPulling = false;
  const threshold = 80;

  document.addEventListener('touchstart', (e) => {
    if (window.scrollY === 0) {
      touchStartY = e.touches[0].clientY;
      isPulling = true;
    }
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!isPulling) return;
    const touchY = e.touches[0].clientY;
    const pullDistance = touchY - touchStartY;

    if (pullDistance > 0 && window.scrollY === 0) {
      indicator.classList.add('visible');
      indicator.querySelector('.pull-text').textContent =
        pullDistance > threshold ? 'Release to refresh' : 'Pull to refresh';
    } else {
      indicator.classList.remove('visible');
    }
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (!isPulling) return;
    const touchEndY = e.changedTouches[0].clientY;
    const pullDistance = touchEndY - touchStartY;

    if (pullDistance > threshold && window.scrollY === 0) {
      indicator.classList.add('refreshing');
      indicator.querySelector('.pull-text').textContent = 'Refreshing...';
      loadDashboard(true).then(() => {
        indicator.classList.remove('visible', 'refreshing');
      });
    } else {
      indicator.classList.remove('visible');
    }

    isPulling = false;
    touchStartY = 0;
  }, { passive: true });
}

// Move active filters to chart area on mobile
function initMobileFiltersPosition() {
  const activeFilters = document.getElementById('activeFilters');
  const chartSection = document.querySelector('.chart-section');
  const headerLeft = document.querySelector('.header-left');

  function updatePosition() {
    const isMobile = window.innerWidth < 600;
    if (isMobile && activeFilters.parentElement !== chartSection) {
      chartSection.appendChild(activeFilters);
    } else if (!isMobile && activeFilters.parentElement !== headerLeft) {
      headerLeft.appendChild(activeFilters);
    }
  }

  updatePosition();
  window.addEventListener('resize', updatePosition);
}

// Responsive time range labels
function initResponsiveLabels() {
  const timeRange = document.getElementById('timeRange');
  const fullLabels = {
    '15m': 'Last 15 minutes',
    '1h': 'Last hour',
    '12h': 'Last 12 hours',
    '24h': 'Last 24 hours',
    '7d': 'Last 7 days'
  };
  const shortLabels = {
    '15m': '15m',
    '1h': '1h',
    '12h': '12h',
    '24h': '24h',
    '7d': '7d'
  };

  function updateLabels() {
    const isMobile = window.innerWidth < 600;
    const labels = isMobile ? shortLabels : fullLabels;
    Array.from(timeRange.options).forEach(opt => {
      opt.textContent = labels[opt.value] || opt.value;
    });
  }

  updateLabels();
  window.addEventListener('resize', updateLabels);
}

// Start
init();
initHostFilterDoubleTap();
initMobileTouchSupport();
initPullToRefresh();
initResponsiveLabels();
initMobileFiltersPosition();
