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
/**
 * @typedef {Object} ActionHandlers
 * @property {(col: string) => void} togglePinnedColumn
 * @property {Function} addFilter - (col, value, exclude, filterCol?, filterValue?, filterOp?)
 * @property {(index: number) => void} removeFilter
 * @property {(col: string, value: string, skipReload?: boolean) => void} removeFilterByValue
 * @property {(col: string, value: string) => Object|undefined} getFilterForValue
 * @property {(col: string) => void} clearFiltersForColumn
 * @property {() => void} increaseTopN
 * @property {(facetId: string) => void} toggleFacetPin
 * @property {(facetId: string) => void} toggleFacetHide
 * @property {(modeKey: string) => void} toggleFacetMode
 * @property {() => void} closeQuickLinksModal
 * @property {(el: HTMLElement) => void} closeDialog
 * @property {Function} openFacetSearch - (col, facetId, filterCol, title)
 * @property {(facetId: string) => Promise<void>} copyFacetTsv
 */

/**
 * Handle add-filter action
 */
function handleAddFilter(handlers, target, event) {
  const exclude = event.shiftKey || target.dataset.exclude === 'true';
  handlers.addFilter?.(
    target.dataset.col || '',
    target.dataset.value || '',
    exclude,
    target.dataset.filterCol,
    target.dataset.filterValue,
    target.dataset.filterOp,
  );
}

/**
 * Handle remove-filter action
 */
function handleRemoveFilter(handlers, target) {
  const index = Number.parseInt(target.dataset.index || '', 10);
  if (!Number.isNaN(index)) {
    handlers.removeFilter?.(index);
  }
}

/**
 * Handle remove-filter-value action (toggle off).
 */
function handleRemoveFilterValue(handlers, target) {
  const col = target.dataset.col || '';
  const value = target.dataset.value || '';
  handlers.removeFilterByValue?.(col, value);
}

/**
 * Handle open-facet-search action
 */
function handleOpenFacetSearch(handlers, target, event) {
  event.preventDefault();
  handlers.openFacetSearch?.(
    target.dataset.col || '',
    target.dataset.facetId || '',
    target.dataset.filterCol || '',
    target.dataset.title || '',
  );
}

/**
 * Initialize delegated click handlers for UI actions.
 * @param {ActionHandlers} handlers
 */
export function initActionHandlers(handlers) {
  document.addEventListener('click', (event) => {
    if (event.target.closest('.filter-tag-indicator:not(.active):not(.exclude) a')) return;
    if (event.target.closest('.filter-tag-indicator.active a, .filter-tag-indicator.exclude a')) {
      event.preventDefault();
    }

    const target = event.target.closest('[data-action]');
    if (!target) return;

    const { action } = target.dataset;
    if (!action) return;

    event.stopPropagation();

    const simpleActions = {
      'toggle-pinned-column': () => handlers.togglePinnedColumn?.(target.dataset.col || ''),
      'clear-facet': () => handlers.clearFiltersForColumn?.(target.dataset.col || ''),
      'increase-topn': () => handlers.increaseTopN?.(),
      'toggle-facet-pin': () => handlers.toggleFacetPin?.(target.dataset.facet || ''),
      'toggle-facet-hide': () => handlers.toggleFacetHide?.(target.dataset.facet || ''),
      'toggle-facet-mode': () => handlers.toggleFacetMode?.(target.dataset.mode || ''),
      'close-quick-links': () => handlers.closeQuickLinksModal?.(),
      'close-dialog': () => handlers.closeDialog?.(target),
      'copy-facet-tsv': () => handlers.copyFacetTsv?.(target.dataset.facet || ''),
    };

    if (simpleActions[action]) {
      simpleActions[action]();
      return;
    }

    if (action === 'add-filter') {
      handleAddFilter(handlers, target, event);
    } else if (action === 'remove-filter') {
      handleRemoveFilter(handlers, target);
    } else if (action === 'remove-filter-value') {
      handleRemoveFilterValue(handlers, target);
    } else if (action === 'open-facet-search') {
      handleOpenFacetSearch(handlers, target, event);
    }
  });
}
