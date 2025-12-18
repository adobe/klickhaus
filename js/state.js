// Application state management

export const state = {
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
  hiddenControls: [],  // ['timeRange', 'topN', 'host', 'refresh', 'logout', 'logs']
  title: '',  // Custom title from URL
  chartData: null,  // Store chart data for redrawing when view changes
};

// Callback for re-rendering logs table when pinned columns change
// Set by logs.js to avoid circular dependencies
let onPinnedColumnsChange = null;

export function setOnPinnedColumnsChange(callback) {
  onPinnedColumnsChange = callback;
}

export function togglePinnedColumn(col) {
  const idx = state.pinnedColumns.indexOf(col);
  if (idx === -1) {
    state.pinnedColumns.push(col);
  } else {
    state.pinnedColumns.splice(idx, 1);
  }
  localStorage.setItem('pinnedColumns', JSON.stringify(state.pinnedColumns));
  if (onPinnedColumnsChange && state.logsData) {
    onPinnedColumnsChange(state.logsData);
  }
}
