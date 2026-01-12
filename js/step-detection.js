/**
 * Step detection algorithm for CDN traffic analysis.
 *
 * Priority for CDN operations (weighted importance):
 * - Error spikes (4xx, 5xx): weight 10x - indicates problems
 * - Success drops (2xx-3xx): weight 10x - indicates lost traffic
 * - Success spikes (2xx-3xx): weight 1x - notable but not urgent
 *
 * We DON'T care about:
 * - Drops in error traffic (that's good!)
 *
 * The algorithm compares against the baseline (median) of the entire timeline
 * and weights anomalies by their duration (sustained issues are worse).
 *
 * @module step-detection
 */

/**
 * Calculate median of an array
 */
function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Find contiguous regions where values exceed a threshold
 * @param {number[]} deviations - Array of deviation values (positive = above baseline)
 * @param {number} threshold - Minimum deviation to consider anomalous
 * @param {string} direction - 'above' or 'below' baseline
 * @param {number} margin - Points to ignore at start/end
 * @returns {Array} Array of { start, end, totalDeviation, peakDeviation }
 */
function findAnomalyRegions(deviations, threshold, direction, margin) {
  const regions = [];
  let inRegion = false;
  let regionStart = 0;
  let totalDeviation = 0;
  let peakDeviation = 0;

  for (let i = margin; i < deviations.length - margin; i++) {
    const dev = deviations[i];
    const isAnomalous = direction === 'above' ? dev > threshold : dev < -threshold;
    const absDev = Math.abs(dev);

    if (isAnomalous && !inRegion) {
      // Start new region
      inRegion = true;
      regionStart = i;
      totalDeviation = absDev;
      peakDeviation = absDev;
    } else if (isAnomalous && inRegion) {
      // Continue region
      totalDeviation += absDev;
      peakDeviation = Math.max(peakDeviation, absDev);
    } else if (!isAnomalous && inRegion) {
      // End region
      regions.push({
        start: regionStart,
        end: i - 1,
        duration: i - regionStart,
        totalDeviation,
        peakDeviation,
        avgDeviation: totalDeviation / (i - regionStart)
      });
      inRegion = false;
    }
  }

  // Close any open region
  if (inRegion) {
    const end = deviations.length - margin - 1;
    regions.push({
      start: regionStart,
      end,
      duration: end - regionStart + 1,
      totalDeviation,
      peakDeviation,
      avgDeviation: totalDeviation / (end - regionStart + 1)
    });
  }

  return regions;
}

/**
 * Detect the most significant anomaly in CDN traffic.
 *
 * @param {Object} series - Object with ok, client, server arrays
 * @param {number[]} series.ok - 2xx-3xx response counts per bucket
 * @param {number[]} series.client - 4xx response counts per bucket
 * @param {number[]} series.server - 5xx response counts per bucket
 * @returns {Object|null} - { startIndex, endIndex, type, magnitude, category } or null
 */
export function detectStep(series) {
  const len = series.ok.length;
  if (len < 8) return null;

  // Ignore first 2 and last 2 data points (incomplete bucket artifacts)
  const margin = 2;

  // Calculate separate scores for errors and success
  // Errors: weighted sum (5xx is worse than 4xx)
  const errorScores = series.ok.map((_, i) =>
    series.client[i] * 2 + series.server[i] * 5
  );
  // Success: just the ok count
  const successScores = series.ok.slice();

  // Calculate baselines (median of the valid range)
  const validErrorScores = errorScores.slice(margin, len - margin);
  const validSuccessScores = successScores.slice(margin, len - margin);
  const errorBaseline = median(validErrorScores);
  const successBaseline = median(validSuccessScores);

  // Calculate deviations from baseline (as percentage)
  const errorDeviations = errorScores.map(v =>
    errorBaseline > 0 ? (v - errorBaseline) / errorBaseline : 0
  );
  const successDeviations = successScores.map(v =>
    successBaseline > 0 ? (v - successBaseline) / successBaseline : 0
  );

  // Minimum threshold for significance (20% deviation from baseline)
  const threshold = 0.20;

  // Find anomaly regions
  // Error spikes: values above baseline (bad)
  const errorSpikeRegions = findAnomalyRegions(errorDeviations, threshold, 'above', margin);
  // Success drops: values below baseline (bad)
  const successDropRegions = findAnomalyRegions(successDeviations, threshold, 'below', margin);
  // Success spikes: values above baseline (notable but not urgent)
  const successSpikeRegions = findAnomalyRegions(successDeviations, threshold, 'above', margin);

  // Importance weights for different anomaly types
  const weights = {
    errorSpike: 10,    // Error spikes are critical
    successDrop: 10,   // Traffic loss is critical
    successSpike: 1    // Traffic spikes are notable but not urgent
  };

  // Score each region: peak deviation × sqrt(duration) × category weight
  // Using sqrt(duration) so longer events matter more, but not linearly
  const candidates = [];

  for (const region of errorSpikeRegions) {
    candidates.push({
      ...region,
      score: region.peakDeviation * Math.sqrt(region.duration) * weights.errorSpike,
      category: 'error',
      type: 'spike'
    });
  }

  for (const region of successDropRegions) {
    candidates.push({
      ...region,
      score: region.peakDeviation * Math.sqrt(region.duration) * weights.successDrop,
      category: 'success',
      type: 'dip'
    });
  }

  for (const region of successSpikeRegions) {
    candidates.push({
      ...region,
      score: region.peakDeviation * Math.sqrt(region.duration) * weights.successSpike,
      category: 'success',
      type: 'spike'
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  // Pick the highest scored anomaly
  const winner = candidates.reduce((best, c) =>
    (!best || c.score > best.score) ? c : best, null);

  return {
    startIndex: winner.start,
    endIndex: winner.end,
    type: winner.type,
    magnitude: winner.peakDeviation,
    category: winner.category,
    duration: winner.duration
  };
}
