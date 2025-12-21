/**
 * TUI State Management
 */

import EventEmitter from 'events';

class State extends EventEmitter {
  constructor() {
    super();
    this._state = {
      credentials: null,
      timeRange: '1h',
      hostFilter: '',
      topN: 10,
      filters: [],
      currentView: 'dashboard', // dashboard, logs, breakdown
      selectedBreakdown: 0,
      chartData: null,
      breakdownData: {},
      logsData: null,
      loading: false,
      error: null,
      queryTimestamp: null,
      selectedLogIndex: 0,
      logsOffset: 0,
      logsLimit: 100
    };
  }

  get(key) {
    return this._state[key];
  }

  set(key, value) {
    const oldValue = this._state[key];
    this._state[key] = value;
    if (oldValue !== value) {
      this.emit('change', key, value, oldValue);
      this.emit(`change:${key}`, value, oldValue);
    }
  }

  update(updates) {
    for (const [key, value] of Object.entries(updates)) {
      this.set(key, value);
    }
  }

  getState() {
    return { ...this._state };
  }

  // Filter management
  addFilter(col, value, exclude = false) {
    const filters = [...this._state.filters];
    // Remove existing filter for same col+value
    const idx = filters.findIndex(f => f.col === col && f.value === value);
    if (idx !== -1) {
      filters.splice(idx, 1);
    }
    filters.push({ col, value, exclude });
    this.set('filters', filters);
  }

  removeFilter(index) {
    const filters = [...this._state.filters];
    filters.splice(index, 1);
    this.set('filters', filters);
  }

  clearFilters() {
    this.set('filters', []);
  }

  clearFiltersForColumn(col) {
    const filters = this._state.filters.filter(f => f.col !== col);
    this.set('filters', filters);
  }
}

export const state = new State();
