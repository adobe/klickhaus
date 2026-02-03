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
import {
  formatNumber, formatBytes, formatBytesCompact, formatPercent, formatQueryTime,
} from './format.js';

describe('formatNumber', () => {
  it('formats billions', () => {
    assert.strictEqual(formatNumber(1e9), '1.00B');
    assert.strictEqual(formatNumber(2.5e9), '2.50B');
  });

  it('formats millions', () => {
    assert.strictEqual(formatNumber(1e6), '1.00M');
    assert.strictEqual(formatNumber(42.3e6), '42.30M');
  });

  it('formats thousands', () => {
    assert.strictEqual(formatNumber(1000), '1.00K');
    assert.strictEqual(formatNumber(9999), '10.00K');
  });

  it('returns raw number below 1000', () => {
    assert.strictEqual(formatNumber(0), '0');
    assert.strictEqual(formatNumber(999), '999');
    assert.strictEqual(formatNumber(1), '1');
  });
});

describe('formatBytes', () => {
  it('formats terabytes', () => {
    assert.strictEqual(formatBytes(1e12), '1.00 TB');
    assert.strictEqual(formatBytes(5.5e12), '5.50 TB');
  });

  it('formats gigabytes', () => {
    assert.strictEqual(formatBytes(1e9), '1.00 GB');
  });

  it('formats megabytes', () => {
    assert.strictEqual(formatBytes(1e6), '1.00 MB');
  });

  it('formats kilobytes', () => {
    assert.strictEqual(formatBytes(1e3), '1.00 KB');
  });

  it('formats bytes', () => {
    assert.strictEqual(formatBytes(512), '512 B');
    assert.strictEqual(formatBytes(0), '0 B');
  });
});

describe('formatBytesCompact', () => {
  it('returns 0 for zero bytes', () => {
    assert.strictEqual(formatBytesCompact(0), '0');
  });

  it('formats small byte values', () => {
    assert.strictEqual(formatBytesCompact(500), '500 B');
    assert.strictEqual(formatBytesCompact(1), '1 B');
  });

  it('formats kilobytes', () => {
    assert.strictEqual(formatBytesCompact(10000), '10 KB');
    assert.strictEqual(formatBytesCompact(1500), '1.5 KB');
  });

  it('formats megabytes', () => {
    assert.strictEqual(formatBytesCompact(1000000), '1 MB');
    assert.strictEqual(formatBytesCompact(2500000), '2.5 MB');
  });
});

describe('formatPercent', () => {
  it('returns empty for zero previous', () => {
    const result = formatPercent(100, 0);
    assert.strictEqual(result.text, '');
    assert.strictEqual(result.className, '');
  });

  it('returns empty for null previous', () => {
    const result = formatPercent(100, null);
    assert.strictEqual(result.text, '');
  });

  it('formats positive change', () => {
    const result = formatPercent(150, 100);
    assert.strictEqual(result.text, '+50.0%');
    assert.strictEqual(result.className, 'positive');
  });

  it('formats negative change', () => {
    const result = formatPercent(50, 100);
    assert.strictEqual(result.text, '-50.0%');
    assert.strictEqual(result.className, 'negative');
  });

  it('formats zero change as positive', () => {
    const result = formatPercent(100, 100);
    assert.strictEqual(result.text, '+0.0%');
    assert.strictEqual(result.className, 'positive');
  });
});

describe('formatQueryTime', () => {
  it('formats milliseconds', () => {
    assert.strictEqual(formatQueryTime(42), '42ms');
    assert.strictEqual(formatQueryTime(999), '999ms');
  });

  it('rounds sub-millisecond values', () => {
    assert.strictEqual(formatQueryTime(0.7), '1ms');
    assert.strictEqual(formatQueryTime(0), '0ms');
  });

  it('formats seconds', () => {
    assert.strictEqual(formatQueryTime(1000), '1.00s');
    assert.strictEqual(formatQueryTime(2500), '2.50s');
    assert.strictEqual(formatQueryTime(15340), '15.34s');
  });
});
