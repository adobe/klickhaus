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
  shouldShowResolveButton, buildResolveButtonHtml, renderRayIdResultHtml, initRayIdLookup,
} from './ray-id-lookup.js';

// Returns a fetch mock that routes based on URL:
//  - .sql requests  → return the raw SQL template text
//  - ClickHouse URL → return { data: rows } (or a failure response)
function makeFetchMock({
  rows = [], ok = true, status = 200, errorText = '',
} = {}) {
  return async (url) => {
    if (url.endsWith('.sql')) {
      return { ok: true, status: 200, text: async () => "SELECT * FROM da WHERE ray_id = '{{rayId}}'" };
    }
    if (!ok) {
      return { ok: false, status, text: async () => errorText };
    }
    return { ok: true, status: 200, json: async () => ({ data: rows }) };
  };
}

function waitForMicrotasks() {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

describe('shouldShowResolveButton', () => {
  it('shows the button for a real ray_id value', () => {
    assert.isTrue(shouldShowResolveButton('ray_id', 'a1495b1e6d10c17f'));
  });

  it('hides the button for the internal service-binding sentinel "0"', () => {
    assert.isFalse(shouldShowResolveButton('ray_id', '0'));
  });

  it('hides the button for an empty value', () => {
    assert.isFalse(shouldShowResolveButton('ray_id', ''));
  });

  it('hides the button for any other column', () => {
    assert.isFalse(shouldShowResolveButton('request_id', 'a1495b1e6d10c17f'));
  });
});

describe('buildResolveButtonHtml', () => {
  it('embeds the ray id as the button data-value', () => {
    const html = buildResolveButtonHtml('a1495b1e6d10c17f');
    assert.include(html, 'data-action="resolve-ray-id"');
    assert.include(html, 'data-value="a1495b1e6d10c17f"');
  });

  it('escapes HTML-sensitive characters in the ray id', () => {
    const html = buildResolveButtonHtml('"><script>');
    assert.notInclude(html, '<script>');
  });
});

describe('renderRayIdResultHtml', () => {
  it('shows an empty-state message when no rows match', () => {
    const html = renderRayIdResultHtml([]);
    assert.include(html, 'No matching CDN access log found');
  });

  it('renders the matched access log fields for a single row', () => {
    const html = renderRayIdResultHtml([{
      timestamp: '2026-07-08T12:00:00.000Z',
      'request.method': 'GET',
      'request.host': 'admin.da.live',
      'request.url': '/source/adobecom/da-playground/x.html',
      'response.status': 200,
      'cdn.cache_status': 'MISS',
      'cdn.script_name': 'da-admin',
    }]);
    assert.include(html, 'Matched CDN access log (da)');
    assert.include(html, 'admin.da.live');
    assert.include(html, '/source/adobecom/da-playground/x.html');
    assert.include(html, '200');
    assert.include(html, 'da-admin');
  });

  it('renders one row per match when multiple rows are returned', () => {
    const html = renderRayIdResultHtml([
      { 'request.host': 'admin.da.live', 'request.url': '/a' },
      { 'request.host': 'admin.da.live', 'request.url': '/b' },
    ]);
    assert.include(html, '/a');
    assert.include(html, '/b');
  });
});

describe('initRayIdLookup', () => {
  let modal;
  let table;
  let originalFetch;
  let savedCredentials;

  beforeEach(() => {
    modal = document.createElement('div');
    document.body.appendChild(modal);
    table = document.createElement('table');
    table.id = 'logDetailTable';
    table.innerHTML = `<tbody><tr><th>ray_id</th><td>abc123${buildResolveButtonHtml('abc123')}</td></tr></tbody>`;
    modal.appendChild(table);
    initRayIdLookup(modal);

    savedCredentials = state.credentials;
    state.credentials = { user: 'testuser', password: 'testpass' };
    originalFetch = window.fetch;
  });

  afterEach(() => {
    window.fetch = originalFetch;
    state.credentials = savedCredentials;
    modal.remove();
  });

  it('resolves a clicked ray_id and renders the matched CDN access log row', async () => {
    window.fetch = makeFetchMock({
      rows: [{ 'request.host': 'admin.da.live', 'request.url': '/x' }],
    });
    table.querySelector('[data-action="resolve-ray-id"]').click();
    await waitForMicrotasks();
    await waitForMicrotasks();
    assert.include(table.textContent, 'Matched CDN access log');
    assert.include(table.textContent, 'admin.da.live');
  });

  it('shows an empty-state message when no rows match', async () => {
    window.fetch = makeFetchMock({ rows: [] });
    table.querySelector('[data-action="resolve-ray-id"]').click();
    await waitForMicrotasks();
    await waitForMicrotasks();
    assert.include(table.textContent, 'No matching CDN access log found');
  });

  it('shows a lookup-failed message when the query errors', async () => {
    window.fetch = makeFetchMock({ ok: false, status: 500, errorText: 'DB::Exception: boom' });
    table.querySelector('[data-action="resolve-ray-id"]').click();
    await waitForMicrotasks();
    await waitForMicrotasks();
    assert.include(table.textContent, 'Lookup failed');
  });

  it('ignores clicks that are not on the resolve button', async () => {
    table.click();
    await waitForMicrotasks();
    assert.isNull(document.getElementById('rayIdResolveResult'));
  });
});
