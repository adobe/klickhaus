// URL state management
import { state } from './state.js';
import { queryTimestamp, setQueryTimestamp } from './time.js';
import { renderActiveFilters } from './filters.js';

// DOM elements (set by main.js)
let elements = {};

export function setUrlStateElements(els) {
  elements = els;
}

export function saveStateToURL() {
  const params = new URLSearchParams();

  if (state.timeRange !== '1h') params.set('t', state.timeRange);
  if (state.hostFilter) params.set('host', state.hostFilter);
  if (state.topN !== 5) params.set('n', state.topN);
  if (state.showLogs) params.set('view', 'logs');
  if (state.title) params.set('title', state.title);

  // Save query timestamp as ISO string
  if (queryTimestamp) {
    params.set('ts', queryTimestamp.toISOString());
  }

  // Encode filters as JSON array
  if (state.filters.length > 0) {
    params.set('filters', JSON.stringify(state.filters));
  }

  // Note: pinned columns are NOT auto-saved to URL
  // They can be manually added as ?pinned=col1,col2 for temporary override

  const newURL = params.toString()
    ? `${window.location.pathname}?${params}`
    : window.location.pathname;
  window.history.replaceState({}, '', newURL);
}

export function loadStateFromURL() {
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
      setQueryTimestamp(ts);
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

  if (params.has('pinned')) {
    const pinned = params.get('pinned').split(',').filter(c => c);
    if (pinned.length > 0) {
      // Override state temporarily without persisting to localStorage
      state.pinnedColumns = pinned;
    }
  }

  // Hide UI controls (comma-separated: timeRange,topN,host,refresh,logout,logs)
  if (params.has('hide')) {
    state.hiddenControls = params.get('hide').split(',').filter(c => c);
  }

  // Custom title from URL
  if (params.has('title')) {
    state.title = params.get('title');
  }
}

export function syncUIFromState() {
  elements.timeRangeSelect.value = state.timeRange;
  elements.topNSelect.value = state.topN;
  elements.hostFilterInput.value = state.hostFilter;
  renderActiveFilters();

  // Update title if custom title is set
  const titleEl = document.getElementById('dashboardTitle');
  if (state.title) {
    titleEl.textContent = state.title;
    document.title = state.title + ' - CDN Analytics';
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
