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

import { assert } from 'chai';
import { setupTwoFingerTouchSelection } from './chart-touch-selection.js';

function touch(clientX) {
  return { clientX };
}

function fireTouchEvent(target, type, touches) {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, 'touches', { value: touches, configurable: true });
  target.dispatchEvent(evt);
  return evt;
}

describe('setupTwoFingerTouchSelection', () => {
  let canvas;
  let container;
  let scrubberLine;
  let isDragging;
  let hideSelectionCalls;
  let statusBarCalls;
  let applyCalls;
  let setDragStartCalls;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    container = document.createElement('div');
    scrubberLine = document.createElement('div');
    scrubberLine.classList.add('visible');
    container.appendChild(canvas);
    document.body.appendChild(container);
    isDragging = false;
    hideSelectionCalls = 0;
    statusBarCalls = 0;
    applyCalls = [];
    setDragStartCalls = [];

    canvas.getBoundingClientRect = () => ({
      left: 10, width: 300, top: 0, right: 310, bottom: 150, height: 150,
    });

    setupTwoFingerTouchSelection({
      canvas,
      container,
      minDragDistance: 20,
      getPendingSelection: () => ({ startTime: new Date(), endTime: new Date() }),
      hideSelectionOverlay: () => {
        hideSelectionCalls += 1;
      },
      getAnomalyAtX: () => null,
      getChartLayout: () => ({ padding: { left: 0, right: 0 }, width: 300 }),
      getTimeAtX: (x) => new Date(1000 + Math.round(x)),
      updateSelectionOverlay: () => {},
      updateSelectionStatusBar: () => {
        statusBarCalls += 1;
      },
      clampChartContentX: (x) => x,
      applyPendingRangeFromCanvasSpan: (x0, x1) => {
        applyCalls.push([x0, x1]);
      },
      setDragStartX: (x) => {
        setDragStartCalls.push(x);
      },
      getIsDragging: () => isDragging,
      setIsDragging: (next) => {
        isDragging = next;
      },
      scrubberLine,
    });
  });

  afterEach(() => {
    // Ensure document-level listeners from active gestures are torn down.
    fireTouchEvent(document, 'touchend', []);
    container.remove();
  });

  it('activates two-finger mode on touchstart and suppresses default behavior', () => {
    const startEvt = fireTouchEvent(canvas, 'touchstart', [touch(80), touch(170)]);
    assert.isTrue(startEvt.defaultPrevented);
    assert.isTrue(canvas.classList.contains('chart-two-finger-range'));
    assert.deepEqual(setDragStartCalls, [null]);
    assert.strictEqual(hideSelectionCalls, 1);
    assert.isTrue(container.classList.contains('dragging'));
    assert.isAtLeast(statusBarCalls, 1);
    assert.isFalse(scrubberLine.classList.contains('visible'));
  });

  it('ignores touchstart when not exactly two touches', () => {
    const startEvt = fireTouchEvent(canvas, 'touchstart', [touch(80)]);
    assert.isFalse(startEvt.defaultPrevented);
    assert.isFalse(canvas.classList.contains('chart-two-finger-range'));
    assert.deepEqual(setDragStartCalls, []);
  });

  it('ignores touchstart when touching an anomaly', () => {
    container.remove();
    canvas = document.createElement('canvas');
    container = document.createElement('div');
    scrubberLine = document.createElement('div');
    container.appendChild(canvas);
    document.body.appendChild(container);
    canvas.getBoundingClientRect = () => ({
      left: 10, width: 300, top: 0, right: 310, bottom: 150, height: 150,
    });
    setupTwoFingerTouchSelection({
      canvas,
      container,
      minDragDistance: 20,
      getPendingSelection: () => null,
      hideSelectionOverlay: () => {
        hideSelectionCalls += 1;
      },
      getAnomalyAtX: () => ({ rank: 1 }),
      getChartLayout: () => ({ padding: { left: 0, right: 0 }, width: 300 }),
      getTimeAtX: (x) => new Date(1000 + Math.round(x)),
      updateSelectionOverlay: () => {},
      updateSelectionStatusBar: () => {
        statusBarCalls += 1;
      },
      clampChartContentX: (x) => x,
      applyPendingRangeFromCanvasSpan: (x0, x1) => {
        applyCalls.push([x0, x1]);
      },
      setDragStartX: (x) => {
        setDragStartCalls.push(x);
      },
      getIsDragging: () => isDragging,
      setIsDragging: (next) => {
        isDragging = next;
      },
      scrubberLine,
    });
    const startEvt = fireTouchEvent(canvas, 'touchstart', [touch(80), touch(180)]);
    assert.isFalse(startEvt.defaultPrevented);
    assert.isFalse(canvas.classList.contains('chart-two-finger-range'));
  });

  it('suppresses default touch behavior while active when one finger remains', () => {
    fireTouchEvent(canvas, 'touchstart', [touch(100), touch(115)]);
    const moveEvt = fireTouchEvent(document, 'touchmove', [touch(120)]);
    assert.isTrue(moveEvt.defaultPrevented);
  });

  it('updates selection overlay when touchmove crosses drag threshold', () => {
    const overlays = [];
    container.remove();
    canvas = document.createElement('canvas');
    container = document.createElement('div');
    scrubberLine = document.createElement('div');
    scrubberLine.classList.add('visible');
    container.appendChild(canvas);
    document.body.appendChild(container);
    canvas.getBoundingClientRect = () => ({
      left: 10, width: 300, top: 0, right: 310, bottom: 150, height: 150,
    });
    setupTwoFingerTouchSelection({
      canvas,
      container,
      minDragDistance: 20,
      getPendingSelection: () => null,
      hideSelectionOverlay: () => {},
      getAnomalyAtX: () => null,
      getChartLayout: () => ({ padding: { left: 0, right: 0 }, width: 300 }),
      getTimeAtX: (x) => new Date(1000 + Math.round(x)),
      updateSelectionOverlay: (x0, x1) => {
        overlays.push([x0, x1]);
      },
      updateSelectionStatusBar: () => {
        statusBarCalls += 1;
      },
      clampChartContentX: (x) => x,
      applyPendingRangeFromCanvasSpan: () => {},
      setDragStartX: () => {},
      getIsDragging: () => isDragging,
      setIsDragging: (next) => {
        isDragging = next;
      },
      scrubberLine,
    });
    fireTouchEvent(canvas, 'touchstart', [touch(100), touch(110)]);
    fireTouchEvent(document, 'touchmove', [touch(110), touch(210)]);
    assert.isTrue(isDragging);
    assert.deepEqual(overlays, [[100, 200]]);
    assert.isAtLeast(statusBarCalls, 1);
  });

  it('applies selected span on drag end when dragging occurred', () => {
    fireTouchEvent(canvas, 'touchstart', [touch(100), touch(170)]);
    fireTouchEvent(document, 'touchmove', [touch(110), touch(210)]);
    fireTouchEvent(document, 'touchend', [touch(210)]);
    assert.deepEqual(applyCalls, [[100, 200]]);
    assert.isFalse(isDragging);
    assert.isFalse(canvas.classList.contains('chart-two-finger-range'));
    assert.isFalse(container.classList.contains('dragging'));
  });

  it('hides overlay instead of applying range when gesture is too small', () => {
    fireTouchEvent(canvas, 'touchstart', [touch(100), touch(105)]);
    fireTouchEvent(document, 'touchend', [touch(105)]);
    assert.strictEqual(applyCalls.length, 0);
    assert.isAtLeast(hideSelectionCalls, 2);
  });

  it('ignores touchend while two touches are still active', () => {
    fireTouchEvent(canvas, 'touchstart', [touch(100), touch(170)]);
    fireTouchEvent(document, 'touchend', [touch(170), touch(190)]);
    assert.strictEqual(applyCalls.length, 0);
    assert.isTrue(canvas.classList.contains('chart-two-finger-range'));
  });

  it('prevents webkit gesture defaults only when range class is active', () => {
    const gestureIdle = new Event('gesturestart', { bubbles: true, cancelable: true });
    canvas.dispatchEvent(gestureIdle);
    assert.isFalse(gestureIdle.defaultPrevented);

    fireTouchEvent(canvas, 'touchstart', [touch(120), touch(180)]);
    const gestureActive = new Event('gesturechange', { bubbles: true, cancelable: true });
    canvas.dispatchEvent(gestureActive);
    assert.isTrue(gestureActive.defaultPrevented);
  });
});
