import { describe, it } from 'node:test';
import assert from 'node:assert';
import { contentLengthBuckets, timeElapsedBuckets, getContentLengthLabels, getTimeElapsedLabels } from './buckets.js';

/**
 * Extract boundary values from multiIf conditions
 * @param {string} sql
 * @returns {number[]}
 */
// eslint-disable-next-line no-unused-vars
function _extractBoundaries(sql) {
  // Match patterns like "col < 1000" or "col = 0"
  const matches = sql.matchAll(/[<>=]+\s*(\d+)/g);
  return [...matches].map((m) => parseInt(m[1]));
}

/**
 * Extract bucket labels from a multiIf SQL expression
 * @param {string} sql - multiIf(...) expression
 * @returns {string[]} Array of bucket labels
 */
function extractBucketLabels(sql) {
  // Match all quoted strings (bucket labels)
  const matches = sql.match(/'[^']+'/g);
  return matches ? matches.map((m) => m.slice(1, -1)) : [];
}

describe('contentLengthBuckets', () => {
  for (const n of [3, 5, 7, 10, 12, 15, 20]) {
    it(`should produce exactly ${n} buckets for topN=${n}`, () => {
      const sql = contentLengthBuckets(n);
      const labels = extractBucketLabels(sql);

      console.log(`  topN=${n}: got ${labels.length} buckets`);
      console.log(`    labels: ${labels.join(', ')}`);

      assert.strictEqual(labels.length, n, `Expected ${n} buckets, got ${labels.length}: [${labels.join(', ')}]`);
    });
  }

  it('should always have "0 (empty)" as first bucket', () => {
    const sql = contentLengthBuckets(5);
    const labels = extractBucketLabels(sql);
    assert.strictEqual(labels[0], '0 (empty)');
  });

  it('should have ≥ prefix on last bucket', () => {
    const sql = contentLengthBuckets(5);
    const labels = extractBucketLabels(sql);
    assert.ok(
      labels[labels.length - 1].startsWith('≥'),
      `Last bucket should start with ≥, got: ${labels[labels.length - 1]}`,
    );
  });

  it('should have no duplicate labels', () => {
    for (const n of [5, 10, 15]) {
      const sql = contentLengthBuckets(n);
      const labels = extractBucketLabels(sql);
      const unique = new Set(labels);
      assert.strictEqual(unique.size, labels.length, `Duplicate labels found for n=${n}: [${labels.join(', ')}]`);
    }
  });
});

describe('getContentLengthLabels', () => {
  it('should return same labels as SQL expression', () => {
    for (const n of [5, 10, 15]) {
      const sql = contentLengthBuckets(n);
      const sqlLabels = extractBucketLabels(sql);
      const fnLabels = getContentLengthLabels(n);
      assert.deepStrictEqual(fnLabels, sqlLabels, `Label mismatch for n=${n}`);
    }
  });
});

describe('getTimeElapsedLabels', () => {
  it('should return same labels as SQL expression', () => {
    for (const n of [5, 10, 15]) {
      const sql = timeElapsedBuckets(n);
      const sqlLabels = extractBucketLabels(sql);
      const fnLabels = getTimeElapsedLabels(n);
      assert.deepStrictEqual(fnLabels, sqlLabels, `Label mismatch for n=${n}`);
    }
  });
});

describe('timeElapsedBuckets', () => {
  for (const n of [3, 5, 7, 10, 12, 15, 20]) {
    it(`should produce exactly ${n} buckets for topN=${n}`, () => {
      const sql = timeElapsedBuckets(n);
      const labels = extractBucketLabels(sql);

      console.log(`  topN=${n}: got ${labels.length} buckets`);
      console.log(`    labels: ${labels.join(', ')}`);

      assert.strictEqual(labels.length, n, `Expected ${n} buckets, got ${labels.length}: [${labels.join(', ')}]`);
    });
  }

  it('should have < prefix on first bucket', () => {
    const sql = timeElapsedBuckets(5);
    const labels = extractBucketLabels(sql);
    assert.ok(labels[0].startsWith('<'), `First bucket should start with <, got: ${labels[0]}`);
  });

  it('should have ≥ prefix on last bucket', () => {
    const sql = timeElapsedBuckets(5);
    const labels = extractBucketLabels(sql);
    assert.ok(
      labels[labels.length - 1].startsWith('≥'),
      `Last bucket should start with ≥, got: ${labels[labels.length - 1]}`,
    );
  });

  it('should have no duplicate labels', () => {
    for (const n of [5, 10, 15]) {
      const sql = timeElapsedBuckets(n);
      const labels = extractBucketLabels(sql);
      const unique = new Set(labels);
      assert.strictEqual(unique.size, labels.length, `Duplicate labels found for n=${n}: [${labels.join(', ')}]`);
    }
  });
});
