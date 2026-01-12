// Keyboard navigation mode for vim-style navigation
import { state } from './state.js';
import { clearAllFilters, updateHeaderFixed } from './filters.js';

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
  updateHeaderFixed();

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
  updateHeaderFixed();
  clearFocusClasses();
  updateFragment();
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

  // Only scroll if facet is not fully visible in viewport
  const rect = facet.getBoundingClientRect();
  const headerHeight = 70;
  const viewportHeight = window.innerHeight;
  const isFullyVisible = rect.top >= headerHeight && rect.bottom <= viewportHeight;

  if (!isFullyVisible) {
    facet.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // Update URL fragment
  updateFragment();
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
    const actionKeys = ['i', 'c', 'e', 'x', ' ', 'Enter', '.', 'r', 'f', 't', 'b', '#', '1', '2', '3', '4', '5'];

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
      case 'b':
      case '#':
        e.preventDefault();
        if (window.toggleFacetMode) {
          window.toggleFacetMode('contentTypeMode');
        }
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

  // Track mouse activity to distinguish Tab focus from click focus
  let recentMouseDown = false;
  document.addEventListener('mousedown', () => {
    recentMouseDown = true;
    setTimeout(() => { recentMouseDown = false; }, 100);
  }, true);

  // Sync state when Tab focuses a row (not click)
  document.addEventListener('focusin', (e) => {
    const row = e.target.closest('.breakdown-table tr[tabindex]');
    if (!row) return;

    // Only activate keyboard mode for Tab navigation, not mouse clicks
    if (!recentMouseDown && !kbd.active) {
      kbd.active = true;
      document.body.classList.add('keyboard-mode');
      updateHeaderFixed();
    }

    // Find which facet/value is now focused (even for clicks, to sync state)
    if (kbd.active) {
      const facet = row.closest('.breakdown-card');
      const facets = getFacets();
      const facetIdx = facets.indexOf(facet);
      if (facetIdx >= 0) {
        kbd.facetIndex = facetIdx;
        kbd.valueIndex = parseInt(row.dataset.valueIndex) || 0;
        updateFocus();
      }
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

// Update URL fragment with current facet and keyboard state
function updateFragment() {
  const facets = getFacets();

  const params = new URLSearchParams();

  // -1 means chart is visible (top of page), otherwise get facet ID
  if (kbd.facetIndex >= 0 && kbd.facetIndex < facets.length) {
    const facet = facets[kbd.facetIndex];
    const facetId = facet?.id?.replace('breakdown-', '') || '';
    if (facetId) params.set('f', facetId);
  }
  // If facetIndex is -1 (chart), don't set 'f' parameter

  if (kbd.active) params.set('kbd', '1');

  const fragment = params.toString();
  const newUrl = fragment ? `#${fragment}` : window.location.pathname + window.location.search;

  // Use replaceState to avoid polluting history
  history.replaceState(null, '', newUrl);
}

// Track visible facets using IntersectionObserver
let visibleFacets = new Set();
let chartVisible = false;
let facetObserver = null;
let chartObserver = null;

// Update fragment based on intersection state
function updateFromIntersection() {
  // Skip if in keyboard mode (keyboard nav controls the focus)
  if (kbd.active) return;

  // If chart is visible, set facet index to -1
  if (chartVisible) {
    if (kbd.facetIndex !== -1) {
      kbd.facetIndex = -1;
      kbd.valueIndex = 0;
      updateFragment();
    }
    return;
  }

  // Find the topmost visible facet
  const facets = getFacets();
  let topmostIndex = -1;
  for (let i = 0; i < facets.length; i++) {
    if (visibleFacets.has(facets[i])) {
      topmostIndex = i;
      break;
    }
  }

  if (topmostIndex >= 0 && topmostIndex !== kbd.facetIndex) {
    kbd.facetIndex = topmostIndex;
    kbd.valueIndex = 0;
    updateFragment();
  }
}

// Restore state from URL fragment
function restoreFromFragment() {
  const hash = window.location.hash.slice(1);
  if (!hash) return false;

  const params = new URLSearchParams(hash);
  const facetId = params.get('f');
  const kbdMode = params.get('kbd') === '1';

  if (facetId) {
    const facets = getFacets();
    const index = facets.findIndex(f => f.id === `breakdown-${facetId}`);
    if (index >= 0) {
      kbd.facetIndex = index;
      kbd.valueIndex = 0;

      // Scroll to the facet
      const facet = facets[index];
      facet.scrollIntoView({ behavior: 'instant', block: 'start' });

      if (kbdMode) {
        kbd.active = true;
        document.body.classList.add('keyboard-mode');
        updateFocus();
      }
      return true;
    }
  }
  return false;
}

// Initialize scroll tracking with IntersectionObserver
export function initScrollTracking() {
  // Observer for chart section - triggers when chart enters/leaves viewport top
  chartObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      chartVisible = entry.isIntersecting;
      updateFromIntersection();
    });
  }, {
    rootMargin: '-70px 0px 0px 0px',  // Account for header
    threshold: 0.1
  });

  // Observer for facet cards - tight band near scroll-snap position
  // scroll-padding-top is 70px, scroll-margin-top on cards is 16px
  // So snapped card top is at ~86px from viewport top
  // Use a narrow band from 70px to ~20% down to detect only the snapped row
  facetObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        visibleFacets.add(entry.target);
      } else {
        visibleFacets.delete(entry.target);
      }
    });
    updateFromIntersection();
  }, {
    rootMargin: '-86px 0px -80% 0px',  // Narrow band at snap position
    threshold: 0
  });

  // Observe chart section
  const chart = document.querySelector('.chart-section');
  if (chart) {
    chartObserver.observe(chart);
  }

  // Observe all facet cards
  getFacets().forEach(facet => {
    facetObserver.observe(facet);
  });

  // Restore from fragment after a short delay (let facets render first)
  setTimeout(() => {
    restoreFromFragment();
  }, 500);
}

// Re-observe facets after data reload (in case DOM changed)
export function refreshFacetObservers() {
  if (!facetObserver) return;

  // Clear and re-observe
  visibleFacets.clear();
  getFacets().forEach(facet => {
    facetObserver.observe(facet);
  });
}
