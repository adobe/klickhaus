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
let restTimer = null; // Timer for "cursor at rest" detection
let checkAndLoadGapFn = null;
let scrollToTimestampFn = null;
let isTimestampLoadedFn = null;
let pendingTimestamp = null;
let isLoading = false;

// Debounce: only process after cursor rests for this duration
const REST_DELAY_LOADED = 1000; // 1s if data is loaded
const REST_DELAY_GAP = 100; // 100ms if data needs loading

function clearRestTimer() {
  if (restTimer) {
    clearTimeout(restTimer);
    restTimer = null;
  }
}

function updateScrubberState(waiting, loading) {
  if (!scrubberLine) return;
  scrubberLine.classList.toggle('waiting', waiting);
  scrubberLine.classList.toggle('loading', loading);
}

async function handleRestingCursor(timestamp) {
  if (pendingTimestamp !== timestamp || isLoading) return;

  const loaded = isTimestampLoadedFn?.(timestamp);
  if (loaded) {
    // Data is loaded - wait additional time before scrolling
    updateScrubberState(true, false);
    restTimer = setTimeout(() => {
      if (pendingTimestamp === timestamp) {
        updateScrubberState(false, false);
        scrollToTimestampFn?.(timestamp);
      }
    }, REST_DELAY_LOADED - REST_DELAY_GAP);
  } else {
    // Need to load gap data
    updateScrubberState(false, true);
    isLoading = true;
    try {
      await checkAndLoadGapFn?.(timestamp);
      if (pendingTimestamp === timestamp) {
        updateScrubberState(false, false);
        scrollToTimestampFn?.(timestamp);
      }
    } finally {
      isLoading = false;
      updateScrubberState(false, false);
    }
  }
}

function handleChartHover(timestamp) {
  if (!state.showLogs) return;

  // Update pending timestamp
  pendingTimestamp = timestamp;

  // Clear previous rest timer
  clearRestTimer();

  // Use shorter delay initially, then check if loaded when timer fires
  // This avoids calling isTimestampLoaded on every mousemove
  restTimer = setTimeout(() => handleRestingCursor(timestamp), REST_DELAY_GAP);
}

function handleChartLeave() {
  clearRestTimer();
  pendingTimestamp = null;
  updateScrubberState(false, false);
}

/**
 * Initialize scroll sync with required callbacks
 */
export function initScrollSync({ checkAndLoadGap, scrollToTimestamp, isTimestampLoaded }) {
  checkAndLoadGapFn = checkAndLoadGap;
  scrollToTimestampFn = scrollToTimestamp;
  isTimestampLoadedFn = isTimestampLoaded;
  scrubberLine = document.querySelector('.chart-scrubber-line');
  return {
    onChartHover: handleChartHover,
    onChartLeave: handleChartLeave,
  };
}

/** Handle row hover - move scrubber to row's timestamp (debounced via rAF) */
export function handleRowHover(rowData) {
  if (!rowData?.timestamp || !state.showLogs) return;
  requestAnimationFrame(() => {
    setScrubberPosition(parseUTC(rowData.timestamp));
    scrubberLine?.classList.add('active');
  });
}

/** Handle row hover end */
export function handleRowLeave() {
  scrubberLine?.classList.remove('active');
}
