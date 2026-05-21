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
import { state, saveLogColumnPrefs } from './state.js';
import { escapeHtml } from './utils.js';
import { LOG_COLUMN_ORDER, LOG_COLUMN_SHORT_LABELS } from './columns.js';

let dialog = null;
let inUse = []; // columns currently shown, in order
let available = []; // columns hidden

function getAllColumns() {
  if (state.logsData && state.logsData.length > 0) {
    return Object.keys(state.logsData[0]);
  }
  return [];
}

function computeInitialPartition() {
  const all = getAllColumns();
  const hidden = new Set(state.hiddenLogColumns || []);
  const baseOrder = state.userLogColumnOrder ?? state.logColumnOrder ?? LOG_COLUMN_ORDER;
  const visible = all.filter((c) => !hidden.has(c));
  const orderedVisible = [
    ...baseOrder.filter((c) => visible.includes(c)),
    ...visible.filter((c) => !baseOrder.includes(c)),
  ];
  const hiddenList = all.filter((c) => hidden.has(c));
  return { inUse: orderedVisible, available: hiddenList };
}

function buildItemHtml(col, panel) {
  const label = LOG_COLUMN_SHORT_LABELS[col] || col;
  const remove = panel === 'inUse'
    ? '<button type="button" class="manage-cols-remove" data-action="hide" aria-label="Hide">×</button>'
    : '';
  return `
    <div class="manage-cols-item" draggable="true" data-col="${escapeHtml(col)}" data-panel="${panel}">
      <span class="manage-cols-handle" aria-hidden="true">⋮⋮</span>
      <span class="manage-cols-label" title="${escapeHtml(col)}">${escapeHtml(label)}</span>
      ${remove}
    </div>
  `;
}

function renderList(panel) {
  const list = dialog.querySelector(`[data-list="${panel}"]`);
  const search = dialog.querySelector(`[data-search="${panel}"]`).value.trim().toLowerCase();
  const cols = panel === 'inUse' ? inUse : available;
  const filtered = search
    ? cols.filter((c) => c.toLowerCase().includes(search)
      || (LOG_COLUMN_SHORT_LABELS[c] || '').toLowerCase().includes(search))
    : cols;
  if (filtered.length === 0) {
    list.innerHTML = `<div class="manage-cols-empty">${search ? 'No matches' : 'No columns'}</div>`;
    return;
  }
  list.innerHTML = filtered.map((c) => buildItemHtml(c, panel)).join('');
}

function rerender() {
  renderList('inUse');
  renderList('available');
}

function findInsertIndex(list, panel, clientY) {
  const items = Array.from(list.querySelectorAll('.manage-cols-item'));
  for (let i = 0; i < items.length; i += 1) {
    const rect = items[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      return { index: i, panel };
    }
  }
  return { index: items.length, panel };
}

function clearDropMarkers() {
  dialog.querySelectorAll('.drop-target-above, .drop-target-below').forEach((el) => {
    el.classList.remove('drop-target-above', 'drop-target-below');
  });
}

function attachDragHandlers() {
  let dragged = null;

  dialog.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.manage-cols-item');
    if (!item) { return; }
    dragged = { col: item.dataset.col, panel: item.dataset.panel };
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.dataset.col);
  });

  dialog.addEventListener('dragend', (e) => {
    const item = e.target.closest('.manage-cols-item');
    if (item) { item.classList.remove('dragging'); }
    clearDropMarkers();
    dragged = null;
  });

  dialog.addEventListener('dragover', (e) => {
    const list = e.target.closest('[data-list]');
    if (!list || !dragged) { return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropMarkers();
    const targetPanel = list.dataset.list;
    const items = Array.from(list.querySelectorAll('.manage-cols-item'));
    const { index } = findInsertIndex(list, targetPanel, e.clientY);
    if (items[index]) {
      items[index].classList.add('drop-target-above');
    } else if (items[index - 1]) {
      items[index - 1].classList.add('drop-target-below');
    }
  });

  dialog.addEventListener('drop', (e) => {
    if (!dragged) { return; }
    const list = e.target.closest('[data-list]');
    if (!list) { return; }
    e.preventDefault();
    const targetPanel = list.dataset.list;
    const { index } = findInsertIndex(list, targetPanel, e.clientY);

    // Remove from source list
    const sourceList = dragged.panel === 'inUse' ? inUse : available;
    const srcIdx = sourceList.indexOf(dragged.col);
    if (srcIdx >= 0) { sourceList.splice(srcIdx, 1); }

    // Insert into destination list (clamp index if same list)
    const destList = targetPanel === 'inUse' ? inUse : available;
    let insertAt = index;
    if (dragged.panel === targetPanel && srcIdx >= 0 && srcIdx < index) {
      insertAt = index - 1;
    }
    destList.splice(Math.max(0, Math.min(insertAt, destList.length)), 0, dragged.col);

    clearDropMarkers();
    dragged = null;
    rerender();
  });
}

function buildDialog() {
  if (dialog) { return dialog; }
  dialog = document.createElement('dialog');
  dialog.id = 'manageColumnsModal';
  dialog.innerHTML = `
    <div class="manage-cols-header">
      <h2>Manage Columns</h2>
      <button type="button" class="modal-close" data-action="close" aria-label="Close">×</button>
    </div>
    <div class="manage-cols-body">
      <div class="manage-cols-panel">
        <h3>Available Fields</h3>
        <input type="text" class="manage-cols-search" data-search="available" placeholder="Search fields" autocomplete="off">
        <div class="manage-cols-list" data-list="available"></div>
      </div>
      <div class="manage-cols-panel">
        <h3>In Use</h3>
        <input type="text" class="manage-cols-search" data-search="inUse" placeholder="Search fields" autocomplete="off">
        <div class="manage-cols-list" data-list="inUse"></div>
      </div>
    </div>
    <div class="manage-cols-footer">
      <button type="button" class="manage-cols-btn" data-action="cancel">Cancel</button>
      <button type="button" class="manage-cols-btn primary" data-action="apply">Apply</button>
    </div>
  `;
  document.body.appendChild(dialog);

  dialog.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) { return; }
    const { action } = target.dataset;
    if (action === 'close' || action === 'cancel') {
      dialog.close();
    } else if (action === 'apply') {
      saveLogColumnPrefs(inUse, available);
      dialog.close();
    } else if (action === 'hide') {
      const item = target.closest('.manage-cols-item');
      const { col } = item.dataset;
      const idx = inUse.indexOf(col);
      if (idx >= 0) {
        inUse.splice(idx, 1);
        available.push(col);
        rerender();
      }
    }
  });

  dialog.addEventListener('input', (e) => {
    if (e.target.matches('[data-search]')) {
      renderList(e.target.dataset.search);
    }
  });

  attachDragHandlers();
  return dialog;
}

export function openManageColumns() {
  buildDialog();
  const partition = computeInitialPartition();
  inUse = partition.inUse;
  available = partition.available;
  dialog.querySelectorAll('[data-search]').forEach((input) => {
    // eslint-disable-next-line no-param-reassign
    input.value = '';
  });
  rerender();
  dialog.showModal();
}
