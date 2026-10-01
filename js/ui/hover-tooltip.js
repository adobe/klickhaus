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

// Instant hover tooltip for elements with a `data-tooltip` attribute. Native `title`
// tooltips are skipped by browsers when moving directly between titled elements, and
// CSS-only tooltips get clipped by the overflow-hidden facet cells, so a single
// fixed-position element is shown next to the hovered target instead.

const TARGET_SELECTOR = '[data-tooltip]';

let tooltipEl = null;
let currentTarget = null;

function getTooltipEl() {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'hover-tooltip';
    tooltipEl.setAttribute('role', 'tooltip');
    tooltipEl.hidden = true;
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

export function hideHoverTooltip() {
  currentTarget = null;
  if (tooltipEl) { tooltipEl.hidden = true; }
}

export function showHoverTooltip(target) {
  const text = target.getAttribute('data-tooltip');
  if (!text) {
    hideHoverTooltip();
    return;
  }
  const el = getTooltipEl();
  currentTarget = target;
  el.textContent = text;
  el.hidden = false;

  const rect = target.getBoundingClientRect();
  const { width, height } = el.getBoundingClientRect();
  const margin = 6;
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
  const below = rect.bottom + margin;
  const top = below + height > window.innerHeight ? rect.top - height - margin : below;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function onPointerOver(e) {
  const target = e.target instanceof Element ? e.target.closest(TARGET_SELECTOR) : null;
  if (target === currentTarget) { return; }
  if (target) {
    showHoverTooltip(target);
  } else {
    hideHoverTooltip();
  }
}

let initialized = false;

export function initHoverTooltips() {
  if (initialized) { return; }
  initialized = true;
  document.addEventListener('pointerover', onPointerOver);
  document.documentElement.addEventListener('pointerleave', hideHoverTooltip);
  // Targets may be re-rendered or scrolled away while hovered.
  window.addEventListener('scroll', hideHoverTooltip, { capture: true, passive: true });
  window.addEventListener('blur', hideHoverTooltip);
}
