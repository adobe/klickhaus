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
import { attachColumnResize } from './column-resize.js';
import { state } from './state.js';

function buildTable() {
  const container = document.createElement('div');
  container.className = 'logs-table-container';
  container.innerHTML = `
    <table class="logs-table">
      <thead>
        <tr>
          <th data-action="toggle-pinned-column" data-col="timestamp">timestamp<span class="col-resize-handle" data-action="resize-column" data-col="timestamp"></span></th>
          <th data-action="toggle-pinned-column" data-col="request.url">url<span class="col-resize-handle" data-action="resize-column" data-col="request.url"></span></th>
        </tr>
      </thead>
      <tbody>
        <tr><td>2025-01-01</td><td>/foo</td></tr>
      </tbody>
    </table>
  `;
  document.body.appendChild(container);
  return container;
}

function fireMouse(target, type, clientX) {
  const ev = new MouseEvent(type, {
    bubbles: true, cancelable: true, clientX, clientY: 0, view: window,
  });
  target.dispatchEvent(ev);
  return ev;
}

describe('attachColumnResize', () => {
  let container;

  beforeEach(() => {
    state.logColumnWidths = {};
    container = buildTable();
  });

  afterEach(() => {
    container.remove();
    state.logColumnWidths = {};
  });

  it('updates td width during drag and persists on mouseup', () => {
    attachColumnResize(container);
    const handle = container.querySelector('.col-resize-handle');
    const th = handle.closest('th');
    // Force offsetWidth via inline width since JSDOM-style offsetWidth is 0
    th.style.width = '100px';
    Object.defineProperty(th, 'offsetWidth', { configurable: true, value: 100 });

    fireMouse(handle, 'mousedown', 200);
    fireMouse(window, 'mousemove', 250);

    const td = container.querySelector('tbody td');
    assert.strictEqual(td.style.width, '150px');
    assert.strictEqual(th.style.width, '150px');

    fireMouse(window, 'mouseup', 250);
    assert.strictEqual(state.logColumnWidths.timestamp, 150);
  });

  it('enforces minimum width of 40px', () => {
    attachColumnResize(container);
    const handle = container.querySelector('.col-resize-handle');
    const th = handle.closest('th');
    Object.defineProperty(th, 'offsetWidth', { configurable: true, value: 100 });

    fireMouse(handle, 'mousedown', 200);
    fireMouse(window, 'mousemove', 0); // way left
    fireMouse(window, 'mouseup', 0);

    assert.strictEqual(state.logColumnWidths.timestamp, 40);
  });

  it('stops mousedown from bubbling so pin-toggle does not fire', () => {
    attachColumnResize(container);
    const handle = container.querySelector('.col-resize-handle');
    const th = handle.closest('th');
    Object.defineProperty(th, 'offsetWidth', { configurable: true, value: 100 });

    let bubbled = false;
    th.addEventListener('mousedown', () => { bubbled = true; });

    fireMouse(handle, 'mousedown', 200);
    fireMouse(window, 'mouseup', 200);

    assert.isFalse(bubbled);
  });

  it('does not bind twice on the same container', () => {
    attachColumnResize(container);
    attachColumnResize(container);
    const handle = container.querySelector('.col-resize-handle');
    const th = handle.closest('th');
    Object.defineProperty(th, 'offsetWidth', { configurable: true, value: 100 });

    fireMouse(handle, 'mousedown', 200);
    fireMouse(window, 'mousemove', 220);
    fireMouse(window, 'mouseup', 220);
    // Width should be 120, not 140 (which would indicate double-bound listeners)
    assert.strictEqual(state.logColumnWidths.timestamp, 120);
  });

  it('double-click clears persisted width', () => {
    state.logColumnWidths.timestamp = 250;
    attachColumnResize(container);
    const handle = container.querySelector('.col-resize-handle');

    const ev = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
    handle.dispatchEvent(ev);

    assert.notProperty(state.logColumnWidths, 'timestamp');
  });
});
