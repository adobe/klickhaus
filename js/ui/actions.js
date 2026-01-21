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
        handlers.addFilter?.(
          target.dataset.col || '',
          target.dataset.value || '',
          target.dataset.exclude === 'true',
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
        handlers.removeFilterByValue?.(target.dataset.col || '', target.dataset.value || '');
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
      default:
        break;
    }
  });
}
