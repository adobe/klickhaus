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
 * Scroll-Scrubber Synchronization Module
 * - Row hover → move scrubber to row's timestamp
 * - Chart hover → scroll to timestamp (with delay and loading states)
 */

import { state } from './state.js';
import { setScrubberPosition } from './chart.js';
import { parseUTC } from './chart-state.js';

let scrubberLine = null;
let chartHoverTimer = null;
let fetchDelayTimer = null;
let checkAndLoadGapFn = null;
let scrollToTimestampFn = null;
let pendingTimestamp = null;

// Visual feedback helpers
function showScrubberActive() {
  scrubberLine?.classList.add('active');
}
function hideScrubberActive() {
  scrubberLine?.classList.remove('active');
}
function showScrubberWaiting() {
  scrubberLine?.classList.add('waiting');
}
function hideScrubberWaiting() {
  scrubberLine?.classList.remove('waiting');
}
function showScrubberLoading() {
  scrubberLine?.classList.add('loading');
}
function hideScrubberLoading() {
  scrubberLine?.classList.remove('loading');
}

function clearTimers() {
  if (chartHoverTimer) {
    clearTimeout(chartHoverTimer);
    chartHoverTimer = null;
  }
  if (fetchDelayTimer) {
    clearTimeout(fetchDelayTimer);
    fetchDelayTimer = null;
  }
}

function handleChartHover(timestamp, isTimestampLoaded) {
  if (!state.showLogs) return;
  clearTimers();
  pendingTimestamp = timestamp;
  const loaded = isTimestampLoaded(timestamp);

  if (loaded) {
    showScrubberWaiting();
    chartHoverTimer = setTimeout(() => {
      if (pendingTimestamp === timestamp) {
        hideScrubberWaiting();
        scrollToTimestampFn?.(timestamp);
      }
    }, 1000);
  } else {
    showScrubberWaiting();
    fetchDelayTimer = setTimeout(async () => {
      if (pendingTimestamp !== timestamp) return;
      showScrubberLoading();
      try {
        await checkAndLoadGapFn?.(timestamp);
        if (pendingTimestamp === timestamp) {
          hideScrubberLoading();
          scrollToTimestampFn?.(timestamp);
        }
      } finally {
        hideScrubberLoading();
      }
    }, 100);
  }
}

function handleChartLeave() {
  clearTimers();
  pendingTimestamp = null;
  hideScrubberWaiting();
  hideScrubberLoading();
}

/**
 * Initialize scroll sync with required callbacks
 */
export function initScrollSync({ checkAndLoadGap, scrollToTimestamp, isTimestampLoaded }) {
  checkAndLoadGapFn = checkAndLoadGap;
  scrollToTimestampFn = scrollToTimestamp;
  scrubberLine = document.querySelector('.chart-scrubber-line');
  return {
    onChartHover: (ts) => handleChartHover(ts, isTimestampLoaded),
    onChartLeave: handleChartLeave,
  };
}

/** Handle row hover - move scrubber to row's timestamp */
export function handleRowHover(rowData) {
  if (!rowData?.timestamp || !state.showLogs) return;
  setScrubberPosition(parseUTC(rowData.timestamp));
  showScrubberActive();
}

/** Handle row hover end */
export function handleRowLeave() {
  hideScrubberActive();
}
