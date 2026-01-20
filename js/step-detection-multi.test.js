import { describe, it } from 'node:test';
import assert from 'node:assert';
import { detectSteps } from './step-detection.js';

function toSeries(data) {
  return {
    ok: data.map(d => d.ok),
    client: data.map(d => d.client),
    server: data.map(d => d.server)
  };
}

describe('detectSteps', () => {
  it('returns top anomalies without overlap', () => {
    const series = toSeries([
      { ok: 100, client: 10, server: 1 },
      { ok: 110, client: 9, server: 1 },
      { ok: 120, client: 9, server: 1 },
      { ok: 30, client: 10, server: 1 },  // success drop
      { ok: 130, client: 50, server: 5 },  // error spike
      { ok: 120, client: 10, server: 1 },
      { ok: 115, client: 10, server: 1 },
      { ok: 118, client: 10, server: 1 },
      { ok: 60, client: 9, server: 1 },   // another success dip
      { ok: 120, client: 10, server: 1 }
    ]);

    const results = detectSteps(series, 3);
    assert.ok(results.length > 0, 'Should detect anomalies');

    const ranks = results.map(r => r.rank);
    assert.deepStrictEqual(ranks, [1, 2, 3].slice(0, results.length));

    // Ensure no overlapping regions
    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const a = results[i];
        const b = results[j];
        assert.ok(a.endIndex < b.startIndex - 1 || b.endIndex < a.startIndex - 1);
      }
    }
  });
});
