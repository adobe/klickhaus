/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { assert } from 'chai';
import { state } from './state.js';
import {
  setFilterCallbacks,
  updateHeaderFixed,
  renderActiveFilters,
  getFiltersForColumn,
  getFilterForValue,
  clearFiltersForColumn,
  clearAllFilters,
  addFilter,
  removeFilter,
  removeFilterByValue,
} from './filters.js';

let saveUrlCalls = 0;
let loadDashCalls = 0;

function resetState() {
  state.filters = [];
  state.breakdowns = null;
  saveUrlCalls = 0;
  loadDashCalls = 0;
}

function setupDom() {
  document.body.innerHTML = '<div id="activeFilters"></div>';
  document.body.classList.remove('keyboard-mode', 'header-fixed');
}

function setupCallbacks() {
  setFilterCallbacks(
    () => { saveUrlCalls += 1; },
    () => { loadDashCalls += 1; },
  );
}

// Create a fake breakdown card with an h3 title, matching the pattern used by getFacetTitle
function createBreakdownCard(id, title) {
  const card = document.createElement('div');
  card.id = id;
  const h3 = document.createElement('h3');
  h3.textContent = title;
  card.appendChild(h3);
  document.body.appendChild(card);
  return card;
}

// Create a breakdown table row that updateRowFilterStyling can find and update
function createBreakdownRow(col, value, bgColor) {
  let card = document.querySelector('.breakdown-card');
  if (!card) {
    card = document.createElement('div');
    card.classList.add('breakdown-card');
    const table = document.createElement('table');
    table.classList.add('breakdown-table');
    card.appendChild(table);
    document.body.appendChild(card);
  }
  const table = card.querySelector('.breakdown-table');
  const tr = document.createElement('tr');
  tr.dataset.dim = value;
  const td = document.createElement('td');
  td.classList.add('dim');
  td.dataset.col = col;
  td.dataset.bgColor = bgColor || 'var(--text)';
  td.dataset.action = 'add-filter';
  td.dataset.exclude = 'false';
  tr.appendChild(td);
  // Add filter-tag-indicator with filter-icon inside
  const tag = document.createElement('span');
  tag.classList.add('filter-tag-indicator');
  const icon = document.createElement('span');
  icon.classList.add('filter-icon');
  tag.appendChild(icon);
  tr.appendChild(tag);
  table.appendChild(tr);
  return tr;
}

beforeEach(() => {
  resetState();
  setupDom();
  setupCallbacks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('setFilterCallbacks', () => {
  it('sets saveStateToURL and loadDashboard callbacks', () => {
    // Verify callbacks are wired by triggering clearAllFilters which calls them
    state.filters = [{ col: '`source`', value: 'fastly', exclude: false }];
    clearAllFilters();
    assert.strictEqual(saveUrlCalls, 1);
    assert.strictEqual(loadDashCalls, 1);
  });

  it('does not call callbacks when they are null', () => {
    setFilterCallbacks(null, null);
    state.filters = [{ col: '`source`', value: 'fastly', exclude: false }];
    clearAllFilters();
    // Should not throw and no callbacks called
    assert.strictEqual(saveUrlCalls, 0);
    assert.strictEqual(loadDashCalls, 0);
  });
});

describe('updateHeaderFixed', () => {
  it('adds header-fixed when keyboard-mode is active', () => {
    document.body.classList.add('keyboard-mode');
    updateHeaderFixed();
    assert.isTrue(document.body.classList.contains('header-fixed'));
  });

  it('adds header-fixed when 2+ filters exist', () => {
    state.filters = [
      { col: '`source`', value: 'fastly', exclude: false },
      { col: '`source`', value: 'cloudflare', exclude: false },
    ];
    updateHeaderFixed();
    assert.isTrue(document.body.classList.contains('header-fixed'));
  });

  it('removes header-fixed when no keyboard-mode and <2 filters', () => {
    document.body.classList.add('header-fixed');
    state.filters = [{ col: '`source`', value: 'fastly', exclude: false }];
    updateHeaderFixed();
    assert.isFalse(document.body.classList.contains('header-fixed'));
  });

  it('removes header-fixed when no filters and no keyboard-mode', () => {
    document.body.classList.add('header-fixed');
    updateHeaderFixed();
    assert.isFalse(document.body.classList.contains('header-fixed'));
  });
});

describe('renderActiveFilters', () => {
  it('clears container when no filters', () => {
    const container = document.getElementById('activeFilters');
    container.innerHTML = '<span>old</span>';
    renderActiveFilters();
    assert.strictEqual(container.innerHTML, '');
  });

  it('renders filter tags when filters exist', () => {
    // Create a breakdown card so getFacetTitle resolves
    createBreakdownCard('breakdown-source', 'Source');
    state.breakdowns = [{ id: 'breakdown-source', col: '`source`' }];
    state.filters = [{ col: '`source`', value: 'fastly', exclude: false }];
    renderActiveFilters();
    const container = document.getElementById('activeFilters');
    assert.include(container.innerHTML, 'fastly');
    assert.include(container.innerHTML, 'filter-tag');
  });

  it('renders exclude filter with NOT prefix', () => {
    createBreakdownCard('breakdown-source', 'Source');
    state.breakdowns = [{ id: 'breakdown-source', col: '`source`' }];
    state.filters = [{ col: '`source`', value: 'fastly', exclude: true }];
    renderActiveFilters();
    const container = document.getElementById('activeFilters');
    assert.include(container.innerHTML, 'NOT fastly');
  });

  it('renders empty-value filter with facet name prefixed by !', () => {
    createBreakdownCard('breakdown-source', 'Source');
    state.breakdowns = [{ id: 'breakdown-source', col: '`source`' }];
    state.filters = [{ col: '`source`', value: '', exclude: false }];
    renderActiveFilters();
    const container = document.getElementById('activeFilters');
    assert.include(container.innerHTML, '!Source');
  });

  it('renders empty-value exclude filter with NOT !facetName', () => {
    createBreakdownCard('breakdown-source', 'Source');
    state.breakdowns = [{ id: 'breakdown-source', col: '`source`' }];
    state.filters = [{ col: '`source`', value: '', exclude: true }];
    renderActiveFilters();
    const container = document.getElementById('activeFilters');
    assert.include(container.innerHTML, 'NOT !Source');
  });

  it('uses "Empty" when no breakdown card found', () => {
    state.filters = [{ col: 'unknown_col', value: '', exclude: false }];
    renderActiveFilters();
    const container = document.getElementById('activeFilters');
    assert.include(container.innerHTML, '!Empty');
  });

  it('calls updateHeaderFixed', () => {
    state.filters = [
      { col: '`source`', value: 'a', exclude: false },
      { col: '`source`', value: 'b', exclude: false },
    ];
    renderActiveFilters();
    assert.isTrue(document.body.classList.contains('header-fixed'));
  });
});

describe('getFiltersForColumn', () => {
  it('returns filters matching the column', () => {
    state.filters = [
      { col: '`source`', value: 'fastly', exclude: false },
      { col: '`request.url`', value: '/foo', exclude: false },
      { col: '`source`', value: 'cloudflare', exclude: true },
    ];
    const result = getFiltersForColumn('`source`');
    assert.lengthOf(result, 2);
    assert.strictEqual(result[0].value, 'fastly');
    assert.strictEqual(result[1].value, 'cloudflare');
  });

  it('returns empty array when no matches', () => {
    state.filters = [{ col: '`source`', value: 'fastly', exclude: false }];
    const result = getFiltersForColumn('`request.url`');
    assert.lengthOf(result, 0);
  });
});

describe('getFilterForValue', () => {
  it('finds a filter by col and value', () => {
    state.filters = [
      { col: '`source`', value: 'fastly', exclude: false },
      { col: '`source`', value: 'cloudflare', exclude: true },
    ];
    const result = getFilterForValue('`source`', 'cloudflare');
    assert.isNotNull(result);
    assert.isTrue(result.exclude);
  });

  it('returns undefined when not found', () => {
    state.filters = [{ col: '`source`', value: 'fastly', exclude: false }];
    const result = getFilterForValue('`source`', 'cloudflare');
    assert.isUndefined(result);
  });
});

describe('clearFiltersForColumn', () => {
  it('removes all filters for a given column', () => {
    state.filters = [
      { col: '`source`', value: 'fastly', exclude: false },
      { col: '`request.url`', value: '/foo', exclude: false },
      { col: '`source`', value: 'cloudflare', exclude: true },
    ];
    clearFiltersForColumn('`source`');
    assert.lengthOf(state.filters, 1);
    assert.strictEqual(state.filters[0].col, '`request.url`');
  });

  it('calls saveStateToURL and loadDashboard', () => {
    state.filters = [{ col: '`source`', value: 'fastly', exclude: false }];
    clearFiltersForColumn('`source`');
    assert.strictEqual(saveUrlCalls, 1);
    assert.strictEqual(loadDashCalls, 1);
  });

  it('calls renderActiveFilters to update UI', () => {
    state.filters = [{ col: '`source`', value: 'fastly', exclude: false }];
    clearFiltersForColumn('`source`');
    const container = document.getElementById('activeFilters');
    // No filters left, container should be empty
    assert.strictEqual(container.innerHTML, '');
  });
});

describe('clearAllFilters', () => {
  it('clears all filters', () => {
    state.filters = [
      { col: '`source`', value: 'fastly', exclude: false },
      { col: '`request.url`', value: '/foo', exclude: false },
    ];
    clearAllFilters();
    assert.lengthOf(state.filters, 0);
  });

  it('calls saveStateToURL and loadDashboard', () => {
    state.filters = [{ col: '`source`', value: 'fastly', exclude: false }];
    clearAllFilters();
    assert.strictEqual(saveUrlCalls, 1);
    assert.strictEqual(loadDashCalls, 1);
  });

  it('does nothing when filters are already empty', () => {
    clearAllFilters();
    assert.strictEqual(saveUrlCalls, 0);
    assert.strictEqual(loadDashCalls, 0);
  });
});

describe('addFilter', () => {
  it('adds a basic include filter', () => {
    addFilter('`source`', 'fastly', false);
    assert.lengthOf(state.filters, 1);
    assert.deepInclude(state.filters[0], { col: '`source`', value: 'fastly', exclude: false });
  });

  it('adds an exclude filter', () => {
    addFilter('`source`', 'fastly', true);
    assert.lengthOf(state.filters, 1);
    assert.isTrue(state.filters[0].exclude);
  });

  it('replaces existing filter for same col+value', () => {
    addFilter('`source`', 'fastly', false);
    addFilter('`source`', 'fastly', true);
    assert.lengthOf(state.filters, 1);
    assert.isTrue(state.filters[0].exclude);
  });

  it('uses filterCol passthrough when provided', () => {
    addFilter('`source`', 'fastly', false, '`custom_col`', 'custom_val', 'LIKE');
    const f = state.filters[0];
    assert.strictEqual(f.filterCol, '`custom_col`');
    assert.strictEqual(f.filterValue, 'custom_val');
    assert.strictEqual(f.filterOp, 'LIKE');
  });

  it('uses value as filterValue when filterValue is not passed', () => {
    addFilter('`source`', 'fastly', false, '`custom_col`');
    const f = state.filters[0];
    assert.strictEqual(f.filterCol, '`custom_col`');
    assert.strictEqual(f.filterValue, 'fastly');
  });

  it('omits filterOp when it equals "="', () => {
    addFilter('`source`', 'fastly', false, '`custom_col`', 'val', '=');
    const f = state.filters[0];
    assert.isUndefined(f.filterOp);
  });

  it('falls back to breakdown definition for filterCol', () => {
    state.breakdowns = [
      {
        id: 'breakdown-asn',
        col: '`client.asn`',
        filterCol: '`client.asn`',
        filterValueFn: (v) => parseInt(v.split(' ')[0], 10),
      },
    ];
    addFilter('`client.asn`', '15169 google', false);
    const f = state.filters[0];
    assert.strictEqual(f.filterCol, '`client.asn`');
    assert.strictEqual(f.filterValue, 15169);
  });

  it('uses breakdown filterOp from definition', () => {
    state.breakdowns = [
      {
        id: 'breakdown-error',
        col: '`response.headers.x_error`',
        filterCol: '`response.headers.x_error`',
        filterOp: 'LIKE',
      },
    ];
    addFilter('`response.headers.x_error`', 'some error', false);
    const f = state.filters[0];
    assert.strictEqual(f.filterOp, 'LIKE');
  });

  it('does not set filterCol when breakdown has no filterCol', () => {
    state.breakdowns = [{ id: 'breakdown-source', col: '`source`' }];
    addFilter('`source`', 'fastly', false);
    const f = state.filters[0];
    assert.isUndefined(f.filterCol);
  });

  it('calls saveStateToURL and loadDashboard by default', () => {
    addFilter('`source`', 'fastly', false);
    assert.strictEqual(saveUrlCalls, 1);
    assert.strictEqual(loadDashCalls, 1);
  });

  it('skips reload when skipReload is true', () => {
    addFilter('`source`', 'fastly', false, undefined, undefined, undefined, true);
    assert.strictEqual(saveUrlCalls, 0);
    assert.strictEqual(loadDashCalls, 0);
  });

  it('calls renderActiveFilters', () => {
    addFilter('`source`', 'fastly', false);
    const container = document.getElementById('activeFilters');
    assert.include(container.innerHTML, 'filter-tag');
  });

  it('falls back to allBreakdowns when state.breakdowns is null', () => {
    state.breakdowns = null;
    // allBreakdowns has x_error_grouped with filterCol/filterValueFn/filterOp
    // The col in allBreakdowns is the REGEXP_REPLACE expression from COLUMN_DEFS
    const errorCol = "REGEXP_REPLACE(`response.headers.x_error`, '/[a-zA-Z0-9/_.-]+', '/...')";
    addFilter(errorCol, 'some/.../error', false);
    const f = state.filters[0];
    assert.strictEqual(f.filterCol, '`response.headers.x_error`');
    assert.strictEqual(f.filterOp, 'LIKE');
    // filterValueFn replaces /... with /%
    assert.strictEqual(f.filterValue, 'some/%/error');
  });
});

describe('removeFilter', () => {
  it('removes filter by index', () => {
    state.filters = [
      { col: '`source`', value: 'fastly', exclude: false },
      { col: '`request.url`', value: '/foo', exclude: false },
    ];
    removeFilter(0);
    assert.lengthOf(state.filters, 1);
    assert.strictEqual(state.filters[0].value, '/foo');
  });

  it('calls saveStateToURL and loadDashboard', () => {
    state.filters = [{ col: '`source`', value: 'fastly', exclude: false }];
    removeFilter(0);
    assert.strictEqual(saveUrlCalls, 1);
    assert.strictEqual(loadDashCalls, 1);
  });

  it('calls renderActiveFilters to update UI', () => {
    state.filters = [{ col: '`source`', value: 'fastly', exclude: false }];
    removeFilter(0);
    const container = document.getElementById('activeFilters');
    assert.strictEqual(container.innerHTML, '');
  });
});

describe('removeFilterByValue', () => {
  it('removes filter matching col and value', () => {
    state.filters = [
      { col: '`source`', value: 'fastly', exclude: false },
      { col: '`request.url`', value: '/foo', exclude: false },
    ];
    removeFilterByValue('`source`', 'fastly');
    assert.lengthOf(state.filters, 1);
    assert.strictEqual(state.filters[0].value, '/foo');
  });

  it('calls saveStateToURL and loadDashboard by default', () => {
    state.filters = [{ col: '`source`', value: 'fastly', exclude: false }];
    removeFilterByValue('`source`', 'fastly');
    assert.strictEqual(saveUrlCalls, 1);
    assert.strictEqual(loadDashCalls, 1);
  });

  it('skips reload when skipReload is true', () => {
    state.filters = [{ col: '`source`', value: 'fastly', exclude: false }];
    removeFilterByValue('`source`', 'fastly', true);
    assert.strictEqual(saveUrlCalls, 0);
    assert.strictEqual(loadDashCalls, 0);
  });

  it('does nothing if filter does not exist', () => {
    state.filters = [{ col: '`source`', value: 'fastly', exclude: false }];
    removeFilterByValue('`source`', 'cloudflare');
    assert.lengthOf(state.filters, 1);
  });

  it('calls renderActiveFilters', () => {
    state.filters = [{ col: '`source`', value: 'fastly', exclude: false }];
    removeFilterByValue('`source`', 'fastly');
    const container = document.getElementById('activeFilters');
    assert.strictEqual(container.innerHTML, '');
  });
});

describe('row filter styling (via addFilter/removeFilterByValue)', () => {
  it('adds filter-included class and updates tag on include filter', () => {
    const row = createBreakdownRow('`source`', 'fastly', '#00ff00');
    addFilter('`source`', 'fastly', false);
    assert.isTrue(row.classList.contains('filter-included'));
    assert.isFalse(row.classList.contains('filter-excluded'));
    const tag = row.querySelector('.filter-tag-indicator');
    assert.isTrue(tag.classList.contains('active'));
    assert.isFalse(tag.classList.contains('exclude'));
    assert.include(tag.style.background, '0, 255, 0');
    const icon = tag.querySelector('.filter-icon');
    assert.strictEqual(icon.textContent, '\u2713');
    const dimCell = row.querySelector('td.dim');
    assert.strictEqual(dimCell.dataset.action, 'remove-filter-value');
    assert.strictEqual(dimCell.dataset.exclude, 'false');
  });

  it('adds filter-excluded class and updates tag on exclude filter', () => {
    const row = createBreakdownRow('`source`', 'fastly', '#ff0000');
    addFilter('`source`', 'fastly', true);
    assert.isFalse(row.classList.contains('filter-included'));
    assert.isTrue(row.classList.contains('filter-excluded'));
    const tag = row.querySelector('.filter-tag-indicator');
    assert.isFalse(tag.classList.contains('active'));
    assert.isTrue(tag.classList.contains('exclude'));
    assert.include(tag.style.background, '255, 0, 0');
    const icon = tag.querySelector('.filter-icon');
    assert.strictEqual(icon.textContent, '\u00D7');
    const dimCell = row.querySelector('td.dim');
    assert.strictEqual(dimCell.dataset.action, 'remove-filter-value');
    assert.strictEqual(dimCell.dataset.exclude, 'true');
  });

  it('removes styling when filter is removed', () => {
    const row = createBreakdownRow('`source`', 'fastly');
    addFilter('`source`', 'fastly', false);
    assert.isTrue(row.classList.contains('filter-included'));
    removeFilterByValue('`source`', 'fastly');
    assert.isFalse(row.classList.contains('filter-included'));
    assert.isFalse(row.classList.contains('filter-excluded'));
    const tag = row.querySelector('.filter-tag-indicator');
    assert.isFalse(tag.classList.contains('active'));
    assert.isFalse(tag.classList.contains('exclude'));
    assert.strictEqual(tag.style.background, '');
    const icon = tag.querySelector('.filter-icon');
    assert.strictEqual(icon.textContent, '');
    const dimCell = row.querySelector('td.dim');
    assert.strictEqual(dimCell.dataset.action, 'add-filter');
  });

  it('ignores rows where dim col does not match', () => {
    const row = createBreakdownRow('`request.url`', 'fastly');
    addFilter('`source`', 'fastly', false);
    // Row has col=`request.url` but filter is for `source`, so styling should not apply
    assert.isFalse(row.classList.contains('filter-included'));
  });

  it('ignores rows where data-dim does not match value', () => {
    const row = createBreakdownRow('`source`', 'cloudflare');
    addFilter('`source`', 'fastly', false);
    // Row has dim=cloudflare but filter is for fastly
    assert.isFalse(row.classList.contains('filter-included'));
  });

  it('uses default bgColor when dimCell has no bgColor', () => {
    const row = createBreakdownRow('`source`', 'fastly');
    const dimCell = row.querySelector('td.dim');
    delete dimCell.dataset.bgColor;
    addFilter('`source`', 'fastly', false);
    const tag = row.querySelector('.filter-tag-indicator');
    assert.strictEqual(tag.style.background, 'var(--text)');
  });
});
