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
import { togglePinnedFacet, toggleHiddenFacet } from './state.js';
import { clearAllFilters, updateHeaderFixed } from './filters.js';
import { openFacetPalette, isPaletteOpen, setOnFacetNavigate } from './facet-palette.js';
import { zoomToAnomaly, zoomToAnomalyByRank, getAnomalyCount } from './chart.js';
import { zoomOut } from './time.js';
import { saveStateToURL } from './url-state.js';
import { openFacetSearch } from './ui/facet-search.js';

// Keyboard navigation state
const kbd = {
  active: false,
  facetIndex: 0,
  valueIndex: 0,
  lastC: 0, // timestamp for cc detection
};

// Optional external callbacks
let onToggleFacetMode = null;
let onReloadDashboard = null;

// Get visible facet cards (not hidden)
function getFacets() {
  return [...document.querySelectorAll('.breakdown-card:not(.hidden)')];
}

// Get value rows in a facet
function getValues(facet) {
  if (!facet) return [];
  return [...facet.querySelectorAll('.breakdown-table tr[tabindex]')];
}

// Clear all focus-related classes
function clearFocusClasses() {
  document.querySelectorAll('.kbd-focused, .kbd-prev, .kbd-next, .kbd-prev-facet, .kbd-next-facet').forEach((el) => {
    el.classList.remove('kbd-focused', 'kbd-prev', 'kbd-next', 'kbd-prev-facet', 'kbd-next-facet');
  });
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

    // Also save value index if not 0 (to keep URLs cleaner)
    if (kbd.valueIndex > 0) {
      params.set('v', kbd.valueIndex.toString());
    }
  }
  // If facetIndex is -1 (chart), don't set 'f' parameter

  if (kbd.active) params.set('kbd', '1');

  const fragment = params.toString();
  const newUrl = fragment ? `#${fragment}` : window.location.pathname + window.location.search;

  // Use replaceState to avoid polluting history
  history.replaceState(null, '', newUrl);
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

  // Mark adjacent facets for h/l hints
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

  // Mark adjacent rows for j/k hints
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

// Navigate between facets (h/l)
function moveFacet(delta) {
  const facets = getFacets();
  kbd.facetIndex = Math.max(0, Math.min(facets.length - 1, kbd.facetIndex + delta));
  kbd.valueIndex = 0; // Reset to first value in new facet
  updateFocus();
}

// Navigate between values (j/k)
function moveValue(delta) {
  const facets = getFacets();
  const values = getValues(facets[kbd.facetIndex]);

  const newIndex = kbd.valueIndex + delta;

  // Wrap to next/prev facet if at boundary
  if (newIndex < 0 && kbd.facetIndex > 0) {
    kbd.facetIndex -= 1;
    const newValues = getValues(facets[kbd.facetIndex]);
    kbd.valueIndex = newValues.length - 1;
  } else if (newIndex >= values.length && kbd.facetIndex < facets.length - 1) {
    kbd.facetIndex += 1;
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

// Open link in current value (if exists)
function openCurrentLink() {
  const row = document.querySelector('.breakdown-table tr.kbd-focused');
  if (!row) return;

  // Find the link in the dim cell
  const link = row.querySelector('td.dim a[href]');
  if (link) {
    window.open(link.href, '_blank', 'noopener');
  }
}

// Toggle pin on current facet
function togglePinCurrentFacet() {
  const facet = document.querySelector('.breakdown-card.kbd-focused');
  if (facet) {
    togglePinnedFacet(facet.id);
  }
}

// Toggle hide on current facet
function toggleHideCurrentFacet() {
  const facet = document.querySelector('.breakdown-card.kbd-focused');
  if (facet) {
    toggleHiddenFacet(facet.id);
  }
}

// Open facet search for current facet
function openFacetSearchForCurrentFacet() {
  const facet = document.querySelector('.breakdown-card.kbd-focused');
  if (!facet) return;

  // Find the search link which contains all the needed data attributes
  const searchLink = facet.querySelector('.facet-search-link[data-action="open-facet-search"]');
  if (searchLink) {
    openFacetSearch(
      searchLink.dataset.col || '',
      searchLink.dataset.facetId || '',
      searchLink.dataset.filterCol || '',
      searchLink.dataset.title || '',
    );
  }
}

// Zoom to anomaly by number key (1-5)
function zoomToAnomalyNumber(num) {
  const rank = parseInt(num, 10);
  if (rank >= 1 && rank <= getAnomalyCount()) {
    zoomToAnomalyByRank(rank);
  }
}

// Set focused facet by element ID (used by facet palette)
// Optionally pass a value to pre-select a specific row
export function setFocusedFacet(facetId, targetValue = null) {
  const facets = getFacets();
  const index = facets.findIndex((f) => f.id === facetId);
  if (index >= 0) {
    kbd.facetIndex = index;
    kbd.valueIndex = 0;

    // If a target value is provided, find the row with that value
    if (targetValue) {
      const facet = facets[index];
      const values = getValues(facet);
      for (let i = 0; i < values.length; i += 1) {
        const dimCell = values[i].querySelector('td.dim');
        if (dimCell) {
          const rowValue = dimCell.textContent.trim().toLowerCase();
          if (rowValue === targetValue.toLowerCase()) {
            kbd.valueIndex = i;
            break;
          }
        }
      }
    }

    if (!kbd.active) {
      activateKeyboardMode();
    } else {
      updateFocus();
    }
  }
}

// Check if keydown event should be ignored
function shouldIgnoreKeydown(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  if (e.target.matches('input, textarea, select')) return true;
  if (document.querySelector('dialog[open]:not(#keyboardHelp):not(#facetPalette)')) return true;
  if (isPaletteOpen()) return true;
  return false;
}

// Handle help dialog toggle
function handleHelpDialog(key) {
  if (key === '?' || key === '/') {
    const helpDialog = document.getElementById('keyboardHelp');
    if (helpDialog.open) helpDialog.close();
    else helpDialog.showModal();
    return true;
  }
  if (document.getElementById('keyboardHelp').open) {
    if (key === 'Escape') document.getElementById('keyboardHelp').close();
    return true;
  }
  return false;
}

// Navigation key handlers
const NAV_HANDLERS = {
  j: () => moveValue(1),
  ArrowDown: () => moveValue(1),
  k: () => moveValue(-1),
  ArrowUp: () => moveValue(-1),
  h: () => moveFacet(-1),
  ArrowLeft: () => moveFacet(-1),
  l: () => moveFacet(1),
  ArrowRight: () => moveFacet(1),
};

// Action key handlers
const ACTION_HANDLERS = {
  i: () => toggleFilterCurrent(),
  ' ': () => toggleFilterCurrent(),
  e: () => toggleExcludeCurrent(),
  x: () => toggleExcludeCurrent(),
  c: () => handleC(),
  '.': () => handleDot(),
  g: () => openFacetPalette(),
  o: () => openCurrentLink(),
  p: () => togglePinCurrentFacet(),
  d: () => toggleHideCurrentFacet(),
  r: () => document.getElementById('refreshBtn').click(),
  s: () => openFacetSearchForCurrentFacet(),
  t: () => document.getElementById('viewToggleBtn').click(),
  Escape: () => deactivateKeyboardMode(),
  '+': () => zoomToAnomaly(),
  '=': () => zoomToAnomaly(),
  '-': () => {
    if (zoomOut()) {
      saveStateToURL();
      if (onReloadDashboard) onReloadDashboard();
    }
  },
};

// Handle keyboard shortcut
function handleKeyboardShortcut(e) {
  const { key } = e;

  // Navigation keys
  if (NAV_HANDLERS[key]) {
    e.preventDefault();
    NAV_HANDLERS[key]();
    return;
  }

  // Action keys
  if (ACTION_HANDLERS[key]) {
    e.preventDefault();
    ACTION_HANDLERS[key]();
    return;
  }

  // Special cases
  if (key === 'Enter' && kbd.active) {
    e.preventDefault();
    toggleFilterCurrent();
  } else if (key === 'f') {
    e.preventDefault();
    deactivateKeyboardMode();
    document.getElementById('hostFilter').focus();
  } else if (key === 'b' || key === '#') {
    e.preventDefault();
    if (onToggleFacetMode) onToggleFacetMode('contentTypeMode');
  } else if (key >= '1' && key <= '5') {
    e.preventDefault();
    zoomToAnomalyNumber(key);
  }
}

// Initialize keyboard navigation
export function initKeyboardNavigation({ toggleFacetMode, reloadDashboard } = {}) {
  onToggleFacetMode = toggleFacetMode || null;
  onReloadDashboard = reloadDashboard || null;

  setOnFacetNavigate(setFocusedFacet);

  const navKeys = ['j', 'k', 'h', 'l', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  const actionKeys = ['i', 'c', 'e', 'x', ' ', 'Enter', '.', 'r', 'f', 't', 'b', '#', 'g', 'o', 'p', 'd', '1', '2', '3', '4', '5', '+', '-', '='];

  document.addEventListener('keydown', (e) => {
    if (shouldIgnoreKeydown(e)) return;
    if (handleHelpDialog(e.key)) {
      e.preventDefault();
      return;
    }

    if ((navKeys.includes(e.key) || actionKeys.includes(e.key)) && !kbd.active) {
      activateKeyboardMode();
    }

    handleKeyboardShortcut(e);
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
    setTimeout(() => {
      recentMouseDown = false;
    }, 100);
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
        kbd.valueIndex = parseInt(row.dataset.valueIndex, 10) || 0;
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

// Get the currently focused facet ID (for targeted restore)
export function getFocusedFacetId() {
  if (!kbd.active) return null;
  const facets = getFacets();
  if (kbd.facetIndex >= 0 && kbd.facetIndex < facets.length) {
    return facets[kbd.facetIndex].id;
  }
  return null;
}

// Track visible facets using IntersectionObserver
const visibleFacets = new Set();
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
  for (let i = 0; i < facets.length; i += 1) {
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
  const valueIndex = parseInt(params.get('v'), 10) || 0;
  const kbdMode = params.get('kbd') === '1';

  if (facetId) {
    const facets = getFacets();
    const index = facets.findIndex((f) => f.id === `breakdown-${facetId}`);
    if (index >= 0) {
      kbd.facetIndex = index;
      kbd.valueIndex = valueIndex;

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
    entries.forEach((entry) => {
      chartVisible = entry.isIntersecting;
      updateFromIntersection();
    });
  }, {
    rootMargin: '-70px 0px 0px 0px', // Account for header
    threshold: 0.1,
  });

  // Observer for facet cards - tight band near scroll-snap position
  // scroll-padding-top is 70px, scroll-margin-top on cards is 16px
  // So snapped card top is at ~86px from viewport top
  // Use a narrow band from 70px to ~20% down to detect only the snapped row
  facetObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        visibleFacets.add(entry.target);
      } else {
        visibleFacets.delete(entry.target);
      }
    });
    updateFromIntersection();
  }, {
    rootMargin: '-86px 0px -80% 0px', // Narrow band at snap position
    threshold: 0,
  });

  // Observe chart section
  const chart = document.querySelector('.chart-section');
  if (chart) {
    chartObserver.observe(chart);
  }

  // Observe all facet cards
  getFacets().forEach((facet) => {
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
  getFacets().forEach((facet) => {
    facetObserver.observe(facet);
  });
}
