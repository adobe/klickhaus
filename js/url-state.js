// URL state management
import { state, loadFacetPrefs } from './state.js';
import {
  queryTimestamp,
  setQueryTimestamp,
  customTimeRange,
  setCustomTimeRange,
  clearCustomTimeRange,
} from './time.js';
import { renderActiveFilters } from './filters.js';
import { invalidateInvestigationCache } from './anomaly-investigation.js';
import { DEFAULT_TIME_RANGE, DEFAULT_TOP_N, TIME_RANGES, TOP_N_OPTIONS } from './constants.js';

// DOM elements (set by main.js)
let elements = {};

// Track last saved URL to detect real changes
let lastSavedURL = null;

// Callback to reload dashboard (set by main.js)
let onStateRestored = null;

export function setOnStateRestored(callback) {
  onStateRestored = callback;
}

export function setUrlStateElements(els) {
  elements = els;
}

export function saveStateToURL(newAnomalyId = undefined) {
  const params = new URLSearchParams();

  if (state.timeRange !== DEFAULT_TIME_RANGE) params.set('t', state.timeRange);
  if (state.hostFilter) params.set('host', state.hostFilter);
  if (state.topN !== DEFAULT_TOP_N) params.set('n', state.topN);
  if (state.showLogs) params.set('view', 'logs');
  if (state.title) params.set('title', state.title);
  if (state.contentTypeMode !== 'count') params.set('ctm', state.contentTypeMode);

  // Save custom time range or query timestamp
  if (customTimeRange) {
    // Custom zoom range: save both start and end
    params.set('ts', customTimeRange.start.toISOString());
    params.set('te', customTimeRange.end.toISOString());
  } else if (queryTimestamp) {
    // Standard mode: just the reference timestamp
    params.set('ts', queryTimestamp.toISOString());
  }

  // Encode filters as JSON array
  if (state.filters.length > 0) {
    params.set('filters', JSON.stringify(state.filters));
  }

  // Handle anomaly focus:
  // - If newAnomalyId is explicitly passed, use it (or null to clear)
  // - If undefined, preserve current anomaly from URL
  if (newAnomalyId !== undefined) {
    if (newAnomalyId) {
      params.set('anomaly', newAnomalyId);
    }
    // else: explicitly cleared, don't set
  } else {
    // Preserve current anomaly if set
    const currentAnomaly = new URLSearchParams(window.location.search).get('anomaly');
    if (currentAnomaly) {
      params.set('anomaly', currentAnomaly);
    }
  }

  // Save pinned and hidden facets to URL
  if (state.pinnedFacets.length > 0) {
    params.set('pf', state.pinnedFacets.join(','));
  }
  if (state.hiddenFacets.length > 0) {
    params.set('hf', state.hiddenFacets.join(','));
  }

  // Note: pinned columns are NOT auto-saved to URL
  // They can be manually added as ?pinned=col1,col2 for temporary override

  const newURL = params.toString() ? `${window.location.pathname}?${params}` : window.location.pathname;

  // Only create history entry if URL actually changed
  if (newURL !== lastSavedURL) {
    // Use pushState for real navigation changes, creating browser history
    if (lastSavedURL === null) {
      // First save - replace initial state without creating history
      window.history.replaceState({}, '', newURL);
    } else {
      // Subsequent saves - create history entry for back button
      window.history.pushState({}, '', newURL);
    }
    lastSavedURL = newURL;
  }
}

export function loadStateFromURL() {
  const params = new URLSearchParams(window.location.search);

  if (params.has('t')) {
    const t = params.get('t');
    if (TIME_RANGES[t]) {
      state.timeRange = t;
    }
  }

  if (params.has('host')) {
    state.hostFilter = params.get('host');
  }

  if (params.has('n')) {
    const n = parseInt(params.get('n'));
    if (TOP_N_OPTIONS.includes(n)) {
      state.topN = n;
    }
  }

  if (params.has('view') && params.get('view') === 'logs') {
    state.showLogs = true;
  }

  if (params.has('ts')) {
    const ts = new Date(params.get('ts'));
    if (!Number.isNaN(ts.getTime())) {
      // Check if this is a custom time range (has both ts and te)
      if (params.has('te')) {
        const te = new Date(params.get('te'));
        if (!Number.isNaN(te.getTime())) {
          setCustomTimeRange(ts, te);
        }
      } else {
        // Standard mode: just set the reference timestamp
        setQueryTimestamp(ts);
      }
    }
  }

  if (params.has('filters')) {
    try {
      const filters = JSON.parse(params.get('filters'));
      if (Array.isArray(filters)) {
        // Preserve filterCol and filterValue if present (for ASN integer filtering)
        state.filters = filters
          .filter((f) => f.col && typeof f.value === 'string' && typeof f.exclude === 'boolean')
          .map((f) => {
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

  if (params.has('pinned')) {
    const pinned = params
      .get('pinned')
      .split(',')
      .filter((c) => c);
    if (pinned.length > 0) {
      // Override state temporarily without persisting to localStorage
      state.pinnedColumns = pinned;
    }
  }

  // Hide UI controls (comma-separated: timeRange,topN,host,refresh,logout,logs)
  if (params.has('hide')) {
    state.hiddenControls = params
      .get('hide')
      .split(',')
      .filter((c) => c);
  }

  // Custom title from URL
  if (params.has('title')) {
    state.title = params.get('title');
  }

  // Content-type facet mode (count or bytes)
  if (params.has('ctm')) {
    const ctm = params.get('ctm');
    if (['count', 'bytes'].includes(ctm)) {
      state.contentTypeMode = ctm;
    }
  }

  // Load facet preferences from localStorage (keyed by title)
  loadFacetPrefs();

  // Override with URL params if present
  if (params.has('pf')) {
    state.pinnedFacets = params
      .get('pf')
      .split(',')
      .filter((f) => f);
  }
  if (params.has('hf')) {
    state.hiddenFacets = params
      .get('hf')
      .split(',')
      .filter((f) => f);
  }
}

export function syncUIFromState() {
  // Show "Custom" in dropdown when in custom time range, otherwise show predefined
  if (customTimeRange) {
    elements.timeRangeSelect.value = 'custom';
  } else {
    elements.timeRangeSelect.value = state.timeRange;
  }
  elements.topNSelect.value = state.topN;
  elements.hostFilterInput.value = state.hostFilter;
  renderActiveFilters();

  // Update title if custom title is set
  const titleEl = document.getElementById('dashboardTitle');
  if (state.title) {
    titleEl.textContent = state.title;
    document.title = `${state.title} - CDN Analytics`;
  } else {
    titleEl.textContent = 'CDN Analytics';
    document.title = 'CDN Analytics';
  }

  if (state.showLogs) {
    elements.logsView.classList.add('visible');
    elements.dashboardContent.classList.add('hidden');
    elements.logsBtn.classList.add('active');
    elements.logsBtn.textContent = 'Filters';
  }

  // Apply hidden controls from URL
  if (state.hiddenControls.includes('timeRange')) {
    elements.timeRangeSelect.style.display = 'none';
  }
  if (state.hiddenControls.includes('topN')) {
    elements.topNSelect.style.display = 'none';
  }
  if (state.hiddenControls.includes('host')) {
    elements.hostFilterInput.style.display = 'none';
  }
  if (state.hiddenControls.includes('refresh')) {
    elements.refreshBtn.style.display = 'none';
  }
  if (state.hiddenControls.includes('logout')) {
    elements.logoutBtn.style.display = 'none';
  }
  if (state.hiddenControls.includes('logs')) {
    elements.logsBtn.style.display = 'none';
  }
}

// Handle browser back/forward navigation
window.addEventListener('popstate', () => {
  // Update lastSavedURL to current location to prevent pushState on reload
  lastSavedURL = window.location.pathname + window.location.search;
  if (lastSavedURL === window.location.pathname) {
    lastSavedURL = window.location.pathname;
  }

  // Clear custom time range before loading (will be restored if in URL)
  clearCustomTimeRange();

  // Clear investigation cache - anomalies will be re-detected for new time range
  invalidateInvestigationCache();

  // Reload state from the new URL
  loadStateFromURL();
  syncUIFromState();

  // Trigger dashboard reload if callback is set
  if (onStateRestored) {
    onStateRestored();
  }
});
