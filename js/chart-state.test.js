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
  getDataAtTime, setLastChartData, calcStatusBarLeft, roundToNice,
} from './chart-state.js';

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
