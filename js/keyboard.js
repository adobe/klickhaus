// Keyboard navigation mode for vim-style navigation
import { state } from './state.js';
import { clearAllFilters } from './filters.js';

// Keyboard navigation state
const kbd = {
  active: false,
  facetIndex: 0,
  valueIndex: 0,
  lastC: 0  // timestamp for cc detection
};

// Get visible facet cards (not hidden)
function getFacets() {
  return [...document.querySelectorAll('.breakdown-card:not(.hidden)')];
}

// Get value rows in a facet
function getValues(facet) {
  if (!facet) return [];
  return [...facet.querySelectorAll('.breakdown-table tr[tabindex]')];
}

// Activate keyboard mode
function activateKeyboardMode() {
  if (kbd.active) return;
  kbd.active = true;
  document.body.classList.add('keyboard-mode');

  // Focus first facet if no focus yet
  const facets = getFacets();
  if (facets.length > 0) {
    kbd.facetIndex = 0;
    kbd.valueIndex = 0;
    updateFocus();
  }
}

// Deactivate keyboard mode
function deactivateKeyboardMode() {
  kbd.active = false;
  document.body.classList.remove('keyboard-mode');
  clearFocusClasses();
}

// Clear all focus-related classes
function clearFocusClasses() {
  document.querySelectorAll('.kbd-focused, .kbd-prev, .kbd-next, .kbd-prev-facet, .kbd-next-facet').forEach(el => {
    el.classList.remove('kbd-focused', 'kbd-prev', 'kbd-next', 'kbd-prev-facet', 'kbd-next-facet');
  });
}

// Update focus display
function updateFocus() {
  clearFocusClasses();

  const facets = getFacets();
  if (facets.length === 0) return;

  // Clamp indices
  kbd.facetIndex = Math.max(0, Math.min(facets.length - 1, kbd.facetIndex));
  const facet = facets[kbd.facetIndex];
  facet.classList.add('kbd-focused');

  // Mark adjacent facets for j/k hints
  if (kbd.facetIndex > 0) {
    facets[kbd.facetIndex - 1].classList.add('kbd-prev-facet');
  }
  if (kbd.facetIndex < facets.length - 1) {
    facets[kbd.facetIndex + 1].classList.add('kbd-next-facet');
  }

  const values = getValues(facet);
  if (values.length === 0) return;

  kbd.valueIndex = Math.max(0, Math.min(values.length - 1, kbd.valueIndex));
  const row = values[kbd.valueIndex];
  row.classList.add('kbd-focused');

  // Mark adjacent rows for h/l hints
  if (kbd.valueIndex > 0) {
    values[kbd.valueIndex - 1].classList.add('kbd-prev');
  }
  if (kbd.valueIndex < values.length - 1) {
    values[kbd.valueIndex + 1].classList.add('kbd-next');
  }

  // Set native focus (keeps Tab in sync)
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// Navigate between facets (j/k)
function moveFacet(delta) {
  const facets = getFacets();
  kbd.facetIndex = Math.max(0, Math.min(facets.length - 1, kbd.facetIndex + delta));
  kbd.valueIndex = 0;  // Reset to first value in new facet
  updateFocus();
}

// Navigate between values (h/l)
function moveValue(delta) {
  const facets = getFacets();
  const values = getValues(facets[kbd.facetIndex]);

  const newIndex = kbd.valueIndex + delta;

  // Wrap to next/prev facet if at boundary
  if (newIndex < 0 && kbd.facetIndex > 0) {
    kbd.facetIndex--;
    const newValues = getValues(facets[kbd.facetIndex]);
    kbd.valueIndex = newValues.length - 1;
  } else if (newIndex >= values.length && kbd.facetIndex < facets.length - 1) {
    kbd.facetIndex++;
    kbd.valueIndex = 0;
  } else {
    kbd.valueIndex = Math.max(0, Math.min(values.length - 1, newIndex));
  }

  updateFocus();
}

// Toggle filter on current value
function toggleFilterCurrent() {
  const row = document.querySelector('.breakdown-table tr.kbd-focused');
  if (!row) return;

  // Find and click the filter button (in the count cell)
  const filterBtn = row.querySelector('.count .action-btn');
  if (filterBtn) {
    filterBtn.click();
  }
}

// Toggle exclude on current value
function toggleExcludeCurrent() {
  const row = document.querySelector('.breakdown-table tr.kbd-focused');
  if (!row) return;

  // Find and click the exclude button (in the bar cell)
  const excludeBtn = row.querySelector('.bar .action-btn');
  if (excludeBtn) {
    excludeBtn.click();
  }
}

// Handle 'c' key - single c toggles filter, double cc clears all
function handleC() {
  const now = Date.now();
  if (now - kbd.lastC < 400) {
    // cc - clear all filters
    clearAllFilters();
    kbd.lastC = 0;
  } else {
    kbd.lastC = now;
    // Single c - toggle filter (same as i)
    toggleFilterCurrent();
  }
}

// Handle '.' key - click (other) row to expand
function handleDot() {
  const row = document.querySelector('.breakdown-table tr.kbd-focused');
  if (row && row.classList.contains('other-row')) {
    row.click();
  }
}

// Select time range by number key (1-5)
function selectTimeRange(num) {
  const select = document.getElementById('timeRange');
  const index = parseInt(num) - 1;
  if (index >= 0 && index < select.options.length) {
    select.selectedIndex = index;
    select.dispatchEvent(new Event('change'));
  }
}

// Initialize keyboard navigation
export function initKeyboardNavigation() {
  // Main keydown handler
  document.addEventListener('keydown', (e) => {
    // Ignore if in input field or dialog is open
    if (e.target.matches('input, textarea, select')) return;
    if (document.querySelector('dialog[open]:not(#keyboardHelp)')) return;

    // ? and / toggle help overlay
    if (e.key === '?' || e.key === '/') {
      e.preventDefault();
      const helpDialog = document.getElementById('keyboardHelp');
      if (helpDialog.open) {
        helpDialog.close();
      } else {
        helpDialog.showModal();
      }
      return;
    }

    // If keyboard help is open, only handle Escape
    if (document.getElementById('keyboardHelp').open) {
      if (e.key === 'Escape') {
        document.getElementById('keyboardHelp').close();
      }
      return;
    }

    // Navigation and action keys activate keyboard mode
    const navKeys = ['j', 'k', 'h', 'l', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    const actionKeys = ['i', 'c', 'e', 'x', ' ', 'Enter', '.', 'r', 'f', 't', '1', '2', '3', '4', '5'];

    if (navKeys.includes(e.key) || actionKeys.includes(e.key)) {
      if (!kbd.active) {
        activateKeyboardMode();
      }
    }

    // Handle shortcuts
    switch(e.key) {
      case 'j':
      case 'ArrowDown':
        e.preventDefault();
        moveFacet(1);
        break;
      case 'k':
      case 'ArrowUp':
        e.preventDefault();
        moveFacet(-1);
        break;
      case 'h':
      case 'ArrowLeft':
        e.preventDefault();
        moveValue(-1);
        break;
      case 'l':
      case 'ArrowRight':
        e.preventDefault();
        moveValue(1);
        break;
      case 'i':
      case ' ':
      case 'Enter':
        if (e.key !== 'Enter' || kbd.active) {
          e.preventDefault();
          toggleFilterCurrent();
        }
        break;
      case 'e':
      case 'x':
        e.preventDefault();
        toggleExcludeCurrent();
        break;
      case 'c':
        e.preventDefault();
        handleC();
        break;
      case '.':
        e.preventDefault();
        handleDot();
        break;
      case 'r':
        e.preventDefault();
        document.getElementById('refreshBtn').click();
        break;
      case 'f':
        e.preventDefault();
        deactivateKeyboardMode();
        document.getElementById('hostFilter').focus();
        break;
      case 't':
        e.preventDefault();
        document.getElementById('logsBtn').click();
        break;
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
        e.preventDefault();
        selectTimeRange(e.key);
        break;
      case 'Escape':
        e.preventDefault();
        deactivateKeyboardMode();
        break;
    }
  });

  // Deactivate on mouse click (but not on action buttons)
  document.addEventListener('mousedown', (e) => {
    if (kbd.active && !e.target.closest('.action-btn, .mobile-action-btn, button, a, select, input')) {
      deactivateKeyboardMode();
    }
  });

  // Sync state when Tab focuses a row
  document.addEventListener('focusin', (e) => {
    const row = e.target.closest('.breakdown-table tr[tabindex]');
    if (!row) return;

    // Activate keyboard mode
    if (!kbd.active) {
      kbd.active = true;
      document.body.classList.add('keyboard-mode');
    }

    // Find which facet/value is now focused
    const facet = row.closest('.breakdown-card');
    const facets = getFacets();
    const facetIdx = facets.indexOf(facet);
    if (facetIdx >= 0) {
      kbd.facetIndex = facetIdx;
      kbd.valueIndex = parseInt(row.dataset.valueIndex) || 0;
      updateFocus();
    }
  });
}

// Re-apply focus after data reload
export function restoreKeyboardFocus() {
  if (kbd.active) {
    // Small delay to let DOM update
    requestAnimationFrame(() => {
      updateFocus();
    });
  }
}
