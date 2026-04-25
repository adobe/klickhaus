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
import { formatQueryTime } from './format.js';

// Timer state
let queryTimerInterval = null;
let queryStartTime = null;
const queryTimerEl = document.getElementById('queryTimer');

// Track visible facets with IntersectionObserver
export const visibleFacets = new Set();

const facetObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      visibleFacets.add(entry.target.id);
    } else {
      visibleFacets.delete(entry.target.id);
    }
  });
}, { rootMargin: '50px' });

// Check if element is in viewport
function isInViewport(el) {
  const rect = el.getBoundingClientRect();
  return (
    rect.top < (window.innerHeight || document.documentElement.clientHeight) + 50
    && rect.bottom > -50
    && rect.left < (window.innerWidth || document.documentElement.clientWidth) + 50
    && rect.right > -50
  );
}

// Initialize observers for all breakdown cards
export function initFacetObservers() {
  document.querySelectorAll('.breakdown-card').forEach((card) => {
    facetObserver.observe(card);
    // Check initial visibility for elements already in viewport
    if (isInViewport(card)) {
      visibleFacets.add(card.id);
    }
  });
}

// --- Viewport gate: defer facet SQL until card is near the viewport (mobile scroll) ---

const viewportGateResolvers = new Map();
let viewportGateObserver = null;

/**
 * True if the breakdown card is on-screen or within `marginPx` of the viewport edge.
 * Missing element is treated as "near" so tests and edge cases do not hang.
 */
export function isBreakdownNearViewport(card, marginPx = 200) {
  if (!card) { return true; }
  const rect = card.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  return (rect.top < vh + marginPx) && (rect.bottom > -marginPx);
}

function releaseViewportGate(id) {
  const set = viewportGateResolvers.get(id);
  if (!set) { return; }
  set.forEach((fn) => fn());
  viewportGateResolvers.delete(id);
}

/**
 * Resolves when `cardId` intersects the gate band (or is already near the viewport).
 * Rejects with AbortError if `signal` aborts.
 */
export function waitUntilFacetNearViewport(cardId, signal) {
  const card = document.getElementById(cardId);
  if (!card || isBreakdownNearViewport(card)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    /** @type {(() => void) | null} */
    let finishRef = null;
    function onAbort() {
      signal?.removeEventListener('abort', onAbort);
      const set = viewportGateResolvers.get(cardId);
      if (set && finishRef) {
        set.delete(finishRef);
        if (set.size === 0) {
          viewportGateResolvers.delete(cardId);
        }
      }
      reject(new DOMException('Aborted', 'AbortError'));
    }
    function finish() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    finishRef = finish;
    signal?.addEventListener('abort', onAbort);
    let set = viewportGateResolvers.get(cardId);
    if (!set) {
      set = new Set();
      viewportGateResolvers.set(cardId, set);
    }
    set.add(finish);
    if (isBreakdownNearViewport(document.getElementById(cardId))) {
      set.delete(finish);
      if (set.size === 0) {
        viewportGateResolvers.delete(cardId);
      }
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
  });
}

/** Call after facet cards move in the DOM (pin/hide/reorder). */
export function refreshFacetViewportGateObservers() {
  if (!viewportGateObserver) {
    return;
  }
  document.querySelectorAll('.breakdown-card').forEach((c) => {
    viewportGateObserver.observe(c);
  });
}

/** Observe facet cards so waitUntilFacetNearViewport can resolve on scroll. */
export function initFacetViewportGate() {
  if (!viewportGateObserver) {
    viewportGateObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          releaseViewportGate(entry.target.id);
        }
      });
    }, { root: null, rootMargin: '200px 0px 200px 0px', threshold: 0 });
  }
  refreshFacetViewportGateObservers();
}

export function getTimerClass(ms) {
  // Aligned with Google's LCP thresholds
  if (ms < 2500) { return 'query-timer fast'; } // Good: < 2.5s
  if (ms < 4000) { return 'query-timer medium'; } // Needs Improvement: 2.5-4s
  return 'query-timer slow'; // Poor: > 4s
}

export function startQueryTimer() {
  queryStartTime = performance.now();
  if (queryTimerInterval) { clearInterval(queryTimerInterval); }
  queryTimerInterval = setInterval(() => {
    const elapsed = performance.now() - queryStartTime;
    queryTimerEl.textContent = formatQueryTime(elapsed);
    queryTimerEl.className = getTimerClass(elapsed);
  }, 10);
}

export function stopQueryTimer() {
  if (!queryTimerInterval) { return; } // Already stopped
  clearInterval(queryTimerInterval);
  queryTimerInterval = null;
  const elapsed = performance.now() - queryStartTime;
  queryTimerEl.textContent = formatQueryTime(elapsed);
  queryTimerEl.className = getTimerClass(elapsed);
}

// Check if any visible facet is still updating
export function hasVisibleUpdatingFacets() {
  for (const id of visibleFacets) {
    const card = document.getElementById(id);
    if (card && card.classList.contains('updating')) {
      return true;
    }
  }
  return false;
}
