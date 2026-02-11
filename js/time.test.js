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
import { assert } from 'chai';
import { state } from './state.js';
import {
  setQueryTimestamp, setCustomTimeRange, clearCustomTimeRange,
  getTimeFilter, getTimeBucket, getPeriodMs,
  getTimeRangeBounds, getTimeRangeStart, getTimeRangeEnd,
  getTable, getHostFilter,
  getSamplingConfig, getFacetTimeFilter,
} from './time.js';

beforeEach(() => {
  clearCustomTimeRange();
  state.timeRange = '1h';
  state.hostFilter = '';
  state.hostFilterColumn = null;
  state.tableName = null;
  setQueryTimestamp(new Date('2026-01-20T12:34:56Z'));
});

describe('time helpers', () => {
  it('builds deterministic time filter for standard range', () => {
    const filter = getTimeFilter();
    assert.ok(filter.includes("toDateTime('2026-01-20 11:34:00')"));
    assert.ok(filter.includes("toDateTime('2026-01-20 12:34:00')"));
  });

  it('rounds custom time range to minute boundaries and enforces min window', () => {
    const start = new Date('2026-01-20T12:00:10Z');
    const end = new Date('2026-01-20T12:01:20Z');
    setCustomTimeRange(start, end);

    const filter = getTimeFilter();
    assert.ok(filter.includes('2026-01-20 11:59:00'));
    assert.ok(filter.includes('2026-01-20 12:02:00'));
  });

  it('uses expected bucket for short custom range', () => {
    const start = new Date('2026-01-20T12:00:00Z');
    const end = new Date('2026-01-20T12:10:00Z');
    setCustomTimeRange(start, end);
    const bucket = getTimeBucket();
    assert.strictEqual(bucket, 'toStartOfInterval(timestamp, INTERVAL 5 SECOND)');
  });

  it('aligns fill bounds for standard range to bucket step', () => {
    const { start, end } = getTimeRangeBounds();
    assert.strictEqual(start.toISOString(), '2026-01-20T11:34:00.000Z');
    assert.strictEqual(end.toISOString(), '2026-01-20T12:34:50.000Z');
    assert.ok(getTimeRangeStart().includes('2026-01-20 11:34:00'));
    assert.ok(getTimeRangeEnd().includes('2026-01-20 12:34:50'));
  });

  it('aligns fill bounds for custom range to bucket step', () => {
    const start = new Date('2026-01-20T12:00:10Z');
    const end = new Date('2026-01-20T12:01:20Z');
    setCustomTimeRange(start, end);
    const bounds = getTimeRangeBounds();
    assert.strictEqual(bounds.start.toISOString(), '2026-01-20T11:59:00.000Z');
    assert.strictEqual(bounds.end.toISOString(), '2026-01-20T12:02:55.000Z');
  });

  it('returns correct period in ms for current range', () => {
    state.timeRange = '12h';
    clearCustomTimeRange();
    assert.strictEqual(getPeriodMs(), 12 * 60 * 60 * 1000);
  });
});

describe('getTable', () => {
  it('returns cdn_requests_v2 when state.tableName is not set', () => {
    state.tableName = null;
    assert.strictEqual(getTable(), 'cdn_requests_v2');
  });

  it('returns state.tableName when set', () => {
    state.tableName = 'lambda_logs';
    assert.strictEqual(getTable(), 'lambda_logs');
  });
});

describe('getHostFilter', () => {
  it('returns empty string when no hostFilter', () => {
    state.hostFilter = '';
    assert.strictEqual(getHostFilter(), '');
  });

  it('returns CDN host filter when hostFilterColumn not set', () => {
    state.hostFilter = 'example';
    state.hostFilterColumn = null;
    const result = getHostFilter();
    assert.include(result, 'request.host');
    assert.include(result, 'x_forwarded_host');
    assert.include(result, 'example');
  });

  it('returns column filter when hostFilterColumn is set', () => {
    state.hostFilter = 'myFunc';
    state.hostFilterColumn = 'function_name';
    const result = getHostFilter();
    assert.include(result, '`function_name`');
    assert.include(result, 'myFunc');
  });

  it('escapes single quotes in hostFilter', () => {
    state.hostFilter = "o'Brien";
    state.hostFilterColumn = 'function_name';
    const result = getHostFilter();
    assert.include(result, "\\'");
  });
});

describe('getSamplingConfig', () => {
  it('returns no sampling for 15m range', () => {
    state.timeRange = '15m';
    clearCustomTimeRange();
    const { sampleClause, multiplier } = getSamplingConfig();
    assert.strictEqual(sampleClause, '');
    assert.strictEqual(multiplier, 1);
  });

  it('returns no sampling for 1h range', () => {
    state.timeRange = '1h';
    clearCustomTimeRange();
    const { sampleClause, multiplier } = getSamplingConfig();
    assert.strictEqual(sampleClause, '');
    assert.strictEqual(multiplier, 1);
  });

  it('returns sampling for 12h range', () => {
    state.timeRange = '12h';
    clearCustomTimeRange();
    const { sampleClause, multiplier } = getSamplingConfig();
    assert.include(sampleClause, 'SAMPLE');
    assert.isAbove(multiplier, 1);
    // 12h = 12× baseline, so multiplier should be ~12
    assert.strictEqual(multiplier, 12);
  });

  it('returns sampling for 7d range', () => {
    state.timeRange = '7d';
    clearCustomTimeRange();
    const { sampleClause, multiplier } = getSamplingConfig();
    assert.include(sampleClause, 'SAMPLE');
    // 7d = 168h; after rounding sample rate to 4 decimals, multiplier is 167
    assert.strictEqual(multiplier, 167);
  });

  it('returns proportional sampling for 24h range', () => {
    state.timeRange = '24h';
    clearCustomTimeRange();
    const { sampleClause, multiplier } = getSamplingConfig();
    assert.include(sampleClause, 'SAMPLE');
    assert.strictEqual(multiplier, 24);
  });

  it('returns no sampling for short custom range', () => {
    setCustomTimeRange(
      new Date('2026-01-20T12:00:00Z'),
      new Date('2026-01-20T12:30:00Z'),
    );
    const { sampleClause, multiplier } = getSamplingConfig();
    assert.strictEqual(sampleClause, '');
    assert.strictEqual(multiplier, 1);
  });

  it('returns sampling for long custom range (6h)', () => {
    setCustomTimeRange(
      new Date('2026-01-20T06:00:00Z'),
      new Date('2026-01-20T12:00:00Z'),
    );
    const { sampleClause, multiplier } = getSamplingConfig();
    assert.include(sampleClause, 'SAMPLE');
    assert.strictEqual(multiplier, 6);
  });
});

describe('getFacetTimeFilter', () => {
  it('returns formatted start and end times', () => {
    state.timeRange = '1h';
    clearCustomTimeRange();
    setQueryTimestamp(new Date('2026-01-20T12:34:56Z'));
    const { startTime, endTime } = getFacetTimeFilter();
    assert.strictEqual(startTime, '2026-01-20 11:34:00');
    assert.strictEqual(endTime, '2026-01-20 12:34:00');
  });
});
