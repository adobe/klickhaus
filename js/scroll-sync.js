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
 * - Main thread: Updates scrubber position immediately (non-blocking)
 * - Web Worker: Handles timing logic (selection age, delays)
 * - Main thread responds to worker messages for fetch/scroll actions
 */

import { state } from './state.js';
import { setScrubberPosition } from './chart.js';
import { parseUTC } from './chart-state.js';

let scrubberLine = null;
let checkAndLoadGapFn = null;
let scrollToTimestampFn = null;
let isTimestampLoadedFn = null;

// Web Worker for background timing
let worker = null;

function updateScrubberState(waiting, loading) {
  if (!scrubberLine) return;
  scrubberLine.classList.toggle('waiting', waiting);
  scrubberLine.classList.toggle('loading', loading);
}

function handleWorkerMessage(e) {
  const { type, timestamp } = e.data;

  switch (type) {
    case 'checkLoaded':
      // Worker asks: is data loaded for this timestamp?
      // This is the only place we call isTimestampLoadedFn (once per selection)
      requestAnimationFrame(() => {
        const loaded = isTimestampLoadedFn?.(timestamp);
        worker?.postMessage({ type: 'loaded', timestamp, loaded });
      });
      break;

    case 'fetch':
      // Worker says: fetch data for this timestamp
      updateScrubberState(false, true);
      checkAndLoadGapFn?.(timestamp).then(() => {
        worker?.postMessage({ type: 'fetchComplete', timestamp });
        updateScrubberState(false, false);
      }).catch(() => {
        updateScrubberState(false, false);
      });
      break;

    case 'scroll':
      // Worker says: scroll to this timestamp
      updateScrubberState(false, false);
      scrollToTimestampFn?.(timestamp);
      break;

    case 'waiting':
      // Worker says: show waiting state
      updateScrubberState(true, false);
      break;

    case 'clear':
      // Worker says: clear all states
      updateScrubberState(false, false);
      break;

    default:
      break;
  }
}

function initWorker() {
  if (worker) return;
  try {
    worker = new Worker(new URL('./scroll-sync-worker.js', import.meta.url));
    worker.onmessage = handleWorkerMessage;
  } catch {
    // Worker failed to load - fall back to no-op
    worker = null;
  }
}

/**
 * Called on every chart mousemove - just posts to worker (instant)
 * MUST NOT call any functions that iterate over data - that blocks the UI
 */
function handleChartHover(timestamp) {
  if (!state.showLogs) return;

  // Initialize worker on first hover
  if (!worker) initWorker();

  // Post to worker (non-blocking) - worker will request loaded status when needed
  worker?.postMessage({ type: 'hover', timestamp: timestamp.getTime() });
}

function handleChartLeave() {
  worker?.postMessage({ type: 'leave' });
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

/** Handle row hover - move scrubber to row's timestamp */
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
