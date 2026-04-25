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
import { setupChartNavigation } from './chart.js';
import {
  setChartLayout,
  setPendingSelection,
  getPendingSelection,
  setNavigationCallback,
  setLastChartData,
  resetAnomalyBounds,
} from './chart-state.js';
import { setQueryTimestamp } from './time.js';

describe('setupChartNavigation', () => {
  let wrapper;
  let canvas;

  beforeEach(() => {
    wrapper = document.createElement('div');
    canvas = document.createElement('canvas');
    canvas.id = 'chart';
    wrapper.appendChild(canvas);
    document.body.appendChild(wrapper);
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 300, height: 180, right: 300, bottom: 180,
    });
    setChartLayout({
      width: 300,
      height: 180,
      chartWidth: 300,
      padding: {
        top: 0, right: 0, bottom: 0, left: 0,
      },
      intendedStartTime: new Date('2025-01-01T00:00:00Z').getTime(),
      intendedEndTime: new Date('2025-01-01T01:00:00Z').getTime(),
    });
    setPendingSelection(null);
    setNavigationCallback(null);
    setLastChartData(null);
    resetAnomalyBounds();
    setQueryTimestamp(new Date('2025-01-01T00:30:00Z'));
  });

  afterEach(() => {
    wrapper.remove();
    setPendingSelection(null);
    setNavigationCallback(null);
    setLastChartData(null);
    resetAnomalyBounds();
  });

  it('adds chart overlays and scrubber elements', () => {
    setupChartNavigation(() => {});
    assert.ok(wrapper.querySelector('.chart-nav-overlay'));
    assert.ok(wrapper.querySelector('.chart-scrubber-line'));
    assert.ok(wrapper.querySelector('.chart-scrubber-status'));
    assert.ok(wrapper.querySelector('.chart-selection-overlay'));
  });

  it('calls navigation callback on nav click', () => {
    let calls = 0;
    setupChartNavigation(() => {
      calls += 1;
    });
    const navRight = wrapper.querySelector('.chart-nav-right');
    navRight.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 250 }));
    assert.strictEqual(calls, 1);
  });

  it('sets pending selection after mouse drag on chart', () => {
    setupChartNavigation(() => {});
    canvas.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      clientX: 60,
      clientY: 40,
    }));
    wrapper.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientX: 200,
      clientY: 40,
    }));
    wrapper.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      clientX: 200,
      clientY: 40,
    }));
    const selection = getPendingSelection();
    assert.ok(selection);
    assert.isBelow(selection.startTime.getTime(), selection.endTime.getTime());
  });
});
