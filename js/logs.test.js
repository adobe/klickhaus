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
  openLogDetailModal, closeLogDetailModal, renderLogsTable, setLogsElements, copyLogRow,
  applyViewMode, setViewMode, cycleViewMode, toggleLogsView,
  setOnShowFiltersView, setOnShowLogsView, loadLogs,
} from './logs.js';

function ensureModal() {
  let modal = document.getElementById('logDetailModal');
  if (!modal) {
    modal = document.createElement('dialog');
    modal.id = 'logDetailModal';
    modal.innerHTML = '<button data-action="close-log-detail"></button>'
      + '<table id="logDetailTable"></table>';
    document.body.appendChild(modal);
  }
  return modal;
}

describe('openLogDetailModal - Array(String) fields (e.g. da_worker_logs logs/exceptions)', () => {
  let savedLogsData;

  beforeEach(() => {
    ensureModal();
    savedLogsData = state.logsData;
    state.logsData = [{
      logs: [
        '[worker] Unable to get resource https://admin.da.live/x: 403 - Forbidden',
        '[worker] second log line',
      ],
      exceptions: [],
    }];
  });

  afterEach(() => {
    closeLogDetailModal();
    state.logsData = savedLogsData;
  });

  it('renders each logs[] entry on its own line instead of a single JSON array line', () => {
    openLogDetailModal(0);
    const table = document.getElementById('logDetailTable');
    assert.notInclude(table.innerHTML, '[ &quot;[worker]');
    assert.include(table.innerHTML, 'Forbidden<br>[worker] second log line');
  });

  it('does not lose or reorder entries when joining lines', () => {
    openLogDetailModal(0);
    const table = document.getElementById('logDetailTable');
    const logsRow = [...table.querySelectorAll('tr')]
      .find((r) => r.querySelector('th')?.textContent === 'logs');
    const lines = logsRow.querySelector('td').innerHTML.split('<br>');
    assert.strictEqual(lines.length, 2);
    assert.include(lines[0], 'Unable to get resource');
    assert.include(lines[1], 'second log line');
  });

  it('shows "(empty)" for an empty array field rather than "[]"', () => {
    openLogDetailModal(0);
    const table = document.getElementById('logDetailTable');
    const exceptionsRow = [...table.querySelectorAll('tr')]
      .find((r) => r.querySelector('th')?.textContent === 'exceptions');
    assert.include(exceptionsRow.querySelector('td').textContent, '(empty)');
  });
});

describe('openLogDetailModal - other field types and modal interactions', () => {
  let savedLogsData;
  let searchInput;

  beforeEach(() => {
    ensureModal();
    searchInput = document.getElementById('searchFilter');
    if (!searchInput) {
      searchInput = document.createElement('input');
      searchInput.id = 'searchFilter';
      document.body.appendChild(searchInput);
    }
    savedLogsData = state.logsData;
  });

  afterEach(() => {
    closeLogDetailModal();
    state.logsData = savedLogsData;
  });

  function statusCellClass() {
    const table = document.getElementById('logDetailTable');
    const row = [...table.querySelectorAll('tr')].find((r) => r.querySelector('th')?.textContent === 'status');
    return row.querySelector('td').className;
  }

  it('color-codes response.status as ok/4xx/5xx', () => {
    state.logsData = [
      { 'response.status': 200 },
      { 'response.status': 404 },
      { 'response.status': 500 },
    ];
    openLogDetailModal(0);
    assert.include(statusCellClass(), 'status-ok');
    openLogDetailModal(1);
    assert.include(statusCellClass(), 'status-4xx');
    openLogDetailModal(2);
    assert.include(statusCellClass(), 'status-5xx');
  });

  it('groups an unrecognized dotted column prefix under its own titled section', () => {
    state.logsData = [{ 'foo.bar': 'baz' }];
    openLogDetailModal(0);
    const table = document.getElementById('logDetailTable');
    assert.include(table.textContent, 'Foo');
    assert.include(table.textContent, 'bar');
  });

  it('renders a search button for request_id and wires it to the search filter input', () => {
    state.logsData = [{ request_id: 'abc-123' }];
    openLogDetailModal(0);
    const btn = document.querySelector('[data-action="search-by-request-id"]');
    assert.ok(btn);
    btn.click();
    assert.strictEqual(searchInput.value, 'abc-123');
    assert.isFalse(document.getElementById('logDetailModal').open);
  });

  it('closes on backdrop click, Escape, and the close button', () => {
    state.logsData = [{ script_name: 'da-admin' }];
    const modal = document.getElementById('logDetailModal');

    openLogDetailModal(0);
    modal.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.isFalse(modal.open);

    openLogDetailModal(0);
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    assert.isFalse(modal.open);

    openLogDetailModal(0);
    modal.querySelector('[data-action="close-log-detail"]').click();
    assert.isFalse(modal.open);
  });
});

describe('openLogDetailModal - lambda_logs Array(String) fields stay untouched', () => {
  let savedLogsData;

  beforeEach(() => {
    ensureModal();
    savedLogsData = state.logsData;
    state.logsData = [{
      urls: ['https://a.example.com', 'https://b.example.com'],
    }];
  });

  afterEach(() => {
    closeLogDetailModal();
    state.logsData = savedLogsData;
  });

  it('still renders lambda_logs array columns (urls/paths/...) as a single JSON array line', () => {
    openLogDetailModal(0);
    const table = document.getElementById('logDetailTable');
    const urlsRow = [...table.querySelectorAll('tr')]
      .find((r) => r.querySelector('th')?.textContent === 'urls');
    const cellHtml = urlsRow.querySelector('td').innerHTML;
    assert.notInclude(cellHtml, '<br>');
    assert.strictEqual(
      urlsRow.querySelector('td').textContent,
      JSON.stringify(['https://a.example.com', 'https://b.example.com'], null, 2),
    );
  });
});

// Builds the DOM fixture setLogsElements/renderLogsTable/applyViewMode expect
// (mirrors the #logsView/#filtersView/#contentArea/#viewCycleBtn/#moreViewToggleItem
// markup in da-workers.html and the other dashboard shells).
function buildDashboardFixture() {
  const logsView = document.createElement('div');
  logsView.id = 'logsView';
  const container = document.createElement('div');
  container.className = 'logs-table-container';
  logsView.appendChild(container);

  const filtersView = document.createElement('div');
  filtersView.id = 'filtersView';

  const contentArea = document.createElement('div');
  contentArea.id = 'contentArea';

  const viewCycleBtn = document.createElement('button');
  viewCycleBtn.id = 'viewCycleBtn';

  const moreItem = document.createElement('div');
  moreItem.id = 'moreViewToggleItem';
  const moreLabel = document.createElement('span');
  moreLabel.className = 'menu-item-label';
  moreItem.appendChild(moreLabel);

  document.body.append(logsView, filtersView, contentArea, viewCycleBtn, moreItem);
  return {
    logsView, filtersView, contentArea, container,
  };
}

function removeDashboardFixture(fixture) {
  fixture.logsView.remove();
  fixture.filtersView.remove();
  fixture.contentArea.remove();
  document.getElementById('viewCycleBtn')?.remove();
  document.getElementById('moreViewToggleItem')?.remove();
}

describe('renderLogsTable', () => {
  let fixture;
  let savedPinnedColumns;
  let savedLogColumnWidths;

  beforeEach(() => {
    fixture = buildDashboardFixture();
    setLogsElements(fixture.logsView, fixture.filtersView, fixture.contentArea);
    savedPinnedColumns = state.pinnedColumns;
    savedLogColumnWidths = state.logColumnWidths;
    state.pinnedColumns = [];
    state.logColumnWidths = {};
  });

  afterEach(() => {
    removeDashboardFixture(fixture);
    state.pinnedColumns = savedPinnedColumns;
    state.logColumnWidths = savedLogColumnWidths;
  });

  it('shows an empty-state message when there is no data', () => {
    renderLogsTable([]);
    assert.include(fixture.container.textContent, 'No logs matching current filters');
  });

  it('renders one row per log entry with the row values visible', () => {
    renderLogsTable([
      { timestamp: '2026-07-08T12:00:00.000Z', 'response.status': 200, script_name: 'da-admin' },
      { timestamp: '2026-07-08T12:01:00.000Z', 'response.status': 500, script_name: 'da-collab' },
    ]);
    const rows = fixture.container.querySelectorAll('tbody tr');
    assert.strictEqual(rows.length, 2);
    assert.include(fixture.container.textContent, 'da-admin');
    assert.include(fixture.container.textContent, 'da-collab');
  });

  it('sticks pinned columns to the left with computed offsets', async () => {
    state.pinnedColumns = ['timestamp'];
    renderLogsTable([
      { timestamp: '2026-07-08T12:00:00.000Z', script_name: 'da-admin' },
      { timestamp: '2026-07-08T12:01:00.000Z', script_name: 'da-collab' },
    ]);
    await new Promise((resolve) => { requestAnimationFrame(resolve); });
    const headerCell = fixture.container.querySelector('thead th.pinned');
    const bodyCell = fixture.container.querySelector('tbody td.pinned');
    assert.ok(headerCell);
    assert.ok(bodyCell);
    assert.strictEqual(headerCell.style.left, '0px');
    assert.strictEqual(bodyCell.style.left, '0px');
  });

  it('opens the log detail modal when a row background is clicked', () => {
    ensureModal();
    state.logsData = [{ timestamp: '2026-07-08T12:00:00.000Z', script_name: 'da-admin' }];
    renderLogsTable(state.logsData);
    fixture.container.querySelector('tbody tr').click();
    assert.isTrue(document.getElementById('logDetailModal').open);
    closeLogDetailModal();
  });
});

describe('applyViewMode / setViewMode / cycleViewMode / toggleLogsView', () => {
  let fixture;
  let savedViewMode;

  beforeEach(() => {
    fixture = buildDashboardFixture();
    setLogsElements(fixture.logsView, fixture.filtersView, fixture.contentArea);
    savedViewMode = state.viewMode;
  });

  afterEach(() => {
    removeDashboardFixture(fixture);
    state.viewMode = savedViewMode;
  });

  it('shows the logs view and hides the filters view in "logs" mode', () => {
    state.viewMode = 'logs';
    applyViewMode(true);
    assert.isTrue(fixture.logsView.classList.contains('visible'));
    assert.isFalse(fixture.filtersView.classList.contains('visible'));
  });

  it('shows both views and marks contentArea split in "split" mode', () => {
    state.viewMode = 'split';
    applyViewMode(true);
    assert.isTrue(fixture.logsView.classList.contains('visible'));
    assert.isTrue(fixture.filtersView.classList.contains('visible'));
    assert.isTrue(fixture.contentArea.classList.contains('split'));
  });

  it('setViewMode updates state, persists the view mode, and calls the saveStateToURL callback', () => {
    let saved = false;
    setViewMode('logs', () => { saved = true; });
    assert.strictEqual(state.viewMode, 'logs');
    assert.isTrue(saved);
  });

  it('cycleViewMode and its deprecated toggleLogsView alias advance to a different mode', () => {
    state.viewMode = 'filters';
    let saved = false;
    cycleViewMode(() => { saved = true; });
    assert.notStrictEqual(state.viewMode, 'filters');
    assert.isTrue(saved);

    const modeAfterCycle = state.viewMode;
    toggleLogsView(() => {});
    assert.notStrictEqual(state.viewMode, modeAfterCycle);
  });

  it('invokes the registered onShowLogsView callback via requestAnimationFrame when switching to logs', async () => {
    let called = false;
    setOnShowLogsView(() => { called = true; });
    state.viewMode = 'logs';
    state.logsReady = false;
    applyViewMode(false);
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    assert.isTrue(called);
    setOnShowLogsView(null);
  });

  it('invokes the registered onShowFiltersView callback via requestAnimationFrame when not in logs mode', async () => {
    let called = false;
    setOnShowFiltersView(() => { called = true; });
    state.viewMode = 'filters';
    applyViewMode(false);
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    assert.isTrue(called);
    setOnShowFiltersView(null);
  });
});

describe('copyLogRow', () => {
  let savedLogsData;
  let originalWriteText;

  beforeEach(() => {
    savedLogsData = state.logsData;
    originalWriteText = navigator.clipboard.writeText;
  });

  afterEach(() => {
    state.logsData = savedLogsData;
    navigator.clipboard.writeText = originalWriteText;
  });

  it('copies the row as nested JSON, expanding dotted columns and dropping empty values', async () => {
    let copied = '';
    navigator.clipboard.writeText = async (text) => { copied = text; };
    state.logsData = [{
      timestamp: '2026-07-08T12:00:00.000Z',
      'request.host': 'admin.da.live',
      'request.url': '',
      script_name: 'da-admin',
    }];

    copyLogRow(0);
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    const parsed = JSON.parse(copied);
    assert.strictEqual(parsed.request.host, 'admin.da.live');
    assert.strictEqual(parsed.script_name, 'da-admin');
    assert.notProperty(parsed.request, 'url');
  });

  it('does nothing for an out-of-range row index', () => {
    state.logsData = [{ script_name: 'da-admin' }];
    assert.doesNotThrow(() => copyLogRow(5));
  });

  it('logs an error instead of throwing when the clipboard write is rejected', async () => {
    navigator.clipboard.writeText = async () => { throw new Error('clipboard blocked'); };
    state.logsData = [{ script_name: 'da-admin' }];

    assert.doesNotThrow(() => copyLogRow(0));
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  });
});

describe('loadLogs', () => {
  let fixture;
  let originalFetch;
  let savedCredentials;
  let savedLogsData;

  beforeEach(() => {
    fixture = buildDashboardFixture();
    setLogsElements(fixture.logsView, fixture.filtersView, fixture.contentArea);
    originalFetch = window.fetch;
    savedCredentials = state.credentials;
    savedLogsData = state.logsData;
    state.credentials = { user: 'testuser', password: 'testpass' };
  });

  afterEach(() => {
    window.fetch = originalFetch;
    state.credentials = savedCredentials;
    state.logsData = savedLogsData;
    removeDashboardFixture(fixture);
  });

  it('renders fetched rows into the logs table', async () => {
    window.fetch = async (url) => {
      if (url.endsWith('.sql')) {
        return { ok: true, status: 200, text: async () => 'SELECT * FROM logs' };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ timestamp: '2026-07-08T12:00:00.000Z', script_name: 'da-admin' }] }),
      };
    };

    await loadLogs();

    assert.include(fixture.container.textContent, 'da-admin');
    assert.isTrue(state.logsReady);
  });

  it('shows an error message when the query fails', async () => {
    window.fetch = async (url) => {
      if (url.endsWith('.sql')) {
        return { ok: true, status: 200, text: async () => 'SELECT * FROM logs' };
      }
      return { ok: false, status: 500, text: async () => 'DB::Exception: boom' };
    };

    await loadLogs();

    assert.include(fixture.container.textContent, 'Error loading logs');
  });
});
