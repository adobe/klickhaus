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

/**
 * Wire up two-finger touch range selection for the chart canvas.
 * Keeps touch-specific state isolated from the rest of chart navigation logic.
 */
export function setupTwoFingerTouchSelection({
  canvas,
  container,
  minDragDistance,
  getPendingSelection,
  hideSelectionOverlay,
  getAnomalyAtX,
  getChartLayout,
  getTimeAtX,
  updateSelectionOverlay,
  updateSelectionStatusBar,
  clampChartContentX,
  applyPendingRangeFromCanvasSpan,
  updateSnappedLiveSelection,
  showSelectionDragStartHint,
  setDragStartX,
  getIsDragging,
  setIsDragging,
  scrubberLine,
}) {
  let twoFingerRangeActive = false;
  let twoFingerMinX = 0;
  let twoFingerMaxX = 0;
  let twoFingerDocsAbort = null;

  function teardownTwoFingerDocListeners() {
    twoFingerDocsAbort?.abort();
    twoFingerDocsAbort = null;
    canvas.classList.remove('chart-two-finger-range');
  }

  function twoFingerCanvasXs(touchList) {
    const rect = canvas.getBoundingClientRect();
    const t0 = touchList[0];
    const t1 = touchList[1];
    return [t0.clientX - rect.left, t1.clientX - rect.left];
  }

  const onTwoFingerTouchMove = (e) => {
    if (!twoFingerRangeActive) {
      return;
    }
    // Keep default suppressed for the whole capture (including when one finger lifts first).
    if (e.touches.length < 2) {
      e.preventDefault();
      return;
    }
    const xs = twoFingerCanvasXs(e.touches);
    const minX = Math.min(xs[0], xs[1]);
    const maxX = Math.max(xs[0], xs[1]);
    twoFingerMinX = minX;
    twoFingerMaxX = maxX;
    const chartLayout = getChartLayout();
    const rect = canvas.getBoundingClientRect();
    const c0 = clampChartContentX(minX, chartLayout, rect.width);
    const c1 = clampChartContentX(maxX, chartLayout, rect.width);
    if (Math.abs(c1 - c0) >= minDragDistance) {
      setIsDragging(true);
      container.classList.add('dragging');
      scrubberLine.classList.remove('visible');
      if (updateSnappedLiveSelection) {
        updateSnappedLiveSelection(c0, c1);
      } else {
        updateSelectionOverlay(c0, c1);
        const selStartTime = getTimeAtX(Math.min(c0, c1));
        const selEndTime = getTimeAtX(Math.max(c0, c1));
        if (selStartTime && selEndTime) {
          updateSelectionStatusBar(selStartTime, selEndTime);
        }
      }
    }
    e.preventDefault();
  };

  const onTwoFingerTouchEnd = (e) => {
    if (!twoFingerRangeActive) {
      return;
    }
    if (e.touches.length >= 2) {
      return;
    }
    teardownTwoFingerDocListeners();
    twoFingerRangeActive = false;
    const wasDragging = getIsDragging();
    const chartLayout = getChartLayout();
    const rect = canvas.getBoundingClientRect();
    const c0 = clampChartContentX(
      Math.min(twoFingerMinX, twoFingerMaxX),
      chartLayout,
      rect.width,
    );
    const c1 = clampChartContentX(
      Math.max(twoFingerMinX, twoFingerMaxX),
      chartLayout,
      rect.width,
    );
    setIsDragging(false);
    container.classList.remove('dragging');

    if (!wasDragging && Math.abs(c1 - c0) < minDragDistance) {
      hideSelectionOverlay();
      return;
    }
    applyPendingRangeFromCanvasSpan(c0, c1);
  };

  const onTwoFingerTouchStart = (e) => {
    if (e.touches.length !== 2) {
      return;
    }
    if (twoFingerRangeActive) {
      teardownTwoFingerDocListeners();
      twoFingerRangeActive = false;
    }
    const xs = twoFingerCanvasXs(e.touches);
    const minX = Math.min(xs[0], xs[1]);
    const maxX = Math.max(xs[0], xs[1]);
    if (getAnomalyAtX(minX)) {
      return;
    }
    if (getPendingSelection()) {
      hideSelectionOverlay();
    }
    setDragStartX(null);
    twoFingerRangeActive = true;
    canvas.classList.add('chart-two-finger-range');
    twoFingerMinX = minX;
    twoFingerMaxX = maxX;
    setIsDragging(Math.abs(maxX - minX) >= minDragDistance);
    const chartLayout = getChartLayout();
    const rect = canvas.getBoundingClientRect();
    const c0 = clampChartContentX(minX, chartLayout, rect.width);
    const c1 = clampChartContentX(maxX, chartLayout, rect.width);
    if (getIsDragging()) {
      container.classList.add('dragging');
      scrubberLine.classList.remove('visible');
      if (updateSnappedLiveSelection) {
        updateSnappedLiveSelection(c0, c1);
      } else {
        updateSelectionOverlay(c0, c1);
        const selStartTime = getTimeAtX(Math.min(c0, c1));
        const selEndTime = getTimeAtX(Math.max(c0, c1));
        if (selStartTime && selEndTime) {
          updateSelectionStatusBar(selStartTime, selEndTime);
        }
      }
    } else if (showSelectionDragStartHint) {
      scrubberLine.classList.remove('visible');
      showSelectionDragStartHint((c0 + c1) / 2);
    }
    twoFingerDocsAbort = new AbortController();
    const { signal } = twoFingerDocsAbort;
    document.addEventListener('touchmove', onTwoFingerTouchMove, { passive: false, signal });
    document.addEventListener('touchend', onTwoFingerTouchEnd, { signal });
    document.addEventListener('touchcancel', onTwoFingerTouchEnd, { signal });
    e.preventDefault();
  };

  canvas.addEventListener('touchstart', onTwoFingerTouchStart, { passive: false });

  // WebKit (iOS Safari): pinch-zoom may use gesture* in addition to touch defaults.
  ['gesturestart', 'gesturechange'].forEach((type) => {
    canvas.addEventListener(
      type,
      (e) => {
        if (canvas.classList.contains('chart-two-finger-range')) {
          e.preventDefault();
        }
      },
      { passive: false },
    );
  });
}
