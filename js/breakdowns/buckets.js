// Dynamic bucket generation for numeric facets
// Produces exactly n buckets using 1/2/5 progression

/**
 * Generate 1/2/5 sequence boundaries (3 per decade)
 * @param {number} minVal - Starting value
 * @param {number} maxVal - Ending value
 * @returns {number[]} Array of boundary values
 */
function generate125Sequence(minVal, maxVal) {
  const boundaries = [];
  let val = minVal;
  while (val <= maxVal) {
    boundaries.push(val);
    boundaries.push(val * 2);
    boundaries.push(val * 5);
    val *= 10;
  }
  return boundaries.filter(v => v >= minVal && v <= maxVal);
}

/**
 * Select exactly n boundaries evenly distributed from a sequence
 * @param {number[]} allBoundaries - All possible boundaries
 * @param {number} n - Exact number of boundaries needed
 * @returns {number[]} Selected boundaries
 */
function selectBoundaries(allBoundaries, n) {
  if (n >= allBoundaries.length) {
    return [...allBoundaries];
  }

  if (n <= 1) {
    return [allBoundaries[allBoundaries.length - 1]];
  }

  // Select evenly spaced boundaries including first and last
  const selected = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round(i * (allBoundaries.length - 1) / (n - 1));
    selected.push(allBoundaries[idx]);
  }

  return selected;
}

/**
 * Format bytes as human-readable string using KB/MB units
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0';
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000000) {
    const kb = bytes / 1000;
    return Number.isInteger(kb) ? `${kb} KB` : `${kb} KB`;
  }
  const mb = bytes / 1000000;
  return Number.isInteger(mb) ? `${mb} MB` : `${mb} MB`;
}

/**
 * Format milliseconds as human-readable string
 * @param {number} ms
 * @returns {string}
 */
function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  // Show as seconds, drop ".0" for whole numbers
  const s = ms / 1000;
  if (Number.isInteger(s)) return `${s}s`;
  // For half-seconds like 1.5s, show cleanly
  if (s * 2 === Math.floor(s * 2)) return `${s}s`;
  // Otherwise round to 1 decimal
  return `${s.toFixed(1)}s`;
}

/**
 * Content length boundaries using 1/2/5 progression (base 10 for clean labels)
 * Range: 10B to 100MB
 */
const CONTENT_LENGTH_SEQUENCE = generate125Sequence(10, 100000000);

/**
 * Response time boundaries using finer 1/2/3/5/7 progression for more granularity
 * Range: 1ms to 60s (practical range for web requests)
 */
const TIME_ELAPSED_SEQUENCE = [
  1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 70, 100,
  150, 200, 300, 500, 700, 1000,
  1500, 2000, 3000, 5000, 7000, 10000,
  15000, 20000, 30000, 60000
];

/**
 * Generate multiIf SQL expression for content length buckets
 * Produces exactly topN buckets
 * @param {number} topN - Number of buckets
 * @returns {string} SQL multiIf expression
 */
export function contentLengthBuckets(topN) {
  const col = '`response.headers.content_length`';

  // For topN buckets:
  // - 1 bucket for "0 (empty)"
  // - topN-1 range buckets
  // For topN-1 range buckets, we need topN-2 internal boundaries
  const numBoundaries = Math.max(1, topN - 2);
  const boundaries = selectBoundaries(CONTENT_LENGTH_SEQUENCE, numBoundaries);

  const conditions = [];

  // First bucket: empty (0 bytes)
  conditions.push(`${col} = 0, '0 (empty)'`);

  // Build range buckets
  // First range: 1 B to first boundary
  if (boundaries.length > 0) {
    conditions.push(`${col} < ${boundaries[0]}, '1 B-${formatBytes(boundaries[0])}'`);

    // Middle ranges
    for (let i = 1; i < boundaries.length; i++) {
      const label = `${formatBytes(boundaries[i - 1])}-${formatBytes(boundaries[i])}`;
      conditions.push(`${col} < ${boundaries[i]}, '${label}'`);
    }
  }

  // Last bucket: >= last boundary
  const lastBoundary = boundaries[boundaries.length - 1] || 10;
  conditions.push(`'≥ ${formatBytes(lastBoundary)}'`);

  return `multiIf(${conditions.join(', ')})`;
}

/**
 * Generate multiIf SQL expression for time elapsed buckets
 * Produces exactly topN buckets
 * @param {number} topN - Number of buckets
 * @returns {string} SQL multiIf expression
 */
export function timeElapsedBuckets(topN) {
  const col = '`cdn.time_elapsed_msec`';

  // For topN buckets, we need topN-1 internal boundaries
  const numBoundaries = Math.max(1, topN - 1);
  const boundaries = selectBoundaries(TIME_ELAPSED_SEQUENCE, numBoundaries);

  const conditions = [];

  // First bucket: < first boundary
  conditions.push(`${col} < ${boundaries[0]}, '< ${formatMs(boundaries[0])}'`);

  // Middle ranges
  for (let i = 1; i < boundaries.length; i++) {
    const label = `${formatMs(boundaries[i - 1])}-${formatMs(boundaries[i])}`;
    conditions.push(`${col} < ${boundaries[i]}, '${label}'`);
  }

  // Last bucket: >= last boundary
  conditions.push(`'≥ ${formatMs(boundaries[boundaries.length - 1])}'`);

  return `multiIf(${conditions.join(', ')})`;
}
