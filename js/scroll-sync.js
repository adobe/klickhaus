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
 *
 * Architecture:
 * - UI thread: Updates scrubber position immediately on mousemove (non-blocking)
 * - Background: Checks selection age, loads data, scrolls when ready
 *
 * State:
 * - targetTimestamp: Current mouse position timestamp (updates on every move)
 * - selectionTimestamp: Timestamp when cursor "rested" (set after 100ms of no movement)
 * - selectionTime: When selectionTimestamp was set (for age checking)
 */

import { state } from './state.js';
import { setScrubberPosition } from './chart.js';
import { parseUTC } from './chart-state.js';

let scrubberLine = null;
let checkAndLoadGapFn = null;
let scrollToTimestampFn = null;
let isTimestampLoadedFn = null;

// State for tracking cursor position and selection
let selectionTimestamp = null;
let selectionTime = 0;

// Background processing
let processingInterval = null;
let currentFetchTimestamp = null;
let fetchAbortController = null;

const SELECTION_DELAY = 100; // ms before cursor is considered "at rest"
const SCROLL_DELAY = 1000; // ms before scrolling to loaded data
const PROCESS_INTERVAL = 50; // ms between background checks

function updateScrubberState(waiting, loading) {
  if (!scrubberLine) return;
  scrubberLine.classList.toggle('waiting', waiting);
  scrubberLine.classList.toggle('loading', loading);
}

/**
 * Background processor - runs periodically to handle data loading and scrolling
 */
async function processSelection() {
  if (!selectionTimestamp || !state.showLogs) return;

  const now = Date.now();
  const selectionAge = now - selectionTime;

  // Check if we need to abort a fetch for a different timestamp
  if (currentFetchTimestamp && currentFetchTimestamp !== selectionTimestamp) {
    fetchAbortController?.abort();
    currentFetchTimestamp = null;
    fetchAbortController = null;
    updateScrubberState(false, false);
  }

  // Check if data is ready
  const loaded = isTimestampLoadedFn?.(selectionTimestamp);

  if (loaded) {
    // Data is ready - scroll after delay
    if (selectionAge >= SCROLL_DELAY) {
      updateScrubberState(false, false);
      scrollToTimestampFn?.(selectionTimestamp);
      selectionTimestamp = null; // Clear to prevent repeated scrolling
    } else {
      updateScrubberState(true, false); // Show waiting state
    }
  } else if (selectionAge >= SELECTION_DELAY && !currentFetchTimestamp) {
    // Need to fetch data - start loading
    currentFetchTimestamp = selectionTimestamp;
    updateScrubberState(false, true);

    try {
      await checkAndLoadGapFn?.(selectionTimestamp);
      // After loading, the next iteration will handle scrolling
    } catch {
      // Fetch was aborted or failed - ignore
    } finally {
      if (currentFetchTimestamp === selectionTimestamp) {
        currentFetchTimestamp = null;
        updateScrubberState(false, false);
      }
    }
  }
}

function startBackgroundProcessor() {
  if (processingInterval) return;
  processingInterval = setInterval(processSelection, PROCESS_INTERVAL);
}

function stopBackgroundProcessor() {
  if (processingInterval) {
    clearInterval(processingInterval);
    processingInterval = null;
  }
}

/**
 * Called on every chart mousemove - must be fast and non-blocking
 */
function handleChartHover(timestamp) {
  // If cursor moved to a new position, update selection tracking
  if (selectionTimestamp !== timestamp) {
    selectionTimestamp = timestamp;
    selectionTime = Date.now();
  }

  // Ensure background processor is running
  if (state.showLogs) {
    startBackgroundProcessor();
  }
}

function handleChartLeave() {
  selectionTimestamp = null;
  currentFetchTimestamp = null;
  fetchAbortController?.abort();
  fetchAbortController = null;
  updateScrubberState(false, false);
  stopBackgroundProcessor();
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

/** Handle row hover - move scrubber to row's timestamp */
export function handleRowHover(rowData) {
  if (!rowData?.timestamp || !state.showLogs) return;
  // Use rAF to batch with other rendering
  requestAnimationFrame(() => {
    setScrubberPosition(parseUTC(rowData.timestamp));
    scrubberLine?.classList.add('active');
  });
}

/** Handle row hover end */
export function handleRowLeave() {
  scrubberLine?.classList.remove('active');
}
