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
 * Initialize double-tap to clear host filter on touch devices.
 * @param {HTMLInputElement} hostFilter
 */
export function initHostFilterDoubleTap(hostFilter) {
  if (!('ontouchstart' in window)) return;
  if (!hostFilter) return;

  const inputEl = hostFilter;
  let lastTap = 0;

  inputEl.addEventListener('touchend', () => {
    const now = Date.now();
    if (now - lastTap < 300 && now - lastTap > 0) {
      inputEl.value = '';
      inputEl.dispatchEvent(new Event('input'));
      lastTap = 0;
    } else {
      lastTap = now;
    }
  });
}

/**
 * Enable touch-active row behavior for breakdown tables.
 */
export function initMobileTouchSupport() {
  if (!('ontouchstart' in window)) return;

  document.addEventListener('click', (e) => {
    const row = e.target.closest('.breakdown-table tr:not(.other-row)');
    const isActionBtn = e.target.closest('.mobile-action-btn');

    if (isActionBtn) {
      setTimeout(() => {
        document.querySelectorAll('.breakdown-table tr.touch-active').forEach((r) => {
          r.classList.remove('touch-active');
        });
      }, 100);
      return;
    }

    if (row) {
      const wasActive = row.classList.contains('touch-active');
      document.querySelectorAll('.breakdown-table tr.touch-active').forEach((r) => {
        r.classList.remove('touch-active');
      });
      if (!wasActive) {
        row.classList.add('touch-active');
      }
      return;
    }

    document.querySelectorAll('.breakdown-table tr.touch-active').forEach((r) => {
      r.classList.remove('touch-active');
    });
  });
}

/**
 * Add pull-to-refresh behavior on touch devices.
 * @param {() => Promise<void>} refresh
 */
export function initPullToRefresh(refresh) {
  if (!('ontouchstart' in window)) return;

  const indicator = document.createElement('div');
  indicator.className = 'pull-to-refresh';
  indicator.innerHTML = '<span class="pull-arrow">↻</span><span class="pull-text">Pull to refresh</span>';
  const breakdowns = document.querySelector('.breakdowns');
  if (breakdowns) {
    breakdowns.parentNode.insertBefore(indicator, breakdowns);
  }

  let touchStartY = 0;
  let isPulling = false;
  const threshold = 80;

  document.addEventListener('touchstart', (e) => {
    if (window.scrollY === 0) {
      touchStartY = e.touches[0].clientY;
      isPulling = true;
    }
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!isPulling) return;
    const touchY = e.touches[0].clientY;
    const pullDistance = touchY - touchStartY;

    if (pullDistance > 0 && window.scrollY === 0) {
      indicator.classList.add('visible');
      indicator.querySelector('.pull-text').textContent = pullDistance > threshold ? 'Release to refresh' : 'Pull to refresh';
    } else {
      indicator.classList.remove('visible');
    }
  }, { passive: true });

  document.addEventListener('touchend', async (e) => {
    if (!isPulling) return;
    const touchEndY = e.changedTouches[0].clientY;
    const pullDistance = touchEndY - touchStartY;

    if (pullDistance > threshold && window.scrollY === 0) {
      indicator.classList.add('refreshing');
      indicator.querySelector('.pull-text').textContent = 'Refreshing...';
      await refresh();
      indicator.classList.remove('visible', 'refreshing');
    } else {
      indicator.classList.remove('visible');
    }

    isPulling = false;
    touchStartY = 0;
  }, { passive: true });
}

/**
 * Move active filters below chart on small screens.
 */
export function initMobileFiltersPosition() {
  const activeFilters = document.getElementById('activeFilters');
  const chartSection = document.querySelector('.chart-section');
  const headerLeft = document.querySelector('.header-left');

  if (!activeFilters || !chartSection || !headerLeft) return;

  function updatePosition() {
    const isMobile = window.innerWidth < 600;
    if (isMobile && activeFilters.parentElement !== chartSection) {
      chartSection.appendChild(activeFilters);
    } else if (!isMobile && activeFilters.parentElement !== headerLeft) {
      headerLeft.appendChild(activeFilters);
    }
  }

  updatePosition();
  window.addEventListener('resize', updatePosition);
}
