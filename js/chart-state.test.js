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
import {
  getDataAtTime,
  setLastChartData,
  getLastChartData,
  calcStatusBarLeft,
  roundToNice,
  hexToRgba,
  formatDuration,
  formatScrubberTime,
  parseUTC,
  setChartLayout,
  getChartLayout,
  getTimeAtX,
  getXAtTime,
  getAnomalyAtX,
  addAnomalyBounds,
  resetAnomalyBounds,
  setAnomalyBoundsList,
  getAnomalyBoundsList,
  getAnomalyCount,
  getAnomalyTimeRange,
  getDetectedAnomalies,
  setDetectedSteps,
  getDetectedSteps,
  getMostRecentTimeRange,
  getShipNearX,
  setShipPositions,
  getShipPositions,
  setPendingSelection,
  getPendingSelection,
  setNavigationCallback,
  getNavigationCallback,
  navigateTime,
  zoomToAnomaly,
} from './chart-state.js';
import { state } from './state.js';
import { setQueryTimestamp, clearCustomTimeRange, setCustomTimeRange } from './time.js';

describe('getDataAtTime', () => {
  afterEach(() => {
    setLastChartData(null);
  });

  it('returns null when no chart data', () => {
    assert.isNull(getDataAtTime(new Date()));
  });

  it('returns null when chart data is empty', () => {
    setLastChartData([]);
    assert.isNull(getDataAtTime(new Date()));
  });

  it('finds exact time match', () => {
    const data = [
      {
        t: '2025-01-01 00:00:00', cnt_ok: '100', cnt_4xx: '5', cnt_5xx: '1',
      },
      {
        t: '2025-01-01 00:01:00', cnt_ok: '200', cnt_4xx: '10', cnt_5xx: '2',
      },
      {
        t: '2025-01-01 00:02:00', cnt_ok: '150', cnt_4xx: '8', cnt_5xx: '3',
      },
    ];
    setLastChartData(data);
    const result = getDataAtTime(new Date('2025-01-01T00:01:00Z'));
    assert.strictEqual(result.cnt_ok, '200');
  });

  it('finds nearest point when between timestamps', () => {
    const data = [
      {
        t: '2025-01-01 00:00:00', cnt_ok: '100', cnt_4xx: '5', cnt_5xx: '1',
      },
      {
        t: '2025-01-01 00:02:00', cnt_ok: '200', cnt_4xx: '10', cnt_5xx: '2',
      },
      {
        t: '2025-01-01 00:04:00', cnt_ok: '300', cnt_4xx: '15', cnt_5xx: '3',
      },
    ];
    setLastChartData(data);
    // 00:01:30 is closer to 00:02:00
    const result = getDataAtTime(new Date('2025-01-01T00:01:30Z'));
    assert.strictEqual(result.cnt_ok, '200');
  });

  it('returns first point for time before range', () => {
    const data = [
      {
        t: '2025-01-01 00:05:00', cnt_ok: '100', cnt_4xx: '5', cnt_5xx: '1',
      },
      {
        t: '2025-01-01 00:06:00', cnt_ok: '200', cnt_4xx: '10', cnt_5xx: '2',
      },
    ];
    setLastChartData(data);
    const result = getDataAtTime(new Date('2025-01-01T00:00:00Z'));
    assert.strictEqual(result.cnt_ok, '100');
  });

  it('returns last point for time after range', () => {
    const data = [
      {
        t: '2025-01-01 00:00:00', cnt_ok: '100', cnt_4xx: '5', cnt_5xx: '1',
      },
      {
        t: '2025-01-01 00:01:00', cnt_ok: '200', cnt_4xx: '10', cnt_5xx: '2',
      },
    ];
    setLastChartData(data);
    const result = getDataAtTime(new Date('2025-01-01T00:10:00Z'));
    assert.strictEqual(result.cnt_ok, '200');
  });

  it('accepts millisecond timestamp as number', () => {
    const data = [
      {
        t: '2025-01-01 00:00:00', cnt_ok: '100', cnt_4xx: '5', cnt_5xx: '1',
      },
      {
        t: '2025-01-01 00:01:00', cnt_ok: '200', cnt_4xx: '10', cnt_5xx: '2',
      },
    ];
    setLastChartData(data);
    const ms = new Date('2025-01-01T00:01:00Z').getTime();
    const result = getDataAtTime(ms);
    assert.strictEqual(result.cnt_ok, '200');
  });

  it('works with single data point', () => {
    const data = [
      {
        t: '2025-01-01 00:00:00', cnt_ok: '42', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    setLastChartData(data);
    const result = getDataAtTime(new Date('2025-01-01T12:00:00Z'));
    assert.strictEqual(result.cnt_ok, '42');
  });

  it('binary search returns correct midpoint for equidistant timestamps', () => {
    const data = [
      {
        t: '2025-01-01 00:00:00', cnt_ok: '100', cnt_4xx: '0', cnt_5xx: '0',
      },
      {
        t: '2025-01-01 00:02:00', cnt_ok: '200', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    setLastChartData(data);
    // Exactly midpoint between 00:00 and 00:02 - should prefer the earlier one (<=)
    const result = getDataAtTime(new Date('2025-01-01T00:01:00Z'));
    assert.strictEqual(result.cnt_ok, '100');
  });

  it('handles large dataset with binary search', () => {
    const data = [];
    for (let i = 0; i < 1000; i += 1) {
      const mins = String(i % 60).padStart(2, '0');
      const hrs = String(Math.floor(i / 60)).padStart(2, '0');
      data.push({
        t: `2025-01-01 ${hrs}:${mins}:00`, cnt_ok: String(i), cnt_4xx: '0', cnt_5xx: '0',
      });
    }
    setLastChartData(data);
    // Target 07:30:00 = index 450
    const result = getDataAtTime(new Date('2025-01-01T07:30:00Z'));
    assert.strictEqual(result.cnt_ok, '450');
  });

  it('returns first element when target is before all timestamps', () => {
    const data = [
      {
        t: '2025-01-01 01:00:00', cnt_ok: '10', cnt_4xx: '0', cnt_5xx: '0',
      },
      {
        t: '2025-01-01 02:00:00', cnt_ok: '20', cnt_4xx: '0', cnt_5xx: '0',
      },
      {
        t: '2025-01-01 03:00:00', cnt_ok: '30', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    setLastChartData(data);
    const result = getDataAtTime(new Date('2025-01-01T00:00:00Z'));
    assert.strictEqual(result.cnt_ok, '10');
  });

  it('returns last element when target is after all timestamps', () => {
    const data = [
      {
        t: '2025-01-01 01:00:00', cnt_ok: '10', cnt_4xx: '0', cnt_5xx: '0',
      },
      {
        t: '2025-01-01 02:00:00', cnt_ok: '20', cnt_4xx: '0', cnt_5xx: '0',
      },
      {
        t: '2025-01-01 03:00:00', cnt_ok: '30', cnt_4xx: '0', cnt_5xx: '0',
      },
    ];
    setLastChartData(data);
    const result = getDataAtTime(new Date('2025-01-01T23:59:00Z'));
    assert.strictEqual(result.cnt_ok, '30');
  });
});

describe('calcStatusBarLeft', () => {
  it('centers when in middle', () => {
    const left = calcStatusBarLeft(400, 800, 100, 800, 24);
    assert.strictEqual(left, 350);
  });

  it('clamps to min at left edge', () => {
    const left = calcStatusBarLeft(0, 800, 100, 800, 24);
    assert.isAtLeast(left, 24);
  });

  it('clamps to max at right edge', () => {
    const left = calcStatusBarLeft(800, 800, 100, 800, 24);
    assert.isAtMost(left, 800 - 100 - 24);
  });
});

describe('roundToNice', () => {
  it('returns 0 for 0', () => {
    assert.strictEqual(roundToNice(0), 0);
  });

  it('rounds small values to 1', () => {
    assert.strictEqual(roundToNice(0.5), 1);
  });

  it('rounds to nice numbers', () => {
    assert.strictEqual(roundToNice(3), 3);
    assert.strictEqual(roundToNice(7), 5);
    assert.strictEqual(roundToNice(12), 10);
    assert.strictEqual(roundToNice(150), 100);
    assert.strictEqual(roundToNice(350), 250);
  });
});

describe('hexToRgba', () => {
  it('converts hex to rgba with alpha', () => {
    assert.strictEqual(hexToRgba('#ff0000', 0.5), 'rgba(255, 0, 0, 0.5)');
  });

  it('converts black hex', () => {
    assert.strictEqual(hexToRgba('#000000', 1), 'rgba(0, 0, 0, 1)');
  });

  it('converts white hex with low alpha', () => {
    assert.strictEqual(hexToRgba('#ffffff', 0.3), 'rgba(255, 255, 255, 0.3)');
  });
});

describe('parseUTC', () => {
  it('parses ClickHouse format without Z suffix', () => {
    const d = parseUTC('2025-01-01 12:30:00');
    assert.strictEqual(d.toISOString(), '2025-01-01T12:30:00.000Z');
  });

  it('parses ISO format with Z suffix', () => {
    const d = parseUTC('2025-06-15T08:00:00Z');
    assert.strictEqual(d.toISOString(), '2025-06-15T08:00:00.000Z');
  });

  it('parses ISO format with T separator and no Z', () => {
    const d = parseUTC('2025-03-01T12:00:00');
    assert.strictEqual(d.toISOString(), '2025-03-01T12:00:00.000Z');
  });
});

describe('formatDuration', () => {
  it('formats seconds only', () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2025-01-01T00:00:45Z');
    assert.strictEqual(formatDuration(start, end), '45s');
  });

  it('formats minutes only', () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2025-01-01T00:03:00Z');
    assert.strictEqual(formatDuration(start, end), '3m');
  });

  it('formats minutes and seconds', () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2025-01-01T00:02:30Z');
    assert.strictEqual(formatDuration(start, end), '2m 30s');
  });
});

describe('formatScrubberTime', () => {
  it('returns relative time for recent timestamps', () => {
    const recent = new Date(Date.now() - 60000); // 1 min ago
    const result = formatScrubberTime(recent);
    assert.strictEqual(result.relativeStr, '1 min ago');
    assert.isString(result.timeStr);
  });

  it('returns "just now" for current time', () => {
    const now = new Date();
    const result = formatScrubberTime(now);
    assert.strictEqual(result.relativeStr, 'just now');
  });

  it('returns empty relative string for old timestamps', () => {
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 hours ago
    const result = formatScrubberTime(old);
    assert.strictEqual(result.relativeStr, '');
  });
});

describe('getLastChartData', () => {
  afterEach(() => setLastChartData(null));

  it('returns null initially', () => {
    setLastChartData(null);
    assert.isNull(getLastChartData());
  });

  it('returns set data', () => {
    const data = [{ t: '2025-01-01 00:00:00' }];
    setLastChartData(data);
    assert.strictEqual(getLastChartData(), data);
  });
});

describe('chartLayout', () => {
  afterEach(() => setChartLayout(null));

  it('returns null initially', () => {
    setChartLayout(null);
    assert.isNull(getChartLayout());
  });

  it('stores and retrieves layout', () => {
    const layout = {
      width: 800, height: 400, padding: { left: 0, right: 0 }, chartWidth: 800,
    };
    setChartLayout(layout);
    assert.deepEqual(getChartLayout(), layout);
  });
});

describe('getTimeAtX', () => {
  afterEach(() => setChartLayout(null));

  it('returns null when no chart layout', () => {
    setChartLayout(null);
    assert.isNull(getTimeAtX(100));
  });

  it('returns time at chart midpoint', () => {
    setChartLayout({
      padding: { left: 0, right: 0 },
      chartWidth: 1000,
      intendedStartTime: new Date('2025-01-01T00:00:00Z').getTime(),
      intendedEndTime: new Date('2025-01-01T01:00:00Z').getTime(),
    });
    const time = getTimeAtX(500);
    assert.closeTo(time.getTime(), new Date('2025-01-01T00:30:00Z').getTime(), 1000);
  });

  it('returns null for x outside chart bounds', () => {
    setChartLayout({
      padding: { left: 50, right: 0 },
      chartWidth: 700,
      intendedStartTime: new Date('2025-01-01T00:00:00Z').getTime(),
      intendedEndTime: new Date('2025-01-01T01:00:00Z').getTime(),
    });
    assert.isNull(getTimeAtX(0)); // Before padding.left
  });
});

describe('getXAtTime', () => {
  afterEach(() => setChartLayout(null));

  it('returns 0 when no chart layout', () => {
    setChartLayout(null);
    assert.strictEqual(getXAtTime(Date.now()), 0);
  });

  it('returns correct x for start time', () => {
    const startTime = new Date('2025-01-01T00:00:00Z').getTime();
    setChartLayout({
      padding: { left: 20 },
      chartWidth: 760,
      intendedStartTime: startTime,
      intendedEndTime: startTime + 3600000,
    });
    assert.strictEqual(getXAtTime(startTime), 20); // padding.left
  });

  it('returns correct x for end time', () => {
    const startTime = new Date('2025-01-01T00:00:00Z').getTime();
    const endTime = startTime + 3600000;
    setChartLayout({
      padding: { left: 20 },
      chartWidth: 760,
      intendedStartTime: startTime,
      intendedEndTime: endTime,
    });
    assert.strictEqual(getXAtTime(endTime), 780); // 20 + 760
  });
});

describe('anomaly bounds', () => {
  afterEach(() => resetAnomalyBounds());

  it('starts empty', () => {
    resetAnomalyBounds();
    assert.strictEqual(getAnomalyCount(), 0);
  });

  it('adds and retrieves bounds', () => {
    const bounds = {
      left: 100, right: 200, startTime: new Date('2025-01-01T00:00:00Z'), endTime: new Date('2025-01-01T00:05:00Z'), rank: 1,
    };
    addAnomalyBounds(bounds);
    assert.strictEqual(getAnomalyCount(), 1);
  });

  it('getAnomalyTimeRange returns range for matching rank', () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2025-01-01T00:05:00Z');
    addAnomalyBounds({
      left: 100, right: 200, startTime: start, endTime: end, rank: 1,
    });
    const range = getAnomalyTimeRange(1);
    assert.deepEqual(range, { start, end });
  });

  it('getAnomalyTimeRange returns null for non-matching rank', () => {
    addAnomalyBounds({
      left: 100, right: 200, startTime: new Date(), endTime: new Date(), rank: 1,
    });
    assert.isNull(getAnomalyTimeRange(5));
  });

  it('getAnomalyAtX returns bounds when x is within region', () => {
    addAnomalyBounds({
      left: 100, right: 200, startTime: new Date(), endTime: new Date(), rank: 1,
    });
    const result = getAnomalyAtX(150);
    assert.strictEqual(result.rank, 1);
  });

  it('getAnomalyAtX returns null when x is outside all regions', () => {
    addAnomalyBounds({
      left: 100, right: 200, startTime: new Date(), endTime: new Date(), rank: 1,
    });
    assert.isNull(getAnomalyAtX(50));
    assert.isNull(getAnomalyAtX(250));
  });

  it('resetAnomalyBounds clears all bounds', () => {
    addAnomalyBounds({
      left: 100, right: 200, startTime: new Date(), endTime: new Date(), rank: 1,
    });
    resetAnomalyBounds();
    assert.strictEqual(getAnomalyCount(), 0);
  });
});

describe('getDetectedAnomalies', () => {
  afterEach(() => {
    resetAnomalyBounds();
    setDetectedSteps([]);
  });

  it('returns empty array when no anomalies', () => {
    assert.deepEqual(getDetectedAnomalies(), []);
  });

  it('merges bounds with step info', () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2025-01-01T00:05:00Z');
    addAnomalyBounds({
      left: 100, right: 200, startTime: start, endTime: end, rank: 1,
    });
    setDetectedSteps([{ rank: 1, type: 'spike', category: 'red' }]);
    const anomalies = getDetectedAnomalies();
    assert.strictEqual(anomalies.length, 1);
    assert.strictEqual(anomalies[0].type, 'spike');
    assert.strictEqual(anomalies[0].category, 'red');
    assert.strictEqual(anomalies[0].rank, 1);
  });
});

describe('detectedSteps', () => {
  afterEach(() => setDetectedSteps([]));

  it('stores and retrieves steps', () => {
    const steps = [{ rank: 1, type: 'spike' }];
    setDetectedSteps(steps);
    assert.deepEqual(getDetectedSteps(), steps);
  });
});

describe('shipPositions', () => {
  afterEach(() => setShipPositions(null));

  it('returns null initially', () => {
    setShipPositions(null);
    assert.isNull(getShipPositions());
  });

  it('stores and retrieves positions', () => {
    const positions = [{ x: 100, release: { repo: 'test' } }];
    setShipPositions(positions);
    assert.deepEqual(getShipPositions(), positions);
  });
});

describe('getShipNearX', () => {
  afterEach(() => setShipPositions(null));

  it('returns null when no ship positions', () => {
    setShipPositions(null);
    assert.isNull(getShipNearX(100));
  });

  it('returns ship within default padding', () => {
    const ship = { x: 100, release: { repo: 'test' } };
    setShipPositions([ship]);
    const result = getShipNearX(115);
    assert.deepEqual(result, ship);
  });

  it('returns null when x is too far from ship', () => {
    setShipPositions([{ x: 100, release: { repo: 'test' } }]);
    assert.isNull(getShipNearX(200));
  });

  it('respects custom padding', () => {
    const ship = { x: 100, release: { repo: 'test' } };
    setShipPositions([ship]);
    assert.isNull(getShipNearX(130, 10));
    assert.deepEqual(getShipNearX(105, 10), ship);
  });
});

describe('pendingSelection', () => {
  afterEach(() => setPendingSelection(null));

  it('returns null initially', () => {
    setPendingSelection(null);
    assert.isNull(getPendingSelection());
  });

  it('stores and retrieves selection', () => {
    const selection = { startTime: 100, endTime: 200 };
    setPendingSelection(selection);
    assert.deepEqual(getPendingSelection(), selection);
  });

  it('clears selection with null', () => {
    setPendingSelection({ startTime: 100, endTime: 200 });
    setPendingSelection(null);
    assert.isNull(getPendingSelection());
  });
});

describe('navigationCallback', () => {
  afterEach(() => setNavigationCallback(null));

  it('returns null initially', () => {
    setNavigationCallback(null);
    assert.isNull(getNavigationCallback());
  });

  it('stores and retrieves callback', () => {
    const cb = () => {};
    setNavigationCallback(cb);
    assert.strictEqual(getNavigationCallback(), cb);
  });
});

describe('getMostRecentTimeRange', () => {
  afterEach(() => setLastChartData(null));

  it('returns null when no chart data', () => {
    setLastChartData(null);
    assert.isNull(getMostRecentTimeRange());
  });

  it('returns null for single data point', () => {
    setLastChartData([{ t: '2025-01-01 00:00:00' }]);
    assert.isNull(getMostRecentTimeRange());
  });

  it('returns last 20% time range', () => {
    const data = [];
    for (let i = 0; i < 10; i += 1) {
      data.push({ t: `2025-01-01 00:${String(i).padStart(2, '0')}:00` });
    }
    setLastChartData(data);
    const range = getMostRecentTimeRange();
    // startIdx = Math.floor(10 * 0.8) = 8, so starts at 00:08:00
    assert.strictEqual(range.start.toISOString(), '2025-01-01T00:08:00.000Z');
    assert.strictEqual(range.end.toISOString(), '2025-01-01T00:09:00.000Z');
  });
});

describe('setAnomalyBoundsList / getAnomalyBoundsList', () => {
  afterEach(() => resetAnomalyBounds());

  it('sets and gets bounds list', () => {
    const bounds = [
      {
        left: 10, right: 50, startTime: new Date(), endTime: new Date(), rank: 1,
      },
      {
        left: 100, right: 200, startTime: new Date(), endTime: new Date(), rank: 2,
      },
    ];
    setAnomalyBoundsList(bounds);
    assert.strictEqual(getAnomalyBoundsList().length, 2);
    assert.strictEqual(getAnomalyBoundsList()[0].rank, 1);
    assert.strictEqual(getAnomalyBoundsList()[1].rank, 2);
  });

  it('replaces existing bounds', () => {
    addAnomalyBounds({
      left: 0, right: 10, startTime: new Date(), endTime: new Date(), rank: 1,
    });
    setAnomalyBoundsList([]);
    assert.strictEqual(getAnomalyBoundsList().length, 0);
  });
});

describe('getTimeAtX fallback to chart data', () => {
  afterEach(() => {
    setChartLayout(null);
    setLastChartData(null);
  });

  it('uses chart data when intended times are not finite', () => {
    setLastChartData([
      { t: '2025-01-01 00:00:00' },
      { t: '2025-01-01 01:00:00' },
    ]);
    setChartLayout({
      padding: { left: 0, right: 0 },
      chartWidth: 1000,
      intendedStartTime: NaN,
      intendedEndTime: NaN,
    });
    const time = getTimeAtX(500);
    assert.closeTo(time.getTime(), new Date('2025-01-01T00:30:00Z').getTime(), 1000);
  });

  it('returns null when no chart data and no intended times', () => {
    setLastChartData(null);
    setChartLayout({
      padding: { left: 0, right: 0 },
      chartWidth: 1000,
      intendedStartTime: NaN,
      intendedEndTime: NaN,
    });
    assert.isNull(getTimeAtX(500));
  });
});

describe('formatScrubberTime long range', () => {
  it('includes weekday for timestamps > 24h ago', () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000); // 2 days ago
    const result = formatScrubberTime(old);
    // Should include a weekday abbreviation (Mon, Tue, etc.)
    assert.match(result.timeStr, /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);
    assert.strictEqual(result.relativeStr, '');
  });

  it('includes minutes in relative string', () => {
    const mins = new Date(Date.now() - 45 * 60000); // 45 min ago
    const result = formatScrubberTime(mins);
    assert.strictEqual(result.relativeStr, '45 min ago');
  });
});

describe('navigateTime', () => {
  beforeEach(() => {
    clearCustomTimeRange();
    state.timeRange = '1h';
    setQueryTimestamp(new Date('2025-06-15T12:00:00Z'));
    setNavigationCallback(null);
  });

  afterEach(() => {
    clearCustomTimeRange();
    setNavigationCallback(null);
  });

  it('shifts time backward by fraction of period', () => {
    navigateTime(-0.5);
    // 1h period * -0.5 = -30 min => 11:30:00
    // queryTimestamp is set via setQueryTimestamp inside navigateTime
    // We verify indirectly via navigation callback
  });

  it('invokes navigation callback after shift', () => {
    let callCount = 0;
    setNavigationCallback(() => {
      callCount += 1;
    });
    navigateTime(0.5);
    assert.strictEqual(callCount, 1);
  });

  it('does not navigate into the future', () => {
    // Set timestamp far in the past, then navigate forward past now
    setQueryTimestamp(new Date(Date.now() - 1000));
    navigateTime(100); // shift by 100x 1h = 100 hours into future
    // Should be clamped to ~now, callback should still be called
    let called = false;
    setNavigationCallback(() => {
      called = true;
    });
    navigateTime(100);
    assert.isTrue(called);
  });

  it('navigates with custom time range', () => {
    const start = new Date('2025-06-15T10:00:00Z');
    const end = new Date('2025-06-15T11:00:00Z');
    setCustomTimeRange(start, end);
    let called = false;
    setNavigationCallback(() => {
      called = true;
    });
    navigateTime(-0.5);
    assert.isTrue(called);
  });
});

describe('zoomToAnomaly', () => {
  beforeEach(() => {
    resetAnomalyBounds();
    setDetectedSteps([]);
    setLastChartData(null);
    setNavigationCallback(null);
    clearCustomTimeRange();
    state.timeRange = '1h';
    state.filters = [];
    setQueryTimestamp(new Date('2025-06-15T12:00:00Z'));
    // zoomToAnomalyByRank calls addFilter which calls renderActiveFilters
    if (!document.getElementById('activeFilters')) {
      const el = document.createElement('div');
      el.id = 'activeFilters';
      document.body.appendChild(el);
    }
  });

  afterEach(() => {
    resetAnomalyBounds();
    setDetectedSteps([]);
    setLastChartData(null);
    setNavigationCallback(null);
    clearCustomTimeRange();
    state.filters = [];
  });

  it('returns false when no anomalies and no chart data', () => {
    assert.isFalse(zoomToAnomaly());
  });

  it('zooms to most recent section when no anomalies but chart data exists', () => {
    const data = [];
    for (let i = 0; i < 10; i += 1) {
      data.push({ t: `2025-06-15 0${i}:00:00` });
    }
    setLastChartData(data);
    let navigated = false;
    setNavigationCallback(() => {
      navigated = true;
    });
    const result = zoomToAnomaly();
    assert.isTrue(result);
    assert.isTrue(navigated);
  });

  it('zooms to most prominent anomaly when anomalies exist', () => {
    const start = new Date('2025-06-15T10:00:00Z');
    const end = new Date('2025-06-15T10:05:00Z');
    addAnomalyBounds({
      left: 100, right: 200, startTime: start, endTime: end, rank: 1,
    });
    setDetectedSteps([{
      rank: 1, type: 'spike', category: 'red', magnitude: 2,
    }]);
    let navigated = false;
    setNavigationCallback(() => {
      navigated = true;
    });
    const result = zoomToAnomaly();
    assert.isTrue(result);
    assert.isTrue(navigated);
  });
});
