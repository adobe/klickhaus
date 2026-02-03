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
import { detectSteps } from './step-detection.js';

function toSeries(data) {
  return {
    ok: data.map((d) => d.ok),
    client: data.map((d) => d.client),
    server: data.map((d) => d.server),
  };
}

describe('detectSteps', () => {
  it('returns top anomalies without overlap', () => {
    const series = toSeries([
      { ok: 100, client: 10, server: 1 },
      { ok: 110, client: 9, server: 1 },
      { ok: 120, client: 9, server: 1 },
      { ok: 30, client: 10, server: 1 }, // success drop
      { ok: 130, client: 50, server: 5 }, // error spike
      { ok: 120, client: 10, server: 1 },
      { ok: 115, client: 10, server: 1 },
      { ok: 118, client: 10, server: 1 },
      { ok: 60, client: 9, server: 1 }, // another success dip
      { ok: 120, client: 10, server: 1 },
    ]);

    const results = detectSteps(series, 3);
    assert.ok(results.length > 0, 'Should detect anomalies');

    const ranks = results.map((r) => r.rank);
    assert.deepEqual(ranks, [1, 2, 3].slice(0, results.length));

    // Ensure no overlapping regions
    for (let i = 0; i < results.length; i += 1) {
      for (let j = i + 1; j < results.length; j += 1) {
        const a = results[i];
        const b = results[j];
        assert.ok(a.endIndex < b.startIndex - 1 || b.endIndex < a.startIndex - 1);
      }
    }
  });
});
