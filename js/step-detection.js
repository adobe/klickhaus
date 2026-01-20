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
 * Calculate standard deviation of an array
 */
function stdDev(arr) {
  if (arr.length <= 1) return 0;
  const mean = arr.reduce((sum, v) => sum + v, 0) / arr.length;
  const squareDiffs = arr.map((v) => (v - mean) ** 2);
  const avgSquareDiff = squareDiffs.reduce((sum, v) => sum + v, 0) / arr.length;
  return Math.sqrt(avgSquareDiff);
}

/**
 * Find contiguous regions where values exceed a threshold
 * @param {number[]} deviations - Array of deviation values (positive = above baseline)
 * @param {number} threshold - Minimum deviation to consider anomalous
 * @param {string} direction - 'above' or 'below' baseline
 * @param {number} startMargin - Points to ignore at start (incomplete bucket artifacts)
 * @param {number} endMargin - Points to ignore at end (data ingestion delay)
 * @returns {Array} Array of { start, end, totalDeviation, peakDeviation }
 */
function findAnomalyRegions(deviations, threshold, direction, startMargin, endMargin) {
  const regions = [];
  let inRegion = false;
  let regionStart = 0;
  let totalDeviation = 0;
  let peakDeviation = 0;

  for (let i = startMargin; i < deviations.length - endMargin; i += 1) {
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
        avgDeviation: totalDeviation / (i - regionStart),
      });
      inRegion = false;
    }
  }

  // Close any open region
  if (inRegion) {
    const end = deviations.length - endMargin - 1;
    regions.push({
      start: regionStart,
      end,
      duration: end - regionStart + 1,
      totalDeviation,
      peakDeviation,
      avgDeviation: totalDeviation / (end - regionStart + 1),
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

  // Ignore first 2 data points (incomplete bucket artifacts)
  const startMargin = 2;
  // Ignore last 2 data points (data ingestion delay - ~2 minutes)
  const endMargin = 2;

  // Calculate separate scores for errors and success
  // Errors: weighted sum (5xx is worse than 4xx)
  const errorScores = series.ok.map((_, i) => series.client[i] * 2 + series.server[i] * 5);
  // Success: just the ok count
  const successScores = series.ok.slice();

  // Calculate baselines (median of the valid range)
  const validErrorScores = errorScores.slice(startMargin, len - endMargin);
  const validSuccessScores = successScores.slice(startMargin, len - endMargin);
  const errorBaseline = median(validErrorScores);
  const successBaseline = median(validSuccessScores);

  // Calculate deviations from baseline (as percentage)
  const errorDeviations = errorScores.map(
    (v) => (errorBaseline > 0 ? (v - errorBaseline) / errorBaseline : 0),
  );
  const successDeviations = successScores.map(
    (v) => (successBaseline > 0 ? (v - successBaseline) / successBaseline : 0),
  );

  // Calculate standard deviations for adaptive thresholds
  const validErrorDeviations = errorDeviations.slice(startMargin, len - endMargin);
  const validSuccessDeviations = successDeviations.slice(startMargin, len - endMargin);

  const errorSigma = stdDev(validErrorDeviations);
  const successSigma = stdDev(validSuccessDeviations);

  // Threshold for significance: 1 standard deviation (sigma)
  // Only flag deviations that exceed normal variance
  const errorThreshold = errorSigma;
  const successThreshold = successSigma;

  // Find anomaly regions
  // Error spikes: values above baseline (bad)
  const errorSpikeRegions = findAnomalyRegions(errorDeviations, errorThreshold, 'above', startMargin, endMargin);
  // Success drops: values below baseline (bad)
  const successDropRegions = findAnomalyRegions(successDeviations, successThreshold, 'below', startMargin, endMargin);
  // Success spikes: values above baseline (notable but not urgent)
  const successSpikeRegions = findAnomalyRegions(successDeviations, successThreshold, 'above', startMargin, endMargin);

  // Importance weights for different anomaly types
  const weights = {
    errorSpike: 10, // Error spikes are critical
    successDrop: 10, // Traffic loss is critical
    successSpike: 1, // Traffic spikes are notable but not urgent
  };

  // Score each region: peak deviation × sqrt(duration) × category weight
  // Using sqrt(duration) so longer events matter more, but not linearly
  const candidates = [];

  for (const region of errorSpikeRegions) {
    candidates.push({
      ...region,
      score: region.peakDeviation * Math.sqrt(region.duration) * weights.errorSpike,
      category: 'error',
      type: 'spike',
    });
  }

  for (const region of successDropRegions) {
    candidates.push({
      ...region,
      score: region.peakDeviation * Math.sqrt(region.duration) * weights.successDrop,
      category: 'success',
      type: 'dip',
    });
  }

  for (const region of successSpikeRegions) {
    candidates.push({
      ...region,
      score: region.peakDeviation * Math.sqrt(region.duration) * weights.successSpike,
      category: 'success',
      type: 'spike',
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  // Pick the highest scored anomaly
  const winner = candidates.reduce((best, c) => ((!best || c.score > best.score) ? c : best), null);

  return {
    startIndex: winner.start,
    endIndex: winner.end,
    type: winner.type,
    magnitude: winner.peakDeviation,
    category: winner.category,
    duration: winner.duration,
  };
}

/**
 * Detect up to maxCount significant anomalies in CDN traffic.
 * Treats green (2xx/3xx), yellow (4xx), and red (5xx) as independent categories.
 * Returns anomalies sorted by score (most significant first).
 *
 * Priority order:
 * 1. Red spikes (5xx up) - server errors, most critical
 * 2. Yellow spikes (4xx up) - client errors increasing
 * 3. Green drops (2xx/3xx down) - traffic loss
 * 4. Yellow drops (4xx down) - fewer client errors (notable)
 * 5. Red drops (5xx down) - fewer server errors (notable)
 *
 * @param {Object} series - Object with ok, client, server arrays
 * @param {number} [maxCount=5] - Maximum number of anomalies to return
 * @returns {Array} - Array of { startIndex, endIndex, type, magnitude, category, rank }
 */
export function detectSteps(series, maxCount = 5) {
  const len = series.ok.length;
  if (len < 8) return [];

  // Ignore first 2 data points (incomplete bucket artifacts)
  const startMargin = 2;
  // Ignore last 2 data points (data ingestion delay - ~2 minutes)
  const endMargin = 2;

  // Three independent series: green (ok), yellow (client/4xx), red (server/5xx)
  const greenScores = series.ok.slice();
  const yellowScores = series.client.slice();
  const redScores = series.server.slice();

  // Calculate baselines (median of the valid range)
  const greenBaseline = median(greenScores.slice(startMargin, len - endMargin));
  const yellowBaseline = median(yellowScores.slice(startMargin, len - endMargin));
  const redBaseline = median(redScores.slice(startMargin, len - endMargin));

  // Calculate deviations from baseline (as ratio)
  const greenDeviations = greenScores.map(
    (v) => (greenBaseline > 0 ? (v - greenBaseline) / greenBaseline : 0),
  );
  const yellowDeviations = yellowScores.map(
    (v) => (yellowBaseline > 0 ? (v - yellowBaseline) / yellowBaseline : 0),
  );
  const redDeviations = redScores.map(
    (v) => (redBaseline > 0 ? (v - redBaseline) / redBaseline : 0),
  );

  // Calculate standard deviations for adaptive thresholds
  const validGreenDeviations = greenDeviations.slice(startMargin, len - endMargin);
  const validYellowDeviations = yellowDeviations.slice(startMargin, len - endMargin);
  const validRedDeviations = redDeviations.slice(startMargin, len - endMargin);

  const greenSigma = stdDev(validGreenDeviations);
  const yellowSigma = stdDev(validYellowDeviations);
  const redSigma = stdDev(validRedDeviations);

  // Threshold for significance: 1 standard deviation (sigma)
  // Only flag deviations that exceed normal variance
  const greenThreshold = greenSigma;
  const yellowThreshold = yellowSigma;
  const redThreshold = redSigma;

  // Find anomaly regions for each category and direction
  const redSpikeRegions = findAnomalyRegions(redDeviations, redThreshold, 'above', startMargin, endMargin);
  const redDropRegions = findAnomalyRegions(redDeviations, redThreshold, 'below', startMargin, endMargin);
  const yellowSpikeRegions = findAnomalyRegions(yellowDeviations, yellowThreshold, 'above', startMargin, endMargin);
  const yellowDropRegions = findAnomalyRegions(yellowDeviations, yellowThreshold, 'below', startMargin, endMargin);
  const greenSpikeRegions = findAnomalyRegions(greenDeviations, greenThreshold, 'above', startMargin, endMargin);
  const greenDropRegions = findAnomalyRegions(greenDeviations, greenThreshold, 'below', startMargin, endMargin);

  // Importance weights - prioritize spikes and green drops over red/yellow drops
  const weights = {
    redSpike: 2,
    yellowSpike: 2,
    greenDrop: 2,
    yellowDrop: 1,
    redDrop: 1,
    greenSpike: 2,
  };

  // Score each region: peak deviation × sqrt(duration) × category weight
  const candidates = [];

  for (const region of redSpikeRegions) {
    candidates.push({
      ...region,
      score: region.peakDeviation * Math.sqrt(region.duration) * weights.redSpike,
      category: 'red',
      type: 'spike',
    });
  }

  for (const region of redDropRegions) {
    candidates.push({
      ...region,
      score: region.peakDeviation * Math.sqrt(region.duration) * weights.redDrop,
      category: 'red',
      type: 'dip',
    });
  }

  for (const region of yellowSpikeRegions) {
    candidates.push({
      ...region,
      score: region.peakDeviation * Math.sqrt(region.duration) * weights.yellowSpike,
      category: 'yellow',
      type: 'spike',
    });
  }

  for (const region of yellowDropRegions) {
    candidates.push({
      ...region,
      score: region.peakDeviation * Math.sqrt(region.duration) * weights.yellowDrop,
      category: 'yellow',
      type: 'dip',
    });
  }

  for (const region of greenSpikeRegions) {
    candidates.push({
      ...region,
      score: region.peakDeviation * Math.sqrt(region.duration) * weights.greenSpike,
      category: 'green',
      type: 'spike',
    });
  }

  for (const region of greenDropRegions) {
    candidates.push({
      ...region,
      score: region.peakDeviation * Math.sqrt(region.duration) * weights.greenDrop,
      category: 'green',
      type: 'dip',
    });
  }

  if (candidates.length === 0) {
    return [];
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Greedily select non-overlapping regions (higher score wins)
  // Use a buffer of 2 indices to account for visual band padding
  const minGap = 2;
  const selected = [];
  for (const candidate of candidates) {
    if (selected.length >= maxCount) break;

    // Check if this candidate overlaps or is too close to any already selected region
    const overlaps = selected.some(
      (s) => !(candidate.end < s.start - minGap || candidate.start > s.end + minGap),
    );

    if (!overlaps) {
      selected.push(candidate);
    }
  }

  // Return with rank (1-based for display)
  return selected.map((c, index) => ({
    startIndex: c.start,
    endIndex: c.end,
    type: c.type,
    magnitude: c.peakDeviation,
    category: c.category,
    duration: c.duration,
    score: c.score,
    rank: index + 1,
  }));
}
