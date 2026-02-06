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
import { loadHostAutocomplete } from './autocomplete.js';

const HOST_CACHE_KEY = 'hostAutocompleteSuggestions';
const FUNCTION_CACHE_KEY = 'functionAutocompleteSuggestions';

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
