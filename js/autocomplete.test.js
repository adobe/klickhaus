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
import { assert } from 'chai';
import { state } from './state.js';
import {
  loadHostAutocomplete,
  filterOwnerRepoDatalist,
  loadOwnerRepoAutocomplete,
  resetOwnerRepoState,
  isValidOwnerRepoValue,
} from './autocomplete.js';

const HOST_CACHE_KEY = 'hostAutocompleteSuggestions';
const FUNCTION_CACHE_KEY = 'functionAutocompleteSuggestions';

// Returns a fetch mock that routes based on URL:
//  - .sql requests  → return the raw SQL text
//  - ClickHouse URL → return { data: rows }
function makeFetchMock(rows) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (url.endsWith('.sql')) {
      return {
        ok: true,
        status: 200,
        text: async () => 'SELECT owner_repo FROM test',
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: rows }),
    };
  };
  fn.calls = calls;
  return fn;
}

describe('loadHostAutocomplete', () => {
  let datalist;
  let savedCache;
  let createdDatalist = false;

  beforeEach(() => {
    state.hostFilterColumn = null;
    datalist = document.getElementById('hostSuggestions');
    if (!datalist) {
      datalist = document.createElement('datalist');
      datalist.id = 'hostSuggestions';
      document.body.appendChild(datalist);
      createdDatalist = true;
    } else {
      createdDatalist = false;
    }
    savedCache = localStorage.getItem(HOST_CACHE_KEY);
    localStorage.removeItem(HOST_CACHE_KEY);
    localStorage.removeItem(FUNCTION_CACHE_KEY);
  });

  afterEach(() => {
    if (savedCache !== null) {
      localStorage.setItem(HOST_CACHE_KEY, savedCache);
    } else {
      localStorage.removeItem(HOST_CACHE_KEY);
    }
    if (createdDatalist && datalist && datalist.parentNode) {
      datalist.remove();
    }
  });

  it('populates datalist from cache when host cache is valid', async () => {
    const hosts = ['host-a.aem.live', 'host-b.aem.page'];
    localStorage.setItem(HOST_CACHE_KEY, JSON.stringify({
      hosts,
      timestamp: Date.now(),
    }));
    state.hostFilterColumn = null;

    await loadHostAutocomplete();

    assert.strictEqual(datalist.children.length, 2);
    assert.strictEqual(datalist.children[0].value, 'host-a.aem.live');
    assert.strictEqual(datalist.children[1].value, 'host-b.aem.page');
  });

  it('populates datalist from function cache when hostFilterColumn is function_name', async () => {
    const functions = ['myLambda', 'otherFunc'];
    localStorage.setItem(FUNCTION_CACHE_KEY, JSON.stringify({
      hosts: functions,
      timestamp: Date.now(),
    }));
    state.hostFilterColumn = 'function_name';

    await loadHostAutocomplete();

    assert.strictEqual(datalist.children.length, 2);
    assert.strictEqual(datalist.children[0].value, 'myLambda');
    assert.strictEqual(datalist.children[1].value, 'otherFunc');
  });

  it('uses cache when within TTL', async () => {
    const hosts = ['cached.example.com'];
    localStorage.setItem(HOST_CACHE_KEY, JSON.stringify({
      hosts,
      timestamp: Date.now() - 1000,
    }));

    await loadHostAutocomplete();

    assert.strictEqual(datalist.children.length, 1);
    assert.strictEqual(datalist.children[0].value, 'cached.example.com');
  });
});

describe('loadOwnerRepoAutocomplete', () => {
  let originalFetch;
  let savedCredentials;

  beforeEach(() => {
    originalFetch = window.fetch;
    savedCredentials = state.credentials;
    state.credentials = { user: 'testuser', password: 'testpass' };
    resetOwnerRepoState();
    document.getElementById('ownerRepoSuggestions')?.remove();
  });

  afterEach(() => {
    window.fetch = originalFetch;
    state.credentials = savedCredentials;
    resetOwnerRepoState();
    document.getElementById('ownerRepoSuggestions')?.remove();
  });

  it('fetches owner/repo pairs from the DB and makes them available for filtering', async () => {
    const rows = [
      { owner_repo: 'adobe/helix-pages' },
      { owner_repo: 'adobe/helix-importer' },
    ];
    window.fetch = makeFetchMock(rows);

    await loadOwnerRepoAutocomplete();

    const dl = document.createElement('datalist');
    dl.id = 'ownerRepoSuggestions';
    document.body.appendChild(dl);
    filterOwnerRepoDatalist('adobe');

    assert.strictEqual(dl.children.length, 2);
    assert.strictEqual(dl.children[0].value, 'adobe/helix-importer');
    assert.strictEqual(dl.children[1].value, 'adobe/helix-pages');
  });

  it('sorts results case-insensitively', async () => {
    const rows = [
      { owner_repo: 'Zorg/repo' },
      { owner_repo: 'adobe/helix-pages' },
      { owner_repo: 'Beta/repo' },
    ];
    window.fetch = makeFetchMock(rows);

    await loadOwnerRepoAutocomplete();

    const dl = document.createElement('datalist');
    dl.id = 'ownerRepoSuggestions';
    document.body.appendChild(dl);
    filterOwnerRepoDatalist('repo');

    const values = Array.from(dl.children).map((o) => o.value);
    assert.deepEqual(values, ['Beta/repo', 'Zorg/repo']);
  });

  it('skips refetch when already loaded for the same table', async () => {
    const fetchMock = makeFetchMock([{ owner_repo: 'adobe/helix-pages' }]);
    window.fetch = fetchMock;

    await loadOwnerRepoAutocomplete();
    await loadOwnerRepoAutocomplete();

    // Only the initial SQL + query calls should have been made (2 fetches total for first call)
    assert.isAtMost(fetchMock.calls.length, 2);
  });

  it('ignores rows with empty owner_repo', async () => {
    const rows = [
      { owner_repo: 'adobe/helix-pages' },
      { owner_repo: '' },
      { owner_repo: null },
    ];
    window.fetch = makeFetchMock(rows);

    await loadOwnerRepoAutocomplete();

    const dl = document.createElement('datalist');
    dl.id = 'ownerRepoSuggestions';
    document.body.appendChild(dl);
    filterOwnerRepoDatalist('adobe');

    assert.strictEqual(dl.children.length, 1);
    assert.strictEqual(dl.children[0].value, 'adobe/helix-pages');
  });
});

describe('isValidOwnerRepoValue', () => {
  let originalFetch;
  let savedCredentials;

  beforeEach(async () => {
    originalFetch = window.fetch;
    savedCredentials = state.credentials;
    state.credentials = { user: 'testuser', password: 'testpass' };
    resetOwnerRepoState();
    window.fetch = makeFetchMock([
      { owner_repo: 'adobe' },
      { owner_repo: 'adobe/helix-pages' },
    ]);
    await loadOwnerRepoAutocomplete();
    window.fetch = originalFetch;
  });

  afterEach(() => {
    window.fetch = originalFetch;
    state.credentials = savedCredentials;
    resetOwnerRepoState();
  });

  it('returns true for empty string', () => {
    assert.isTrue(isValidOwnerRepoValue(''));
  });

  it('returns true for a known owner-only entry', () => {
    assert.isTrue(isValidOwnerRepoValue('adobe'));
  });

  it('returns true for a known owner/repo entry', () => {
    assert.isTrue(isValidOwnerRepoValue('adobe/helix-pages'));
  });

  it('returns false for partial text not in the list', () => {
    assert.isFalse(isValidOwnerRepoValue('adobe/helix'));
  });

  it('returns false for unknown owner', () => {
    assert.isFalse(isValidOwnerRepoValue('unknown'));
  });

  it('returns true for any value when list is not yet loaded', () => {
    resetOwnerRepoState();
    assert.isTrue(isValidOwnerRepoValue('anything'));
  });
});

describe('filterOwnerRepoDatalist', () => {
  let datalist;
  let originalFetch;
  let savedCredentials;
  const testValues = [
    'adobe/helix-pages',
    'adobe/helix-importer',
    'myorg/adobe-tools',
    'other/repo',
  ];

  beforeEach(async () => {
    originalFetch = window.fetch;
    savedCredentials = state.credentials;
    state.credentials = { user: 'testuser', password: 'testpass' };
    resetOwnerRepoState();

    window.fetch = makeFetchMock(testValues.map((v) => ({ owner_repo: v })));
    await loadOwnerRepoAutocomplete();
    window.fetch = originalFetch;

    document.getElementById('ownerRepoSuggestions')?.remove();
    datalist = document.createElement('datalist');
    datalist.id = 'ownerRepoSuggestions';
    document.body.appendChild(datalist);
  });

  afterEach(() => {
    window.fetch = originalFetch;
    state.credentials = savedCredentials;
    resetOwnerRepoState();
    datalist?.remove();
  });

  it('returns early when datalist element is absent', () => {
    datalist.remove();
    datalist = null;
    filterOwnerRepoDatalist('adobe');
    // no error thrown
  });

  it('clears datalist when text is empty', () => {
    datalist.innerHTML = '<option value="stale">';
    filterOwnerRepoDatalist('');
    assert.strictEqual(datalist.innerHTML, '');
  });

  it('ranks owner-only prefix matches before owner/repo prefix matches before contains', () => {
    // For 'adobe': no owner-only prefix matches, owner/repo prefix matches, then contains
    filterOwnerRepoDatalist('adobe');

    const values = Array.from(datalist.children).map((o) => o.value);
    assert.deepEqual(values, [
      'adobe/helix-importer',
      'adobe/helix-pages',
      'myorg/adobe-tools',
    ]);
  });

  it('returns only entries that match the query', () => {
    filterOwnerRepoDatalist('helix');

    const values = Array.from(datalist.children).map((o) => o.value);
    assert.deepEqual(values, ['adobe/helix-importer', 'adobe/helix-pages']);
  });

  it('is case-insensitive', () => {
    filterOwnerRepoDatalist('ADOBE');

    const values = Array.from(datalist.children).map((o) => o.value);
    assert.include(values, 'adobe/helix-pages');
    assert.include(values, 'myorg/adobe-tools');
  });

  it('ranks owner-only entries above owner/repo entries when both match', async () => {
    resetOwnerRepoState();
    const rows = [
      { owner_repo: 'adobe' },
      { owner_repo: 'adobe/helix-pages' },
      { owner_repo: 'adobe/helix-importer' },
    ];
    window.fetch = makeFetchMock(rows);
    await loadOwnerRepoAutocomplete();
    window.fetch = originalFetch;

    filterOwnerRepoDatalist('adobe');

    const values = Array.from(datalist.children).map((o) => o.value);
    assert.strictEqual(values[0], 'adobe', 'owner-only entry should come first');
    assert.include(values, 'adobe/helix-importer');
    assert.include(values, 'adobe/helix-pages');
  });

  it('limits results to 20 entries', async () => {
    resetOwnerRepoState();
    const manyValues = Array.from({ length: 30 }, (_, i) => `org/repo-${i}`);
    window.fetch = makeFetchMock(manyValues.map((v) => ({ owner_repo: v })));
    await loadOwnerRepoAutocomplete();
    window.fetch = originalFetch;

    filterOwnerRepoDatalist('repo');

    assert.strictEqual(datalist.children.length, 20);
  });
});
