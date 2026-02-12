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
 * Web Worker for scroll-sync background processing.
 * Runs timing logic off the main thread.
 */

let selectionTimestamp = null;
let selectionTime = 0;
let isDataLoaded = false;
let isLoading = false;

const SELECTION_DELAY = 100; // ms before triggering fetch
const SCROLL_DELAY = 1000; // ms before scrolling

let checkInterval = null;

function stopChecking() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

// Track if we've requested loaded status for current selection
let loadedCheckRequested = false;

function checkSelection() {
  if (!selectionTimestamp) return;

  const now = Date.now();
  const age = now - selectionTime;

  // Only check loaded status after selection delay, and only once per selection
  if (age >= SELECTION_DELAY && !loadedCheckRequested && !isLoading) {
    loadedCheckRequested = true;
    self.postMessage({ type: 'checkLoaded', timestamp: selectionTimestamp });
    return; // Wait for response
  }

  if (isDataLoaded) {
    // Data is ready - check if we should scroll
    if (age >= SCROLL_DELAY) {
      self.postMessage({ type: 'scroll', timestamp: selectionTimestamp });
      selectionTimestamp = null; // Prevent repeated scrolling
      stopChecking();
    } else {
      self.postMessage({ type: 'waiting' });
    }
  } else if (isLoading) {
    // Already loading - just wait
    self.postMessage({ type: 'waiting' });
  }
}

function startChecking() {
  if (checkInterval) return;
  checkInterval = setInterval(checkSelection, 50);
}

self.onmessage = (e) => {
  const { type, timestamp, loaded } = e.data;

  switch (type) {
    case 'hover':
      // Cursor moved to new position
      if (selectionTimestamp !== timestamp) {
        selectionTimestamp = timestamp;
        selectionTime = Date.now();
        isDataLoaded = false;
        isLoading = false;
        loadedCheckRequested = false;
      }
      startChecking();
      break;

    case 'leave':
      // Cursor left chart
      selectionTimestamp = null;
      isDataLoaded = false;
      isLoading = false;
      loadedCheckRequested = false;
      stopChecking();
      self.postMessage({ type: 'clear' });
      break;

    case 'loaded':
      // Main thread reports data status (response to checkLoaded)
      if (timestamp === selectionTimestamp) {
        if (loaded) {
          isDataLoaded = true;
          isLoading = false;
        } else {
          // Need to fetch
          isLoading = true;
          self.postMessage({ type: 'fetch', timestamp: selectionTimestamp });
        }
      }
      break;

    case 'fetchComplete':
      // Fetch completed
      if (timestamp === selectionTimestamp) {
        isDataLoaded = true;
        isLoading = false;
      }
      break;

    default:
      break;
  }
};
