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
import { setLogColumnWidth, resetLogColumnWidth } from './state.js';

const MIN_WIDTH = 40;

function applyWidthToColumn(table, columnIndex, width) {
  const px = `${width}px`;
  const head = table.querySelector('thead');
  if (head) {
    const th = head.querySelectorAll('th')[columnIndex];
    if (th) {
      th.style.width = px;
      th.style.minWidth = px;
      th.style.maxWidth = px;
    }
  }
  const rows = table.querySelectorAll('tbody tr');
  rows.forEach((row) => {
    const cell = row.children[columnIndex];
    if (cell) {
      cell.style.width = px;
      cell.style.minWidth = px;
      cell.style.maxWidth = px;
    }
  });
}

function clearWidthFromColumn(table, columnIndex) {
  const head = table.querySelector('thead');
  if (head) {
    const th = head.querySelectorAll('th')[columnIndex];
    if (th) {
      th.style.width = '';
      th.style.minWidth = '';
      th.style.maxWidth = '';
    }
  }
  const rows = table.querySelectorAll('tbody tr');
  rows.forEach((row) => {
    const cell = row.children[columnIndex];
    if (cell) {
      cell.style.width = '';
      cell.style.minWidth = '';
      cell.style.maxWidth = '';
    }
  });
}

/**
 * Attach drag-to-resize behavior to the logs table inside `container`.
 * Idempotent: safe to call after every re-render. Uses a flag on the
 * container to avoid binding twice.
 * @param {HTMLElement} container
 * @param {() => void} [onResize] Called after each width change (e.g. to refresh pinned offsets)
 */
export function attachColumnResize(container, onResize) {
  if (!container || container.dataset.colResizeBound === '1') { return; }
  // eslint-disable-next-line no-param-reassign
  container.dataset.colResizeBound = '1';

  container.addEventListener('mousedown', (event) => {
    const handle = event.target.closest('.col-resize-handle');
    if (!handle) { return; }
    const th = handle.closest('th');
    const table = handle.closest('.logs-table');
    if (!th || !table) { return; }

    event.preventDefault();
    event.stopPropagation();

    const { col } = handle.dataset;
    const headerCells = Array.from(table.querySelectorAll('thead th'));
    const columnIndex = headerCells.indexOf(th);
    if (columnIndex < 0) { return; }

    const startX = event.clientX;
    const startWidth = th.offsetWidth;
    let currentWidth = startWidth;

    handle.classList.add('resizing');
    document.body.classList.add('col-resizing');

    const onMove = (e) => {
      currentWidth = Math.max(MIN_WIDTH, startWidth + (e.clientX - startX));
      applyWidthToColumn(table, columnIndex, currentWidth);
      if (onResize) { onResize(); }
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      handle.classList.remove('resizing');
      document.body.classList.remove('col-resizing');
      if (currentWidth !== startWidth) {
        setLogColumnWidth(col, currentWidth);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, true);

  container.addEventListener('dblclick', (event) => {
    const handle = event.target.closest('.col-resize-handle');
    if (!handle) { return; }
    event.preventDefault();
    event.stopPropagation();

    const th = handle.closest('th');
    const table = handle.closest('.logs-table');
    if (!th || !table) { return; }
    const headerCells = Array.from(table.querySelectorAll('thead th'));
    const columnIndex = headerCells.indexOf(th);
    if (columnIndex < 0) { return; }

    clearWidthFromColumn(table, columnIndex);
    resetLogColumnWidth(handle.dataset.col);
  });
}
