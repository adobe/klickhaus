// Centralized click action handling (replaces inline onclick handlers)

/**
 * @typedef {Object} ActionHandlers
 * @property {(col: string) => void} togglePinnedColumn
 * @property {(col: string, value: string, exclude: boolean) => void} addFilter
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
        handlers.addFilter?.(target.dataset.col || '', target.dataset.value || '', target.dataset.exclude === 'true');
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
