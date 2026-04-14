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
import { buildValueBadges, buildAnomalyInfo } from './chart-labels.js';
import { state } from './state.js';
import {
  setLastChartData, setChartLayout, addAnomalyBounds, resetAnomalyBounds, setDetectedSteps,
} from './chart-state.js';

const DEFAULT_LABELS = { ok: '2xx', client: '4xx', server: '5xx' };

function resetLabels() {
  state.seriesLabels = { ...DEFAULT_LABELS };
}

describe('state.seriesLabels', () => {
  afterEach(resetLabels);

  it('has correct default values', () => {
    assert.deepEqual(state.seriesLabels, { ok: '2xx', client: '4xx', server: '5xx' });
  });

  it('can be overridden for RUM pages', () => {
    state.seriesLabels = { ok: 'good', client: 'needs improvement', server: 'poor' };
    assert.strictEqual(state.seriesLabels.ok, 'good');
    assert.strictEqual(state.seriesLabels.client, 'needs improvement');
    assert.strictEqual(state.seriesLabels.server, 'poor');
  });

  it('reverts to defaults when reset', () => {
    state.seriesLabels = { ok: 'good', client: 'needs improvement', server: 'poor' };
    resetLabels();
    assert.deepEqual(state.seriesLabels, DEFAULT_LABELS);
  });
});

describe('buildValueBadges', () => {
  afterEach(() => {
    setLastChartData(null);
    resetLabels();
  });

  it('returns empty string when no chart data', () => {
    assert.strictEqual(buildValueBadges(new Date()), '');
  });

  it('uses default 2xx/4xx/5xx labels', () => {
    setLastChartData([
      {
        t: '2025-01-01 00:00:00', cnt_ok: '100', cnt_4xx: '5', cnt_5xx: '1',
      },
    ]);
    const html = buildValueBadges(new Date('2025-01-01T00:00:00Z'));
    assert.include(html, '2xx');
    assert.include(html, '4xx');
    assert.include(html, '5xx');
    assert.include(html, 'scrubber-value-ok');
    assert.include(html, 'scrubber-value-4xx');
    assert.include(html, 'scrubber-value-5xx');
  });

  it('uses custom labels from state.seriesLabels', () => {
    state.seriesLabels = { ok: 'good', client: 'needs improvement', server: 'poor' };
    setLastChartData([
      {
        t: '2025-01-01 00:00:00', cnt_ok: '100', cnt_4xx: '5', cnt_5xx: '1',
      },
    ]);
    const html = buildValueBadges(new Date('2025-01-01T00:00:00Z'));
    assert.include(html, 'good');
    assert.include(html, 'needs improvement');
    assert.include(html, 'poor');
    // Badge text should not contain old labels (CSS classes still have 4xx/5xx but that's OK)
    assert.notInclude(html, '>2xx');
  });

  it('preserves CSS classes regardless of custom labels', () => {
    state.seriesLabels = { ok: 'good', client: 'needs improvement', server: 'poor' };
    setLastChartData([
      {
        t: '2025-01-01 00:00:00', cnt_ok: '100', cnt_4xx: '5', cnt_5xx: '1',
      },
    ]);
    const html = buildValueBadges(new Date('2025-01-01T00:00:00Z'));
    assert.include(html, 'scrubber-value-ok');
    assert.include(html, 'scrubber-value-4xx');
    assert.include(html, 'scrubber-value-5xx');
  });

  it('omits badges for zero counts', () => {
    setLastChartData([
      {
        t: '2025-01-01 00:00:00', cnt_ok: '100', cnt_4xx: '0', cnt_5xx: '0',
      },
    ]);
    const html = buildValueBadges(new Date('2025-01-01T00:00:00Z'));
    assert.include(html, 'scrubber-value-ok');
    assert.notInclude(html, 'scrubber-value-4xx');
    assert.notInclude(html, 'scrubber-value-5xx');
  });
});

describe('buildAnomalyInfo', () => {
  beforeEach(() => {
    resetAnomalyBounds();
    setDetectedSteps([]);
    setChartLayout({
      width: 800,
      height: 400,
      padding: {
        top: 20, right: 0, bottom: 40, left: 0,
      },
      chartWidth: 800,
      chartHeight: 340,
      intendedStartTime: new Date('2025-01-01T00:00:00Z').getTime(),
      intendedEndTime: new Date('2025-01-01T01:00:00Z').getTime(),
    });
  });

  afterEach(() => {
    resetAnomalyBounds();
    setDetectedSteps([]);
    setChartLayout(null);
    resetLabels();
  });

  it('returns null when no anomaly at position', () => {
    assert.isNull(buildAnomalyInfo(400));
  });

  it('uses default 2xx label for green category', () => {
    const startTime = new Date('2025-01-01T00:10:00Z');
    const endTime = new Date('2025-01-01T00:20:00Z');
    addAnomalyBounds({
      left: 100, right: 300, startTime, endTime, rank: 1,
    });
    setDetectedSteps([{
      startIndex: 0,
      endIndex: 1,
      type: 'spike',
      magnitude: 2.0,
      category: 'green',
      rank: 1,
      startTime,
      endTime,
    }]);
    const html = buildAnomalyInfo(200);
    assert.include(html, '2xx');
  });

  it('uses default 4xx label for yellow category', () => {
    const startTime = new Date('2025-01-01T00:10:00Z');
    const endTime = new Date('2025-01-01T00:20:00Z');
    addAnomalyBounds({
      left: 100, right: 300, startTime, endTime, rank: 1,
    });
    setDetectedSteps([{
      startIndex: 0,
      endIndex: 1,
      type: 'spike',
      magnitude: 2.0,
      category: 'yellow',
      rank: 1,
      startTime,
      endTime,
    }]);
    const html = buildAnomalyInfo(200);
    assert.include(html, '4xx');
  });

  it('uses default 5xx label for red category', () => {
    const startTime = new Date('2025-01-01T00:10:00Z');
    const endTime = new Date('2025-01-01T00:20:00Z');
    addAnomalyBounds({
      left: 100, right: 300, startTime, endTime, rank: 1,
    });
    setDetectedSteps([{
      startIndex: 0,
      endIndex: 1,
      type: 'spike',
      magnitude: 2.0,
      category: 'red',
      rank: 1,
      startTime,
      endTime,
    }]);
    const html = buildAnomalyInfo(200);
    assert.include(html, '5xx');
  });

  it('uses custom labels for RUM configuration', () => {
    state.seriesLabels = { ok: 'good', client: 'needs improvement', server: 'poor' };
    const startTime = new Date('2025-01-01T00:10:00Z');
    const endTime = new Date('2025-01-01T00:20:00Z');
    addAnomalyBounds({
      left: 100, right: 300, startTime, endTime, rank: 1,
    });
    setDetectedSteps([{
      startIndex: 0,
      endIndex: 1,
      type: 'spike',
      magnitude: 2.0,
      category: 'green',
      rank: 1,
      startTime,
      endTime,
    }]);
    const html = buildAnomalyInfo(200);
    assert.include(html, 'good');
    assert.notInclude(html, '2xx');
  });

  it('uses custom server label for red category', () => {
    state.seriesLabels = { ok: 'good', client: 'needs improvement', server: 'poor' };
    const startTime = new Date('2025-01-01T00:10:00Z');
    const endTime = new Date('2025-01-01T00:20:00Z');
    addAnomalyBounds({
      left: 100, right: 300, startTime, endTime, rank: 1,
    });
    setDetectedSteps([{
      startIndex: 0,
      endIndex: 1,
      type: 'spike',
      magnitude: 2.0,
      category: 'red',
      rank: 1,
      startTime,
      endTime,
    }]);
    const html = buildAnomalyInfo(200);
    assert.include(html, 'poor');
    assert.notInclude(html, '5xx');
  });

  it('preserves CSS class regardless of custom labels', () => {
    state.seriesLabels = { ok: 'good', client: 'needs improvement', server: 'poor' };
    const startTime = new Date('2025-01-01T00:10:00Z');
    const endTime = new Date('2025-01-01T00:20:00Z');
    addAnomalyBounds({
      left: 100, right: 300, startTime, endTime, rank: 1,
    });
    setDetectedSteps([{
      startIndex: 0,
      endIndex: 1,
      type: 'spike',
      magnitude: 2.0,
      category: 'red',
      rank: 1,
      startTime,
      endTime,
    }]);
    const html = buildAnomalyInfo(200);
    assert.include(html, 'scrubber-anomaly-red');
  });
});
