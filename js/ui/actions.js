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
 * @property {(col: string, value: string) => void} removeFilterByValue
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
 * Initialize delegated click handlers for UI actions.
 * @param {ActionHandlers} handlers
 */
export function initActionHandlers(handlers) {
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const { action } = target.dataset;
    if (!action) return;

    switch (action) {
      case 'toggle-pinned-column': {
        event.stopPropagation();
        handlers.togglePinnedColumn?.(target.dataset.col || '');
        break;
      }
      case 'add-filter': {
        event.stopPropagation();
        // Shift+click skips straight to exclude
        const exclude = event.shiftKey || target.dataset.exclude === 'true';
        handlers.addFilter?.(
          target.dataset.col || '',
          target.dataset.value || '',
          exclude,
          target.dataset.filterCol,
          target.dataset.filterValue,
          target.dataset.filterOp,
        );
        break;
      }
      case 'remove-filter': {
        event.stopPropagation();
        const index = Number.parseInt(target.dataset.index || '', 10);
        if (!Number.isNaN(index)) {
          handlers.removeFilter?.(index);
        }
        break;
      }
      case 'remove-filter-value': {
        event.stopPropagation();
        const col = target.dataset.col || '';
        const value = target.dataset.value || '';

        // Cycle: include → exclude → none
        const existingFilter = handlers.getFilterForValue?.(col, value);
        if (existingFilter && !existingFilter.exclude) {
          // Include → Exclude: remove then add as exclude in a single reload
          handlers.removeFilterByValue?.(col, value, true);
          handlers.addFilter?.(
            col,
            value,
            true,
            target.dataset.filterCol,
            target.dataset.filterValue,
            target.dataset.filterOp,
          );
        } else {
          // Exclude → None (or fallback)
          handlers.removeFilterByValue?.(col, value);
        }
        break;
      }
      case 'clear-facet': {
        event.stopPropagation();
        handlers.clearFiltersForColumn?.(target.dataset.col || '');
        break;
      }
      case 'increase-topn': {
        event.stopPropagation();
        handlers.increaseTopN?.();
        break;
      }
      case 'toggle-facet-pin': {
        event.stopPropagation();
        handlers.toggleFacetPin?.(target.dataset.facet || '');
        break;
      }
      case 'toggle-facet-hide': {
        event.stopPropagation();
        handlers.toggleFacetHide?.(target.dataset.facet || '');
        break;
      }
      case 'toggle-facet-mode': {
        event.stopPropagation();
        handlers.toggleFacetMode?.(target.dataset.mode || '');
        break;
      }
      case 'close-quick-links': {
        event.stopPropagation();
        handlers.closeQuickLinksModal?.();
        break;
      }
      case 'close-dialog': {
        event.stopPropagation();
        handlers.closeDialog?.(target);
        break;
      }
      case 'open-facet-search': {
        event.preventDefault();
        event.stopPropagation();
        handlers.openFacetSearch?.(
          target.dataset.col || '',
          target.dataset.facetId || '',
          target.dataset.filterCol || '',
          target.dataset.title || '',
        );
        break;
      }
      case 'copy-facet-tsv': {
        event.stopPropagation();
        handlers.copyFacetTsv?.(target.dataset.facet || '');
        break;
      }
      default:
        break;
    }
  });
}
