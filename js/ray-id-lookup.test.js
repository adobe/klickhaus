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
      return { ok: true, status: 200, text: async () => "SELECT * FROM t WHERE ray_id = '{{rayId}}'" };
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

function withTableName(tableName, fn) {
  const saved = state.tableName;
  state.tableName = tableName;
  try {
    fn();
  } finally {
    state.tableName = saved;
  }
}

describe('shouldShowResolveButton', () => {
  it('shows the button on the da_worker_logs dashboard for a real ray_id value', () => {
    withTableName('da_worker_logs', () => {
      assert.isTrue(shouldShowResolveButton('ray_id', 'a1495b1e6d10c17f'));
    });
  });

  it('shows the button on the da dashboard for a real ray_id value', () => {
    withTableName('da', () => {
      assert.isTrue(shouldShowResolveButton('ray_id', 'a1495b1e6d10c17f'));
    });
  });

  it('hides the button on dashboards with no ray_id-joinable counterpart', () => {
    withTableName('delivery', () => {
      assert.isFalse(shouldShowResolveButton('ray_id', 'a1495b1e6d10c17f'));
    });
  });

  it('hides the button for the internal service-binding sentinel "0"', () => {
    withTableName('da_worker_logs', () => {
      assert.isFalse(shouldShowResolveButton('ray_id', '0'));
    });
  });

  it('hides the button for an empty value', () => {
    withTableName('da_worker_logs', () => {
      assert.isFalse(shouldShowResolveButton('ray_id', ''));
    });
  });

  it('hides the button for any other column', () => {
    withTableName('da_worker_logs', () => {
      assert.isFalse(shouldShowResolveButton('request_id', 'a1495b1e6d10c17f'));
    });
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

  it('points the tooltip at the da access log from the da_worker_logs dashboard', () => {
    withTableName('da_worker_logs', () => {
      assert.include(buildResolveButtonHtml('abc'), 'CDN access log (da)');
    });
  });

  it('points the tooltip at the worker log from the da dashboard', () => {
    withTableName('da', () => {
      assert.include(buildResolveButtonHtml('abc'), 'worker log (da_worker_logs)');
    });
  });
});

describe('renderRayIdResultHtml - da_worker_logs -> da', () => {
  it('shows an empty-state message when no rows match', () => {
    withTableName('da_worker_logs', () => {
      assert.include(renderRayIdResultHtml([]), 'No matching CDN access log (da) found');
    });
  });

  it('renders only the configured access-log fields for a single row', () => {
    withTableName('da_worker_logs', () => {
      const html = renderRayIdResultHtml([{
        timestamp: '2026-07-08T12:00:00.000Z',
        'request.method': 'GET',
        'request.host': 'admin.da.live',
        'request.url': '/source/adobecom/da-playground/x.html',
        'response.status': 200,
        'cdn.cache_status': 'MISS',
        'cdn.script_name': 'da-admin',
        'cdn.time_elapsed_msec': 42,
        'response.headers.x_error': '',
      }]);
      assert.include(html, 'Matched CDN access log (da)');
      assert.include(html, '<th>Time</th>');
      assert.include(html, '<th>Host</th>');
      assert.include(html, '<th>URL</th>');
      assert.include(html, '<th>Elapsed (ms)</th>');
      assert.include(html, '<th>Error</th>');
      assert.include(html, 'admin.da.live');
      assert.include(html, '/source/adobecom/da-playground/x.html');
      assert.include(html, '200');
      assert.include(html, 'da-admin');
      assert.include(html, '42');
      // cdn.cache_status was deliberately dropped from the field list
      assert.notInclude(html, 'MISS');
    });
  });

  it('renders one row per match when multiple rows are returned', () => {
    withTableName('da_worker_logs', () => {
      const html = renderRayIdResultHtml([
        { 'request.host': 'admin.da.live', 'request.url': '/a' },
        { 'request.host': 'admin.da.live', 'request.url': '/b' },
      ]);
      assert.include(html, '/a');
      assert.include(html, '/b');
    });
  });
});

describe('renderRayIdResultHtml - da -> da_worker_logs', () => {
  it('shows an empty-state message when no rows match', () => {
    withTableName('da', () => {
      assert.include(renderRayIdResultHtml([]), 'No matching worker log (da_worker_logs) found');
    });
  });

  it('renders only the configured worker-log fields, joining logs[]/exceptions[] with a pipe', () => {
    withTableName('da', () => {
      const html = renderRayIdResultHtml([{
        timestamp: '2026-07-08T12:00:00.000Z',
        script_name: 'da-admin',
        outcome: 'exception',
        'response.status': 500,
        cpu_ms: 12,
        wall_ms: 34,
        logs: ['fetching resource from admin', 'https://x'],
        exceptions: ['TypeError: x is not a function'],
      }]);
      assert.include(html, 'Matched worker log (da_worker_logs)');
      assert.include(html, '<th>Time</th>');
      assert.include(html, '<th>Worker</th>');
      assert.include(html, '<th>Outcome</th>');
      assert.include(html, '<th>CPU (ms)</th>');
      assert.include(html, '<th>Logs</th>');
      assert.include(html, '<th>Exceptions</th>');
      assert.include(html, 'da-admin');
      assert.include(html, 'exception');
      assert.include(html, 'fetching resource from admin | https://x');
      assert.include(html, 'TypeError: x is not a function');
    });
  });
});

describe('initRayIdLookup', () => {
  let modal;
  let table;
  let originalFetch;
  let savedCredentials;
  let savedTableName;

  beforeEach(() => {
    modal = document.createElement('div');
    document.body.appendChild(modal);
    table = document.createElement('table');
    table.id = 'logDetailTable';
    savedTableName = state.tableName;
    state.tableName = 'da_worker_logs';
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
    state.tableName = savedTableName;
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
    assert.include(table.textContent, 'No matching CDN access log');
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

  it('resolves the other direction (da -> da_worker_logs) when on the da dashboard', async () => {
    state.tableName = 'da';
    table.innerHTML = `<tbody><tr><th>ray_id</th><td>abc123${buildResolveButtonHtml('abc123')}</td></tr></tbody>`;
    window.fetch = makeFetchMock({ rows: [{ script_name: 'da-admin', outcome: 'ok' }] });
    table.querySelector('[data-action="resolve-ray-id"]').click();
    await waitForMicrotasks();
    await waitForMicrotasks();
    assert.include(table.textContent, 'Matched worker log');
    assert.include(table.textContent, 'da-admin');
  });
});
