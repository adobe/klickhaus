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
import { state } from './state.js';
import {
  setQueryTimestamp, setCustomTimeRange, clearCustomTimeRange,
  isCustomTimeRange, getCustomTimeRange, customTimeRange,
  getTimeFilter, getTimeBucket, getTimeBucketStep, getPeriodMs,
  getInterval, getTimeRangeBounds, getTimeRangeStart, getTimeRangeEnd,
  getTable, getHostFilter,
  getSamplingConfig, getFacetTimeFilter, zoomOut,
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

  it('never returns Infinity or NaN multiplier for extreme time ranges', () => {
    // 30-day custom range — ratio rounds to 0 without the floor clamp
    setCustomTimeRange(
      new Date('2025-12-21T00:00:00Z'),
      new Date('2026-01-20T00:00:00Z'),
    );
    const { sampleClause, multiplier } = getSamplingConfig();
    assert.include(sampleClause, 'SAMPLE');
    assert.isFinite(multiplier);
    assert.isAbove(multiplier, 0);
    assert.isFalse(Number.isNaN(multiplier));
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

  it('returns formatted times for custom time range', () => {
    setCustomTimeRange(
      new Date('2026-01-20T10:00:00Z'),
      new Date('2026-01-20T11:00:00Z'),
    );
    const { startTime, endTime } = getFacetTimeFilter();
    assert.strictEqual(startTime, '2026-01-20 10:00:00');
    assert.strictEqual(endTime, '2026-01-20 11:00:00');
  });
});

describe('custom time range state', () => {
  it('isCustomTimeRange returns false when no custom range set', () => {
    clearCustomTimeRange();
    assert.isFalse(isCustomTimeRange());
  });

  it('isCustomTimeRange returns true when custom range is set', () => {
    setCustomTimeRange(
      new Date('2026-01-20T10:00:00Z'),
      new Date('2026-01-20T11:00:00Z'),
    );
    assert.isTrue(isCustomTimeRange());
  });

  it('getCustomTimeRange returns null when no custom range set', () => {
    clearCustomTimeRange();
    assert.isNull(getCustomTimeRange());
  });

  it('getCustomTimeRange returns the range when set', () => {
    setCustomTimeRange(
      new Date('2026-01-20T10:00:00Z'),
      new Date('2026-01-20T11:00:00Z'),
    );
    const range = getCustomTimeRange();
    assert.ok(range);
    assert.ok(range.start instanceof Date);
    assert.ok(range.end instanceof Date);
  });

  it('customTimeRange getter returns same as getCustomTimeRange', () => {
    setCustomTimeRange(
      new Date('2026-01-20T10:00:00Z'),
      new Date('2026-01-20T11:00:00Z'),
    );
    assert.deepEqual(customTimeRange(), getCustomTimeRange());
  });

  it('clearCustomTimeRange clears an active range', () => {
    setCustomTimeRange(
      new Date('2026-01-20T10:00:00Z'),
      new Date('2026-01-20T11:00:00Z'),
    );
    assert.isTrue(isCustomTimeRange());
    clearCustomTimeRange();
    assert.isFalse(isCustomTimeRange());
    assert.isNull(getCustomTimeRange());
  });

  it('setCustomTimeRange with range exceeding min duration stores rounded bounds', () => {
    // 30 min range, well above 3 min minimum
    setCustomTimeRange(
      new Date('2026-01-20T10:00:30Z'),
      new Date('2026-01-20T10:30:45Z'),
    );
    const range = getCustomTimeRange();
    // start rounds down to minute, end rounds up to minute
    assert.strictEqual(range.start.toISOString(), '2026-01-20T10:00:00.000Z');
    assert.strictEqual(range.end.toISOString(), '2026-01-20T10:31:00.000Z');
  });
});

describe('getInterval', () => {
  it('returns predefined interval for standard range', () => {
    state.timeRange = '1h';
    clearCustomTimeRange();
    assert.strictEqual(getInterval(), 'INTERVAL 1 HOUR');
  });

  it('returns calculated interval for custom time range', () => {
    // 30 min range
    setCustomTimeRange(
      new Date('2026-01-20T10:00:00Z'),
      new Date('2026-01-20T10:30:00Z'),
    );
    assert.strictEqual(getInterval(), 'INTERVAL 30 MINUTE');
  });

  it('returns interval proportional to custom range duration', () => {
    // 2 hour range = 120 minutes
    setCustomTimeRange(
      new Date('2026-01-20T10:00:00Z'),
      new Date('2026-01-20T12:00:00Z'),
    );
    assert.strictEqual(getInterval(), 'INTERVAL 120 MINUTE');
  });
});

describe('getTimeBucket for various custom durations', () => {
  it('uses 10 second bucket for 15-60 min custom range', () => {
    // 30 min range
    setCustomTimeRange(
      new Date('2026-01-20T10:00:00Z'),
      new Date('2026-01-20T10:30:00Z'),
    );
    assert.strictEqual(getTimeBucket(), 'toStartOfInterval(timestamp, INTERVAL 10 SECOND)');
  });

  it('uses 1 minute bucket for 1-12 hour custom range', () => {
    // 6 hour range
    setCustomTimeRange(
      new Date('2026-01-20T06:00:00Z'),
      new Date('2026-01-20T12:00:00Z'),
    );
    assert.strictEqual(getTimeBucket(), 'toStartOfMinute(timestamp)');
  });

  it('uses 5 minute bucket for 12-24 hour custom range', () => {
    // 18 hour range
    setCustomTimeRange(
      new Date('2026-01-20T00:00:00Z'),
      new Date('2026-01-20T18:00:00Z'),
    );
    assert.strictEqual(getTimeBucket(), 'toStartOfFiveMinutes(timestamp)');
  });

  it('uses 10 minute bucket for >24 hour custom range', () => {
    // 48 hour range
    setCustomTimeRange(
      new Date('2026-01-18T00:00:00Z'),
      new Date('2026-01-20T00:00:00Z'),
    );
    assert.strictEqual(getTimeBucket(), 'toStartOfTenMinutes(timestamp)');
  });

  it('returns predefined bucket for standard range', () => {
    state.timeRange = '1h';
    clearCustomTimeRange();
    assert.strictEqual(getTimeBucket(), 'toStartOfInterval(timestamp, INTERVAL 10 SECOND)');
  });
});

describe('getTimeBucketStep for various custom durations', () => {
  it('returns 5 second step for <=15 min custom range', () => {
    setCustomTimeRange(
      new Date('2026-01-20T12:00:00Z'),
      new Date('2026-01-20T12:10:00Z'),
    );
    assert.strictEqual(getTimeBucketStep(), 'INTERVAL 5 SECOND');
  });

  it('returns 10 second step for 15-60 min custom range', () => {
    setCustomTimeRange(
      new Date('2026-01-20T12:00:00Z'),
      new Date('2026-01-20T12:30:00Z'),
    );
    assert.strictEqual(getTimeBucketStep(), 'INTERVAL 10 SECOND');
  });

  it('returns 1 minute step for 1-12 hour custom range', () => {
    setCustomTimeRange(
      new Date('2026-01-20T06:00:00Z'),
      new Date('2026-01-20T12:00:00Z'),
    );
    assert.strictEqual(getTimeBucketStep(), 'INTERVAL 1 MINUTE');
  });

  it('returns 5 minute step for 12-24 hour custom range', () => {
    setCustomTimeRange(
      new Date('2026-01-20T00:00:00Z'),
      new Date('2026-01-20T18:00:00Z'),
    );
    assert.strictEqual(getTimeBucketStep(), 'INTERVAL 5 MINUTE');
  });

  it('returns 10 minute step for >24 hour custom range', () => {
    setCustomTimeRange(
      new Date('2026-01-18T00:00:00Z'),
      new Date('2026-01-20T00:00:00Z'),
    );
    assert.strictEqual(getTimeBucketStep(), 'INTERVAL 10 MINUTE');
  });

  it('returns predefined step for standard range', () => {
    state.timeRange = '1h';
    clearCustomTimeRange();
    assert.strictEqual(getTimeBucketStep(), 'INTERVAL 10 SECOND');
  });
});

describe('getPeriodMs', () => {
  it('returns custom range duration when set', () => {
    setCustomTimeRange(
      new Date('2026-01-20T10:00:00Z'),
      new Date('2026-01-20T11:00:00Z'),
    );
    assert.strictEqual(getPeriodMs(), 60 * 60 * 1000);
  });

  it('returns predefined period when no custom range', () => {
    state.timeRange = '7d';
    clearCustomTimeRange();
    assert.strictEqual(getPeriodMs(), 7 * 24 * 60 * 60 * 1000);
  });
});

describe('zoomOut', () => {
  it('zooms from 15m to 1h', () => {
    state.timeRange = '15m';
    clearCustomTimeRange();
    setQueryTimestamp(new Date('2026-01-20T12:34:56Z'));
    const result = zoomOut();
    assert.ok(result);
    assert.strictEqual(result.timeRange, '1h');
    assert.ok(result.queryTimestamp instanceof Date);
  });

  it('zooms from 1h to 12h', () => {
    state.timeRange = '1h';
    clearCustomTimeRange();
    setQueryTimestamp(new Date('2026-01-20T12:34:56Z'));
    const result = zoomOut();
    assert.ok(result);
    assert.strictEqual(result.timeRange, '12h');
  });

  it('zooms from custom range to next larger predefined period', () => {
    // 30 min custom range -> next larger is 1h
    setCustomTimeRange(
      new Date('2026-01-20T12:00:00Z'),
      new Date('2026-01-20T12:30:00Z'),
    );
    const result = zoomOut();
    assert.ok(result);
    assert.strictEqual(result.timeRange, '1h');
  });

  it('returns null when already at 7d (largest range)', () => {
    state.timeRange = '7d';
    clearCustomTimeRange();
    setQueryTimestamp(new Date('2026-01-20T12:34:56Z'));
    const result = zoomOut();
    assert.isNull(result);
  });

  it('clamps end to now when zoom would go into the future', () => {
    state.timeRange = '15m';
    clearCustomTimeRange();
    // Use current time so the zoom-out stays anchored near now
    const now = new Date();
    setQueryTimestamp(now);
    const result = zoomOut();
    assert.ok(result);
    assert.ok(result.queryTimestamp <= new Date());
  });

  it('clamps start to two weeks ago when zoom would exceed retention', () => {
    state.timeRange = '24h';
    clearCustomTimeRange();
    // Set timestamp far in the past (just over 2 weeks ago)
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    setQueryTimestamp(new Date(twoWeeksAgo.getTime() + 12 * 60 * 60 * 1000));
    const result = zoomOut();
    assert.ok(result);
    assert.strictEqual(result.timeRange, '7d');
  });
});
