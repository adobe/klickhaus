import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { state } from './state.js';
import {
  setQueryTimestamp,
  setCustomTimeRange,
  clearCustomTimeRange,
  getTimeFilter,
  getTimeBucket,
  getPeriodMs,
} from './time.js';

beforeEach(() => {
  clearCustomTimeRange();
  state.timeRange = '1h';
  setQueryTimestamp(new Date('2026-01-20T12:34:56Z'));
});

describe('time helpers', () => {
  it('builds deterministic time filter for standard range', () => {
    const filter = getTimeFilter();
    assert.ok(filter.includes("toDateTime('2026-01-20 12:34:56')"));
    assert.ok(filter.includes('INTERVAL 1 HOUR'));
  });

  it('rounds custom time range to minute boundaries and enforces min window', () => {
    const start = new Date('2026-01-20T12:00:10Z');
    const end = new Date('2026-01-20T12:01:20Z');
    setCustomTimeRange(start, end);

    const filter = getTimeFilter();
    assert.ok(filter.includes('2026-01-20 11:59:30'));
    assert.ok(filter.includes('2026-01-20 12:02:30'));
  });

  it('uses expected bucket for short custom range', () => {
    const start = new Date('2026-01-20T12:00:00Z');
    const end = new Date('2026-01-20T12:10:00Z');
    setCustomTimeRange(start, end);
    const bucket = getTimeBucket();
    assert.strictEqual(bucket, 'toStartOfInterval(timestamp, INTERVAL 5 SECOND)');
  });

  it('returns correct period in ms for current range', () => {
    state.timeRange = '12h';
    clearCustomTimeRange();
    assert.strictEqual(getPeriodMs(), 12 * 60 * 60 * 1000);
  });
});
