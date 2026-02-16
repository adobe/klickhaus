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
import {
  state, togglePinnedColumn, togglePinnedFacet, toggleHiddenFacet, setOnFacetOrderChange,
} from './state.js';
import { setForceRefresh } from './api.js';
import {
  setElements, handleLogin, handleLogout, showDashboard, loadStoredCredentials,
} from './auth.js';
import {
  loadStateFromURL, saveStateToURL, syncUIFromState, setUrlStateElements,
  setOnStateRestored, setOnBeforeRestore,
} from './url-state.js';
import {
  queryTimestamp, setQueryTimestamp, clearCustomTimeRange, isCustomTimeRange,
  getTimeFilter, getHostFilter, getSamplingConfig,
} from './time.js';
import {
  startQueryTimer, stopQueryTimer, hasVisibleUpdatingFacets, initFacetObservers,
} from './timer.js';
import {
  loadTimeSeries, setupChartNavigation, getDetectedAnomalies, getLastChartData,
  renderChart, setOnChartHoverTimestamp, setOnChartClickTimestamp, setOnChartDataReady,
} from './chart.js';
import {
  loadAllBreakdowns,
  loadAllBreakdownsRefined,
  loadBreakdown,
  getBreakdowns,
  markSlowestFacet,
  resetFacetTimings,
} from './breakdowns/index.js';
import { getNextTopN } from './breakdowns/render.js';
import {
  addFilter, removeFilter, removeFilterByValue, clearFiltersForColumn, setFilterCallbacks,
  getFilterForValue,
} from './filters.js';
import {
  loadLogs, toggleLogsView, setLogsElements, setOnShowFiltersView, scrollLogsToTimestamp,
  tryRenderBucketTable,
} from './logs.js';
import { loadHostAutocomplete } from './autocomplete.js';
import { initModal, closeQuickLinksModal } from './modal.js';
import {
  initKeyboardNavigation, restoreKeyboardFocus, initScrollTracking, getFocusedFacetId,
} from './keyboard.js';
import { initFacetPalette } from './facet-palette.js';
import { initFacetSearch, openFacetSearch } from './ui/facet-search.js';
import { copyFacetAsTsv } from './copy-facet.js';
import {
  investigateAnomalies, reapplyHighlightsIfCached,
  hasCachedInvestigation, invalidateInvestigationCache,
} from './anomaly-investigation.js';
import { populateTimeRangeSelect, populateTopNSelect, updateTimeRangeLabels } from './ui/selects.js';
import {
  initHostFilterDoubleTap, initMobileTouchSupport, initPullToRefresh, initMobileFiltersPosition,
} from './ui/mobile.js';
import { initActionHandlers } from './ui/actions.js';
import { preloadAllTemplates } from './sql-loader.js';
import { startRequestContext, isRequestCurrent } from './request-context.js';

/**
 * Initialize a dashboard instance.
 * @param {Object} [config] - Optional dashboard configuration
 * @param {string} [config.title] - Default title (e.g., 'Delivery')
 * @param {string} [config.additionalWhereClause] - Extra SQL WHERE clause for all queries
 * @param {string[]} [config.defaultHiddenFacets] - Facet IDs to hide by default
 */
export function initDashboard(config = {}) {
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
    viewToggleBtn: document.getElementById('viewToggleBtn'),
    logsView: document.getElementById('logsView'),
    filtersView: document.getElementById('filtersView'),
    dashboardContent: document.getElementById('dashboardContent'),
  };

  // Pass elements to modules that need them
  setElements(elements);
  setUrlStateElements(elements);
  setLogsElements(elements.logsView, elements.viewToggleBtn, elements.filtersView);

  // Load dashboard queries (chart and facets)
  async function loadDashboardQueries(timeFilter, hostFilter, dashboardContext, facetsContext) {
    const timeSeriesPromise = loadTimeSeries(dashboardContext);
    const focusedFacetId = getFocusedFacetId();
    const isDashboardCurrent = () => isRequestCurrent(
      dashboardContext.requestId,
      dashboardContext.scope,
    );
    const isFacetsCurrent = () => isRequestCurrent(facetsContext.requestId, facetsContext.scope);

    const facetPromises = getBreakdowns().map(
      (b) => loadBreakdown(b, timeFilter, hostFilter, facetsContext).then(() => {
        if (!isFacetsCurrent()) return;
        if (!hasVisibleUpdatingFacets()) {
          stopQueryTimer();
        }
        if (focusedFacetId === b.id) {
          restoreKeyboardFocus();
        }
        reapplyHighlightsIfCached();
      }),
    );

    await timeSeriesPromise;

    if (!isDashboardCurrent()) return;

    if (!hasVisibleUpdatingFacets()) {
      stopQueryTimer();
    }

    const anomalies = getDetectedAnomalies();
    const chartData = getLastChartData();

    if (anomalies.length > 0 && chartData) {
      const hasCache = hasCachedInvestigation();

      if (hasCache) {
        investigateAnomalies(anomalies, chartData);
        Promise.all(facetPromises).then(() => {
          if (isFacetsCurrent()) markSlowestFacet();
        });
      } else {
        await Promise.all(facetPromises);
        if (!isFacetsCurrent()) return;
        markSlowestFacet();
        await investigateAnomalies(anomalies, chartData);
      }
    } else {
      Promise.all(facetPromises).then(() => {
        if (isFacetsCurrent()) markSlowestFacet();
      });
    }

    // Schedule refinement pass if initial load used sampling
    const { multiplier } = getSamplingConfig();
    if (multiplier > 1) {
      const refinedSampling = { sampleClause: '', multiplier: 1 };
      const refinementDashCtx = startRequestContext('dashboard');
      const refinementFacetsCtx = startRequestContext('facets');
      loadTimeSeries(refinementDashCtx, refinedSampling);
      loadAllBreakdownsRefined(refinementFacetsCtx);
    }
  }

  // Update keyboard hint for time range to show next option number
  function updateTimeRangeHint() {
    const hint = document.getElementById('timeRangeHint');
    const select = document.getElementById('timeRange');
    if (!hint || !select) return;

    const nextIndex = (select.selectedIndex + 1) % select.options.length;
    hint.textContent = nextIndex + 1;
  }

  // Load Dashboard Data
  async function loadDashboard(refresh = false) {
    const dashboardContext = startRequestContext('dashboard');
    const facetsContext = startRequestContext('facets');
    setForceRefresh(refresh);
    if (refresh) {
      invalidateInvestigationCache();
    }
    if (!queryTimestamp() || refresh) {
      setQueryTimestamp(new Date());
    }
    saveStateToURL();

    // Sync time range dropdown with current state (custom zoom vs preset)
    if (isCustomTimeRange()) {
      elements.timeRangeSelect.value = 'custom';
    } else {
      elements.timeRangeSelect.value = state.timeRange;
    }
    updateTimeRangeHint();

    startQueryTimer();
    resetFacetTimings();

    const timeFilter = getTimeFilter();
    const hostFilter = getHostFilter();

    if (state.showLogs) {
      await loadLogs(dashboardContext);
      loadDashboardQueries(timeFilter, hostFilter, dashboardContext, facetsContext);
    } else {
      await loadDashboardQueries(timeFilter, hostFilter, dashboardContext, facetsContext);
      loadLogs(dashboardContext);
    }

    setForceRefresh(false);
  }

  // Set up callback to redraw chart when switching from logs to filters view
  setOnShowFiltersView(() => {
    if (state.chartData) {
      renderChart(state.chartData);
    }
  });

  // When chart data arrives, try rendering the bucket table (fixes race condition
  // where logs view shows "Loading..." because chart data wasn't available yet)
  setOnChartDataReady(() => tryRenderBucketTable());

  // Chart→Scroll sync: throttled to avoid excessive scrolling
  let lastHoverScroll = 0;
  setOnChartHoverTimestamp((timestamp) => {
    const now = Date.now();
    if (now - lastHoverScroll < 300) return;
    lastHoverScroll = now;
    scrollLogsToTimestamp(timestamp);
  });

  // Chart click → open logs at clicked timestamp
  setOnChartClickTimestamp((timestamp) => {
    if (!state.showLogs) {
      toggleLogsView(saveStateToURL, timestamp);
    } else {
      scrollLogsToTimestamp(timestamp);
    }
  });

  setFilterCallbacks(saveStateToURL, loadDashboard);
  setOnBeforeRestore(() => invalidateInvestigationCache());
  setOnStateRestored(loadDashboard);

  // Move facets between pinned/normal/hidden sections based on state
  function reorderFacets(toggledFacetId = null) {
    const pinnedSection = document.getElementById('breakdowns-pinned');
    const normalSection = document.getElementById('breakdowns');
    const hiddenSection = document.getElementById('breakdowns-hidden');

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

    if (toggledFacetId) {
      const breakdown = getBreakdowns().find((b) => b.id === toggledFacetId);
      if (breakdown) {
        const timeFilter = getTimeFilter();
        const hostFilter = getHostFilter();
        const facetsContext = startRequestContext(`facet:${breakdown.id}`);
        loadBreakdown(breakdown, timeFilter, hostFilter, facetsContext);
      }
    }
  }

  setOnFacetOrderChange(reorderFacets);

  function increaseTopN() {
    const next = getNextTopN();
    if (next) {
      state.topN = next;
      elements.topNSelect.value = next;
      saveStateToURL();
      const facetsContext = startRequestContext('facets');
      loadAllBreakdowns(facetsContext);
    }
  }

  function toggleFacetMode(stateKey) {
    state[stateKey] = state[stateKey] === 'count' ? 'bytes' : 'count';
    saveStateToURL();

    const timeFilter = getTimeFilter();
    const hostFilter = getHostFilter();
    const breakdowns = getBreakdowns().filter((b) => b.modeToggle === stateKey);
    for (const breakdown of breakdowns) {
      const facetsContext = startRequestContext(`facet:${breakdown.id}`);
      loadBreakdown(breakdown, timeFilter, hostFilter, facetsContext);
    }
  }

  // Initialize
  async function init() {
    loadStateFromURL();

    // Apply dashboard-specific configuration
    if (config.title && !state.title) {
      state.title = config.title;
    }
    if (config.additionalWhereClause !== undefined) {
      state.additionalWhereClause = config.additionalWhereClause;
    }
    if (config.tableName) {
      state.tableName = config.tableName;
    }
    if (config.timeSeriesTemplate) {
      state.timeSeriesTemplate = config.timeSeriesTemplate;
    }
    if (config.aggregations) {
      state.aggregations = config.aggregations;
    }
    if (config.hostFilterColumn !== undefined) {
      state.hostFilterColumn = config.hostFilterColumn;
    }
    if (config.breakdowns) {
      state.breakdowns = config.breakdowns;
    }
    if (config.defaultHiddenFacets) {
      const hasCustomPrefs = localStorage.getItem(`facetPrefs_${state.title || ''}`);
      if (!hasCustomPrefs) {
        state.hiddenFacets = [...config.defaultHiddenFacets];
      }
    }

    populateTimeRangeSelect(elements.timeRangeSelect);
    populateTopNSelect(elements.topNSelect);

    initFacetObservers();
    initModal();

    initKeyboardNavigation({ toggleFacetMode, reloadDashboard: loadDashboard });
    initFacetPalette();
    initFacetSearch({ addFilter, loadDashboard });
    initScrollTracking();

    setupChartNavigation(() => loadDashboard());

    initActionHandlers({
      togglePinnedColumn,
      addFilter,
      removeFilter,
      removeFilterByValue,
      getFilterForValue,
      clearFiltersForColumn,
      increaseTopN,
      toggleFacetPin: togglePinnedFacet,
      toggleFacetHide: toggleHiddenFacet,
      toggleFacetMode,
      closeQuickLinksModal,
      closeDialog: (el) => el.closest('dialog')?.close(),
      openFacetSearch,
      copyFacetTsv: copyFacetAsTsv,
    });

    const storedCredentials = loadStoredCredentials();
    if (storedCredentials) {
      state.credentials = storedCredentials;
      preloadAllTemplates();
      syncUIFromState();
      reorderFacets();
      showDashboard();
      updateTimeRangeHint();
      loadDashboard();
    }

    elements.loginForm.addEventListener('submit', handleLogin);
    elements.logoutBtn.addEventListener('click', handleLogout);
    elements.refreshBtn.addEventListener('click', () => {
      saveStateToURL(null);
      loadDashboard(true);
    });
    elements.timeRangeSelect.addEventListener('change', (e) => {
      state.timeRange = e.target.value;
      setQueryTimestamp(new Date());
      clearCustomTimeRange();
      saveStateToURL();
      loadDashboard();
      updateTimeRangeHint();
    });

    updateTimeRangeHint();

    elements.topNSelect.addEventListener('change', (e) => {
      state.topN = parseInt(e.target.value, 10);
      document.body.dataset.topn = state.topN;
      saveStateToURL();
      const facetsContext = startRequestContext('facets');
      loadAllBreakdowns(facetsContext);
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

    let hostFilterOriginalValue = '';
    elements.hostFilterInput.addEventListener('focus', () => {
      hostFilterOriginalValue = elements.hostFilterInput.value;
    });

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

    elements.viewToggleBtn.addEventListener('click', () => toggleLogsView(saveStateToURL));

    window.addEventListener('login-success', () => {
      try {
        preloadAllTemplates();
        syncUIFromState();
        reorderFacets();
        showDashboard();
        updateTimeRangeHint();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Error during login-success setup:', err);
        showDashboard();
      }
      loadDashboard();
    });
  }

  window.addEventListener('dashboard-shown', () => {
    setTimeout(loadHostAutocomplete, 100);
  });

  init();
  initHostFilterDoubleTap(elements.hostFilterInput);
  initMobileTouchSupport();
  initPullToRefresh(() => loadDashboard(true));
  initMobileFiltersPosition();

  updateTimeRangeLabels(elements.timeRangeSelect);
  window.addEventListener('resize', () => updateTimeRangeLabels(elements.timeRangeSelect));

  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const lastData = getLastChartData();
      if (lastData) {
        renderChart(lastData);
      }
    }, 100);
  });

  window.toggleLogsViewMobile = () => toggleLogsView(saveStateToURL);
}
