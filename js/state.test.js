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
import {
  state,
  setOnPinnedColumnsChange,
  togglePinnedColumn,
  loadFacetPrefs,
  setOnFacetOrderChange,
  togglePinnedFacet,
  toggleHiddenFacet,
} from './state.js';

function resetState() {
  state.pinnedColumns = [];
  state.pinnedFacets = [];
  state.hiddenFacets = [];
  state.logsData = null;
  state.title = '';
  setOnPinnedColumnsChange(null);
  setOnFacetOrderChange(null);
  localStorage.removeItem('pinnedColumns');
  localStorage.removeItem('facetPrefs');
}

describe('state', () => {
  beforeEach(resetState);
  afterEach(resetState);

  it('exports a state object with expected default fields', () => {
    assert.isObject(state);
    assert.isNull(state.credentials);
    assert.isArray(state.filters);
    assert.strictEqual(state.contentTypeMode, 'count');
  });
});

describe('togglePinnedColumn', () => {
  beforeEach(resetState);
  afterEach(resetState);

  it('adds a column to pinnedColumns', () => {
    togglePinnedColumn('response.status');
    assert.deepEqual(state.pinnedColumns, ['response.status']);
  });

  it('removes a column that is already pinned', () => {
    state.pinnedColumns = ['response.status', 'request.url'];
    togglePinnedColumn('response.status');
    assert.deepEqual(state.pinnedColumns, ['request.url']);
  });

  it('persists pinnedColumns to localStorage', () => {
    togglePinnedColumn('cdn.cache_status');
    const stored = JSON.parse(localStorage.getItem('pinnedColumns'));
    assert.deepEqual(stored, ['cdn.cache_status']);
  });

  it('calls onPinnedColumnsChange callback when logsData is present', () => {
    let callbackData = null;
    setOnPinnedColumnsChange((data) => {
      callbackData = data;
    });
    state.logsData = [{ row: 1 }];
    togglePinnedColumn('col1');
    assert.deepEqual(callbackData, [{ row: 1 }]);
  });

  it('does not call callback when logsData is null', () => {
    let called = false;
    setOnPinnedColumnsChange(() => {
      called = true;
    });
    state.logsData = null;
    togglePinnedColumn('col1');
    assert.isFalse(called);
  });

  it('does not call callback when no callback is set', () => {
    state.logsData = [{ row: 1 }];
    // Should not throw
    togglePinnedColumn('col1');
    assert.deepEqual(state.pinnedColumns, ['col1']);
  });
});

describe('loadFacetPrefs', () => {
  beforeEach(resetState);
  afterEach(resetState);

  it('loads pinned and hidden from localStorage', () => {
    localStorage.setItem('facetPrefs', JSON.stringify({
      pinned: ['facetA', 'facetB'],
      hidden: ['facetC'],
    }));
    loadFacetPrefs();
    assert.deepEqual(state.pinnedFacets, ['facetA', 'facetB']);
    assert.deepEqual(state.hiddenFacets, ['facetC']);
  });

  it('defaults to empty arrays when no data stored', () => {
    localStorage.removeItem('facetPrefs');
    loadFacetPrefs();
    assert.deepEqual(state.pinnedFacets, []);
    assert.deepEqual(state.hiddenFacets, []);
  });

  it('defaults to empty arrays on invalid JSON', () => {
    localStorage.setItem('facetPrefs', 'not-json');
    loadFacetPrefs();
    assert.deepEqual(state.pinnedFacets, []);
    assert.deepEqual(state.hiddenFacets, []);
  });

  it('uses title-keyed storage when state.title is set', () => {
    state.title = 'myDashboard';
    localStorage.setItem('facetPrefs_myDashboard', JSON.stringify({
      pinned: ['x'],
      hidden: ['y'],
    }));
    loadFacetPrefs();
    assert.deepEqual(state.pinnedFacets, ['x']);
    assert.deepEqual(state.hiddenFacets, ['y']);
    localStorage.removeItem('facetPrefs_myDashboard');
  });

  it('does not read default key when title is set', () => {
    state.title = 'other';
    localStorage.setItem('facetPrefs', JSON.stringify({
      pinned: ['should-not-load'],
      hidden: [],
    }));
    loadFacetPrefs();
    assert.deepEqual(state.pinnedFacets, []);
    localStorage.removeItem('facetPrefs_other');
  });
});

describe('togglePinnedFacet', () => {
  beforeEach(resetState);
  afterEach(resetState);

  it('pins a facet', () => {
    togglePinnedFacet('facet1');
    assert.include(state.pinnedFacets, 'facet1');
  });

  it('unpins a facet that is already pinned', () => {
    state.pinnedFacets = ['facet1'];
    togglePinnedFacet('facet1');
    assert.notInclude(state.pinnedFacets, 'facet1');
  });

  it('removes from hiddenFacets when pinning a hidden facet', () => {
    state.hiddenFacets = ['facet1'];
    togglePinnedFacet('facet1');
    assert.include(state.pinnedFacets, 'facet1');
    assert.notInclude(state.hiddenFacets, 'facet1');
  });

  it('persists to localStorage', () => {
    togglePinnedFacet('facet1');
    const stored = JSON.parse(localStorage.getItem('facetPrefs'));
    assert.deepEqual(stored.pinned, ['facet1']);
  });

  it('calls onFacetOrderChange callback', () => {
    let called = false;
    setOnFacetOrderChange(() => {
      called = true;
    });
    togglePinnedFacet('facet1');
    assert.isTrue(called);
  });
});

describe('toggleHiddenFacet', () => {
  beforeEach(resetState);
  afterEach(resetState);

  it('hides a facet', () => {
    toggleHiddenFacet('facet1');
    assert.include(state.hiddenFacets, 'facet1');
  });

  it('unhides a facet that is already hidden', () => {
    state.hiddenFacets = ['facet1'];
    toggleHiddenFacet('facet1');
    assert.notInclude(state.hiddenFacets, 'facet1');
  });

  it('removes from pinnedFacets when hiding a pinned facet', () => {
    state.pinnedFacets = ['facet1'];
    toggleHiddenFacet('facet1');
    assert.include(state.hiddenFacets, 'facet1');
    assert.notInclude(state.pinnedFacets, 'facet1');
  });

  it('calls onFacetOrderChange callback with facetId', () => {
    let receivedId = null;
    setOnFacetOrderChange((id) => {
      receivedId = id;
    });
    toggleHiddenFacet('facet1');
    assert.strictEqual(receivedId, 'facet1');
  });

  it('persists to localStorage', () => {
    toggleHiddenFacet('facet1');
    const stored = JSON.parse(localStorage.getItem('facetPrefs'));
    assert.deepEqual(stored.hidden, ['facet1']);
  });
});
