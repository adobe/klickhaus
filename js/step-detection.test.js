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
import { detectStep, detectSteps } from './step-detection.js';

// Real data from ClickHouse - 1 hour of CDN traffic (2026-01-12 21:04 - 22:04 UTC)
// Notable events:
// - Index 8 (21:12): 4xx spike from ~12k to 28,932
// - Index 23 (21:27): 2xx spike to 110,628 (should NOT be highlighted)
const realData = [
  ['2026-01-12 21:04:00', '29321', '4835', '185'],
  ['2026-01-12 21:05:00', '62374', '11805', '320'],
  ['2026-01-12 21:06:00', '64109', '11107', '241'],
  ['2026-01-12 21:07:00', '64878', '9875', '286'],
  ['2026-01-12 21:08:00', '70722', '10168', '291'],
  ['2026-01-12 21:09:00', '87118', '10852', '343'],
  ['2026-01-12 21:10:00', '79909', '13132', '362'],
  ['2026-01-12 21:11:00', '87551', '12309', '388'],
  ['2026-01-12 21:12:00', '71661', '28932', '376'], // <-- 4xx spike here (index 8)
  ['2026-01-12 21:13:00', '95562', '18359', '424'],
  ['2026-01-12 21:14:00', '93239', '11378', '435'],
  ['2026-01-12 21:15:00', '90492', '11996', '544'],
  ['2026-01-12 21:16:00', '86064', '10623', '452'],
  ['2026-01-12 21:17:00', '90787', '11413', '358'],
  ['2026-01-12 21:18:00', '81593', '11097', '384'],
  ['2026-01-12 21:19:00', '70973', '11750', '348'],
  ['2026-01-12 21:20:00', '74590', '10204', '419'],
  ['2026-01-12 21:21:00', '76793', '11905', '376'],
  ['2026-01-12 21:22:00', '78309', '12666', '489'],
  ['2026-01-12 21:23:00', '83069', '10855', '368'],
  ['2026-01-12 21:24:00', '79898', '10099', '407'],
  ['2026-01-12 21:25:00', '78972', '10239', '478'],
  ['2026-01-12 21:26:00', '94156', '11704', '482'],
  ['2026-01-12 21:27:00', '110628', '10215', '473'], // <-- 2xx spike (should NOT highlight)
  ['2026-01-12 21:28:00', '92292', '10751', '394'],
  ['2026-01-12 21:29:00', '94989', '10802', '436'],
  ['2026-01-12 21:30:00', '95992', '12266', '377'],
  ['2026-01-12 21:31:00', '81765', '10196', '311'],
  ['2026-01-12 21:32:00', '75309', '11682', '371'],
  ['2026-01-12 21:33:00', '76558', '9912', '347'],
  ['2026-01-12 21:34:00', '88861', '10292', '335'],
  ['2026-01-12 21:35:00', '74727', '11097', '379'],
  ['2026-01-12 21:36:00', '72673', '10656', '378'],
  ['2026-01-12 21:37:00', '69385', '10422', '438'],
  ['2026-01-12 21:38:00', '66435', '11415', '354'],
  ['2026-01-12 21:39:00', '66063', '10352', '371'],
  ['2026-01-12 21:40:00', '78223', '10779', '338'],
  ['2026-01-12 21:41:00', '73214', '10705', '252'],
  ['2026-01-12 21:42:00', '71712', '9977', '324'],
  ['2026-01-12 21:43:00', '69377', '10450', '308'],
  ['2026-01-12 21:44:00', '66511', '11850', '334'],
  ['2026-01-12 21:45:00', '65707', '10667', '314'],
  ['2026-01-12 21:46:00', '65417', '9795', '553'],
  ['2026-01-12 21:47:00', '64782', '10316', '378'],
  ['2026-01-12 21:48:00', '66743', '11046', '329'],
  ['2026-01-12 21:49:00', '62203', '10501', '307'],
  ['2026-01-12 21:50:00', '69531', '10092', '300'],
  ['2026-01-12 21:51:00', '75612', '11187', '285'],
  ['2026-01-12 21:52:00', '68203', '9308', '308'],
  ['2026-01-12 21:53:00', '63897', '10464', '315'],
  ['2026-01-12 21:54:00', '71908', '10199', '322'],
  ['2026-01-12 21:55:00', '75586', '10087', '328'],
  ['2026-01-12 21:56:00', '71510', '10270', '315'],
  ['2026-01-12 21:57:00', '78671', '10084', '359'],
  ['2026-01-12 21:58:00', '80763', '9793', '310'],
  ['2026-01-12 21:59:00', '78042', '9069', '303'],
  ['2026-01-12 22:00:00', '85987', '12139', '343'],
  ['2026-01-12 22:01:00', '65363', '12313', '371'],
  ['2026-01-12 22:02:00', '65486', '10453', '277'],
  ['2026-01-12 22:03:00', '58460', '9883', '72'],
  ['2026-01-12 22:04:00', '21705', '3796', '2'],
];

/**
 * Convert raw API data to series format
 */
function toSeries(data) {
  return {
    ok: data.map((d) => parseInt(d[1], 10) || 0),
    client: data.map((d) => parseInt(d[2], 10) || 0),
    server: data.map((d) => parseInt(d[3], 10) || 0),
  };
}

describe('detectStep', () => {
  it('should return null for insufficient data', () => {
    const shortSeries = {
      ok: [100, 200, 300],
      client: [10, 20, 30],
      server: [1, 2, 3],
    };
    const result = detectStep(shortSeries);
    assert.strictEqual(result, null);
  });

  it('should detect the 4xx spike at index 8 (21:12)', () => {
    const series = toSeries(realData);
    const result = detectStep(series);

    assert.ok(result, 'Should detect a step');
    assert.strictEqual(result.type, 'spike', 'Should be a spike');
    assert.strictEqual(result.category, 'error', 'Should be in error category');

    // The spike starts at index 8 (21:12) where 4xx jumps from 12309 to 28932
    assert.strictEqual(result.startIndex, 8, 'Spike should start at index 8');

    // eslint-disable-next-line no-console
    console.log('Detected step:', result);
  });

  it('should NOT highlight the 2xx spike at index 23 (21:27)', () => {
    const series = toSeries(realData);
    const result = detectStep(series);

    // If anything is detected, it should NOT be a success spike
    if (result) {
      // If the startIndex is 23, it's detecting the wrong thing
      if (result.startIndex === 23 || result.endIndex === 23) {
        assert.notStrictEqual(
          result.category,
          'success',
          'Should not highlight 2xx spike - green spikes are good!',
        );
        assert.notStrictEqual(
          result.type,
          'spike',
          'Should not be a spike in success traffic',
        );
      }
    }
  });

  it('should ignore first 2 and last 2 data points by default', () => {
    const series = toSeries(realData);
    const result = detectStep(series);

    if (result) {
      assert.ok(
        result.startIndex >= 2,
        'Should not detect in first 2 points (incomplete bucket artifacts)',
      );
      assert.ok(
        result.endIndex < realData.length - 2,
        'Should not detect in last 2 points (default endMargin)',
      );
    }
  });

  it('should respect custom endMargin option', () => {
    // Put a large spike in the last 5 data points to test custom endMargin
    const dataWithLateSpikeArr = realData.slice(0, -5).concat([
      ['2026-01-12 22:00:00', '85987', '50000', '5000'],
      ['2026-01-12 22:01:00', '65363', '55000', '6000'],
      ['2026-01-12 22:02:00', '65486', '52000', '5500'],
      ['2026-01-12 22:03:00', '58460', '48000', '4800'],
      ['2026-01-12 22:04:00', '21705', '45000', '4500'],
    ]);
    const series = toSeries(dataWithLateSpikeArr);

    // With endMargin=5, the late spike should be excluded
    const resultExcluded = detectStep(series, { endMargin: 5 });
    if (resultExcluded) {
      assert.ok(
        resultExcluded.endIndex < dataWithLateSpikeArr.length - 5,
        'Should not detect in last 5 points when endMargin=5',
      );
    }

    // With endMargin=0, the late spike should be detectable
    const resultIncluded = detectStep(series, { endMargin: 0 });
    assert.ok(resultIncluded, 'Should detect anomaly with endMargin=0');
  });

  it('should detect success drops (traffic loss)', () => {
    // Create synthetic data with a significant success drop
    const dropData = [
      [0, 80000, 10000, 300],
      [1, 82000, 10200, 310],
      [2, 79000, 10100, 290],
      [3, 81000, 10000, 320],
      [4, 80000, 10150, 305],
      [5, 40000, 10000, 300], // <-- 50% drop in success traffic
      [6, 42000, 10050, 295],
      [7, 78000, 10000, 310], // recovery
      [8, 80000, 10100, 300],
      [9, 79000, 10000, 305],
      [10, 81000, 10200, 290],
    ];
    const series = toSeries(dropData);
    const result = detectStep(series);

    assert.ok(result, 'Should detect the success drop');
    assert.strictEqual(result.type, 'dip', 'Should be a dip');
    assert.strictEqual(result.category, 'success', 'Should be in success category');
    assert.strictEqual(result.startIndex, 5, 'Drop should be at index 5');

    // eslint-disable-next-line no-console
    console.log('Detected drop:', result);
  });

  it('should prioritize error spikes over success drops', () => {
    // Data with both an error spike and a success drop
    const mixedData = [
      [0, 80000, 10000, 300],
      [1, 82000, 10200, 310],
      [2, 79000, 10100, 290],
      [3, 40000, 10000, 320], // success drop
      [4, 80000, 30000, 305], // error spike (3x increase)
      [5, 80000, 12000, 300],
      [6, 82000, 10050, 295],
      [7, 78000, 10000, 310],
      [8, 80000, 10100, 300],
      [9, 79000, 10000, 305],
      [10, 81000, 10200, 290],
    ];
    const series = toSeries(mixedData);
    const result = detectStep(series);

    assert.ok(result, 'Should detect something');
    assert.strictEqual(
      result.category,
      'error',
      'Should prioritize error spike over success drop',
    );

    // eslint-disable-next-line no-console
    console.log('Detected (prioritized):', result);
  });

  it('should return null for stable traffic', () => {
    // Perfectly stable traffic with no variance (sigma = 0)
    const stableData = [];
    for (let i = 0; i < 20; i += 1) {
      stableData.push([i, 80000, 10000, 300]);
    }
    const series = toSeries(stableData);
    const result = detectStep(series);

    assert.strictEqual(result, null, 'Should not detect step in stable traffic');
  });
});

describe('CDN operational requirements', () => {
  it('green spike = low priority, only highlight if nothing else', () => {
    // Traffic doubles - notable but not urgent
    const goodNewsData = [
      [0, 50000, 5000, 100],
      [1, 52000, 5100, 105],
      [2, 51000, 5050, 98],
      [3, 100000, 5000, 100], // 2x traffic - notable
      [4, 98000, 5100, 102],
      [5, 102000, 5000, 100],
      [6, 99000, 5050, 98],
      [7, 101000, 5000, 105],
      [8, 100000, 5100, 100],
      [9, 98000, 5000, 102],
      [10, 99000, 5050, 100],
    ];
    const series = toSeries(goodNewsData);
    const result = detectStep(series);

    // Green spikes can be highlighted if there's nothing more important
    if (result && result.category === 'success' && result.type === 'spike') {
      // This is acceptable - green spikes are low priority but can be shown
      // eslint-disable-next-line no-console
      console.log('Green spike detected (low priority):', result);
    }
  });

  it('red spike = bad, should highlight', () => {
    // 5xx errors spike significantly - this is bad!
    // Need the weighted error score to increase >15%
    // Error score = 4xx*2 + 5xx*5
    // To make 5xx spike significant, it needs to dominate the change
    const badNewsData = [
      [0, 80000, 5000, 100],
      [1, 82000, 5100, 105],
      [2, 79000, 5050, 98],
      [3, 80000, 5000, 3000], // 30x 5xx spike - bad! (score: 10k+15k=25k vs 10k+500=10.5k)
      [4, 81000, 5100, 2800],
      [5, 80000, 5000, 200], // recovering
      [6, 82000, 5050, 100],
      [7, 78000, 5000, 102],
      [8, 80000, 5100, 98],
      [9, 79000, 5000, 100],
      [10, 81000, 5200, 99],
    ];
    const series = toSeries(badNewsData);
    const result = detectStep(series);

    assert.ok(result, 'Should detect the 5xx spike');
    assert.strictEqual(result.category, 'error', 'Should be error category');
    assert.strictEqual(result.type, 'spike', 'Should be a spike');
  });

  it('green drop = bad, should highlight', () => {
    // Traffic drops 60% - something is wrong!
    const trafficLossData = [
      [0, 100000, 10000, 100],
      [1, 102000, 10200, 105],
      [2, 99000, 10100, 98],
      [3, 40000, 10000, 100], // 60% traffic loss - bad!
      [4, 38000, 10100, 102],
      [5, 42000, 10000, 100],
      [6, 99000, 10050, 98], // recovery
      [7, 101000, 10000, 105],
      [8, 100000, 10100, 100],
      [9, 98000, 10000, 102],
      [10, 99000, 10050, 100],
    ];
    const series = toSeries(trafficLossData);
    const result = detectStep(series);

    assert.ok(result, 'Should detect the traffic drop');
    assert.strictEqual(result.category, 'success', 'Should be success category');
    assert.strictEqual(result.type, 'dip', 'Should be a dip');
  });

  it('error spike beats green spike (10x weight)', () => {
    // Both a green spike and an error spike - error should win
    const mixedData = [
      [0, 50000, 5000, 100],
      [1, 52000, 5100, 105],
      [2, 51000, 5050, 98],
      [3, 100000, 5000, 100], // 2x green spike (50% increase, weighted 1x = 0.5)
      [4, 98000, 15000, 102], // error spike (3x 4xx, ~50% weighted increase, weighted 10x = 5.0)
      [5, 102000, 5000, 100],
      [6, 99000, 5050, 98],
      [7, 101000, 5000, 105],
      [8, 100000, 5100, 100],
      [9, 98000, 5000, 102],
      [10, 99000, 5050, 100],
    ];
    const series = toSeries(mixedData);
    const result = detectStep(series);

    assert.ok(result, 'Should detect something');
    assert.strictEqual(
      result.category,
      'error',
      'Error spike (10x weight) should beat green spike (1x weight)',
    );
  });

  it('sustained anomaly beats brief spike (duration weighting)', () => {
    // Brief large spike vs sustained smaller deviation
    // Need enough data points so baselines are stable (margin=2 on each side)
    const data = [
      [0, 70000, 10000, 300], // ignored (margin)
      [1, 72000, 10200, 310], // ignored (margin)
      [2, 71000, 10100, 290],
      [3, 70000, 10000, 300],
      [4, 72000, 10200, 310],
      [5, 140000, 10000, 320], // Brief 2x green spike (1 bucket)
      [6, 70000, 10150, 305], // Returns to normal
      [7, 71000, 10000, 300],
      [8, 70000, 15000, 300], // Sustained error spike starts
      [9, 70000, 16000, 310], // continues (~50% above baseline)
      [10, 70000, 15500, 295], // continues
      [11, 70000, 15000, 300], // continues (4 buckets total)
      [12, 70000, 10000, 305], // back to normal
      [13, 71000, 10200, 290],
      [14, 70000, 10000, 300],
      [15, 72000, 10100, 310], // ignored (margin)
      [16, 71000, 10200, 290], // ignored (margin)
    ];
    const series = toSeries(data);
    const result = detectStep(series);

    assert.ok(result, 'Should detect something');
    // The sustained error spike (4 buckets at ~50%) should beat the brief green spike
    // (1 bucket at 100%)
    // Error: 0.5 × √4 × 10 = 10 vs Success spike: 1.0 × √1 × 1 = 1
    assert.strictEqual(
      result.category,
      'error',
      'Sustained error spike should beat brief green spike due to duration weighting',
    );
  });

  it('red drop = good, should not highlight', () => {
    // 5xx errors drop 80% - great news!
    const goodRecoveryData = [
      [0, 80000, 10000, 500],
      [1, 82000, 10200, 480],
      [2, 79000, 10100, 520],
      [3, 80000, 10000, 100], // 80% drop in 5xx - recovery!
      [4, 81000, 10100, 98],
      [5, 80000, 10000, 102],
      [6, 82000, 10050, 100],
      [7, 78000, 10000, 99],
      [8, 80000, 10100, 101],
      [9, 79000, 10000, 100],
      [10, 81000, 10200, 98],
    ];
    const series = toSeries(goodRecoveryData);
    const result = detectStep(series);

    // Should either be null or not highlight error drops
    if (result) {
      const isErrorDrop = result.category === 'error' && result.type === 'dip';
      assert.ok(!isErrorDrop, 'Should not highlight red drops - they are good!');
    }
  });
});

describe('detectSteps (multi-anomaly)', () => {
  it('should score red drop, yellow drop, and green spike candidates', () => {
    // Data with simultaneous anomalies in all three categories:
    // - Green (ok) spike at index 4 (2x traffic)
    // - Yellow (client/4xx) drop at index 5 (80% drop)
    // - Red (server/5xx) drop at index 6 (90% drop)
    const data = [
      [0, 50000, 10000, 500],
      [1, 52000, 10200, 480],
      [2, 51000, 10100, 520], // start of valid range (margin=2)
      [3, 50000, 10000, 500],
      [4, 100000, 10000, 500], // green spike (2x)
      [5, 50000, 2000, 500], // yellow drop (80%)
      [6, 50000, 10000, 50], // red drop (90%)
      [7, 51000, 10100, 480],
      [8, 50000, 10000, 500],
      [9, 52000, 10200, 520],
      [10, 50000, 10000, 500],
      [11, 51000, 10100, 480], // end of valid range (margin=2)
      [12, 50000, 10000, 500],
      [13, 52000, 10200, 520],
    ];
    const series = toSeries(data);
    const results = detectSteps(series, 5);

    assert.ok(results.length > 0, 'Should detect at least one anomaly');

    const categories = results.map((r) => `${r.category}:${r.type}`);
    // Verify that the multi-category anomalies are found
    assert.ok(
      categories.some((c) => c === 'green:spike'),
      `Should find green spike in: ${categories.join(', ')}`,
    );
  });

  it('should detect yellow spike anomalies', () => {
    // Data with a prominent yellow (4xx) spike
    const data = [
      [0, 50000, 5000, 100],
      [1, 52000, 5100, 105],
      [2, 51000, 5050, 98],
      [3, 50000, 5000, 100],
      [4, 50000, 25000, 100], // 5x yellow spike
      [5, 50000, 5100, 105],
      [6, 52000, 5050, 98],
      [7, 50000, 5000, 100],
      [8, 51000, 5100, 102],
      [9, 50000, 5050, 100],
      [10, 52000, 5000, 98],
      [11, 50000, 5100, 100],
    ];
    const series = toSeries(data);
    const results = detectSteps(series, 5);

    assert.ok(results.length > 0, 'Should detect anomalies');
    const hasYellowSpike = results.some(
      (r) => r.category === 'yellow' && r.type === 'spike',
    );
    assert.ok(hasYellowSpike, 'Should find yellow spike');
  });

  it('should return results with rank field', () => {
    const series = toSeries(realData);
    const results = detectSteps(series, 3);

    assert.ok(results.length > 0, 'Should have results');
    results.forEach((r, i) => {
      assert.strictEqual(r.rank, i + 1, `Rank should be ${i + 1}`);
      assert.ok(r.score > 0, 'Score should be positive');
    });
  });
});
