/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

// The header gives active filters limited room and fades/clips the overflow.
// When filters don't fit, hovering them shows a popover with every filter in
// full; tags keep their data-action, so clicking one still removes it.

const HIDE_DELAY_MS = 200;
// .header-left fades out its last 10% via mask-image.
const FADE_FRACTION = 0.1;

let popover = null;
let hideTimer = null;
let initializedFor = null;

function isMobile() {
  return window.matchMedia('(max-width: 600px)').matches;
}

/**
 * Whether any filter tag is truncated or clipped by the header.
 * @param {HTMLElement} container - #activeFilters
 * @returns {boolean}
 */
export function isFilterOverflowing(container) {
  if (!container?.children.length) { return false; }
  const labels = container.querySelectorAll('.filter-tag-label');
  if ([...labels].some((l) => l.scrollWidth > l.clientWidth)) { return true; }
  if (container.scrollWidth > container.clientWidth) { return true; }
  const parent = container.parentElement;
  if (!parent) { return false; }
  const parentRect = parent.getBoundingClientRect();
  const visibleRight = parentRect.right - parentRect.width * FADE_FRACTION;
  const last = container.lastElementChild.getBoundingClientRect();
  return last.right > visibleRight;
}

function hidePopover() {
  clearTimeout(hideTimer);
  hideTimer = null;
  if (popover) { popover.hidden = true; }
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hidePopover, HIDE_DELAY_MS);
}

function getPopover() {
  if (!popover?.isConnected) {
    popover = document.createElement('div');
    popover.id = 'activeFiltersPopover';
    popover.className = 'active-filters-popover';
    popover.hidden = true;
    popover.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    popover.addEventListener('mouseleave', scheduleHide);
    document.body.appendChild(popover);
  }
  return popover;
}

function showPopover(container) {
  clearTimeout(hideTimer);
  if (isMobile() || !isFilterOverflowing(container)) {
    hidePopover();
    return;
  }
  const el = getPopover();
  el.innerHTML = container.innerHTML;
  const rect = container.getBoundingClientRect();
  el.style.top = `${rect.bottom + 6}px`;
  el.style.left = `${rect.left}px`;
  el.hidden = false;
}

function init(container) {
  if (initializedFor === container) { return; }
  initializedFor = container;
  container.addEventListener('mouseenter', () => showPopover(container));
  container.addEventListener('mouseleave', scheduleHide);
  window.addEventListener('scroll', hidePopover, { passive: true });
  window.addEventListener('resize', hidePopover);
}

/**
 * Wire up the hover popover and refresh it after filters are re-rendered.
 * @param {HTMLElement} container - #activeFilters
 */
export function updateFilterOverflow(container) {
  if (!container) { return; }
  init(container);
  if (popover && !popover.hidden) {
    showPopover(container);
  }
}
