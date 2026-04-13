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
import {
  RUM_BREAKDOWNS,
  getRumDateRange,
  buildDataChunksFilters,
  renderKeyMetrics,
  populateRumTimeRangeSelect,
} from './rum-traffic-utils.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('rum-traffic-utils', () => {
  describe('RUM_BREAKDOWNS', () => {
    it('defines URL, Device Type/OS, and Checkpoint facets', () => {
      assert.lengthOf(RUM_BREAKDOWNS, 3);
      assert.strictEqual(RUM_BREAKDOWNS[0].facetName, 'url');
      assert.strictEqual(RUM_BREAKDOWNS[1].facetName, 'userAgent');
      assert.strictEqual(RUM_BREAKDOWNS[2].facetName, 'checkpoint');
    });

    it('has matching col and facetName for filter integration', () => {
      for (const bd of RUM_BREAKDOWNS) {
        assert.strictEqual(bd.col, bd.facetName);
      }
    });

    it('has correct card IDs', () => {
      assert.strictEqual(RUM_BREAKDOWNS[0].id, 'breakdown-url');
      assert.strictEqual(RUM_BREAKDOWNS[1].id, 'breakdown-userAgent');
      assert.strictEqual(RUM_BREAKDOWNS[2].id, 'breakdown-checkpoint');
    });
  });

  describe('getRumDateRange', () => {
    it('returns a 7-day range for "7d"', () => {
      const { startDate, endDate } = getRumDateRange('7d');
      const diff = endDate.getTime() - startDate.getTime();
      assert.closeTo(diff, 7 * DAY_MS, 1000); // within 1s tolerance
    });

    it('returns a 30-day range for "30d"', () => {
      const { startDate, endDate } = getRumDateRange('30d');
      const diff = endDate.getTime() - startDate.getTime();
      assert.closeTo(diff, 30 * DAY_MS, 1000);
    });

    it('returns a 365-day range for "365d"', () => {
      const { startDate, endDate } = getRumDateRange('365d');
      const diff = endDate.getTime() - startDate.getTime();
      assert.closeTo(diff, 365 * DAY_MS, 1000);
    });

    it('falls back to 7d for unknown time range', () => {
      const { startDate, endDate } = getRumDateRange('unknown');
      const diff = endDate.getTime() - startDate.getTime();
      assert.closeTo(diff, 7 * DAY_MS, 1000);
    });

    it('returns endDate close to now', () => {
      const { endDate } = getRumDateRange('7d');
      const now = Date.now();
      assert.closeTo(endDate.getTime(), now, 2000);
    });
  });

  describe('buildDataChunksFilters', () => {
    it('returns empty object for no filters', () => {
      assert.deepEqual(buildDataChunksFilters([]), {});
    });

    it('converts include filters to DataChunks format', () => {
      const filters = [
        { col: 'url', value: '/page1', exclude: false },
        { col: 'url', value: '/page2', exclude: false },
      ];
      const result = buildDataChunksFilters(filters);
      assert.deepEqual(result, { url: ['/page1', '/page2'] });
    });

    it('skips exclude filters', () => {
      const filters = [
        { col: 'url', value: '/page1', exclude: false },
        { col: 'url', value: '/page2', exclude: true },
      ];
      const result = buildDataChunksFilters(filters);
      assert.deepEqual(result, { url: ['/page1'] });
    });

    it('groups by column', () => {
      const filters = [
        { col: 'url', value: '/page1', exclude: false },
        { col: 'userAgent', value: 'desktop:windows', exclude: false },
      ];
      const result = buildDataChunksFilters(filters);
      assert.deepEqual(result, {
        url: ['/page1'],
        userAgent: ['desktop:windows'],
      });
    });

    it('returns empty object when all filters are excludes', () => {
      const filters = [
        { col: 'url', value: '/page1', exclude: true },
      ];
      assert.deepEqual(buildDataChunksFilters(filters), {});
    });
  });

  describe('LCP formatting (via renderKeyMetrics)', () => {
    it('formats sub-second LCP as ms', () => {
      const el = document.createElement('div');
      renderKeyMetrics({
        pageViews: 1, visits: 1, bounces: 0, lcpP75: 500, clsP75: 0, inpP75: 0,
      }, el);
      assert.include(el.textContent, '500ms');
    });

    it('formats LCP >= 1000ms as seconds', () => {
      const el = document.createElement('div');
      renderKeyMetrics({
        pageViews: 1, visits: 1, bounces: 0, lcpP75: 2500, clsP75: 0, inpP75: 0,
      }, el);
      assert.include(el.textContent, '2.5s');
    });

    it('formats exactly 1000ms as 1.0s', () => {
      const el = document.createElement('div');
      renderKeyMetrics({
        pageViews: 1, visits: 1, bounces: 0, lcpP75: 1000, clsP75: 0, inpP75: 0,
      }, el);
      assert.include(el.textContent, '1.0s');
    });
  });

  describe('renderKeyMetrics', () => {
    let overlay;

    beforeEach(() => {
      overlay = document.createElement('div');
    });

    it('adds visible class when totals provided', () => {
      const totals = {
        pageViews: 1000, visits: 500, bounces: 100, lcpP75: 2500, clsP75: 0.1, inpP75: 200,
      };
      renderKeyMetrics(totals, overlay);
      assert.isTrue(overlay.classList.contains('visible'));
    });

    it('removes visible class when totals is null', () => {
      overlay.classList.add('visible');
      renderKeyMetrics(null, overlay);
      assert.isFalse(overlay.classList.contains('visible'));
    });

    it('does nothing when overlay is null', () => {
      // Should not throw
      renderKeyMetrics({ pageViews: 100 }, null);
    });

    it('renders all six metrics', () => {
      const totals = {
        pageViews: 1000, visits: 500, bounces: 100, lcpP75: 2500, clsP75: 0.1, inpP75: 200,
      };
      renderKeyMetrics(totals, overlay);
      const metrics = overlay.querySelectorAll('.key-metric');
      assert.strictEqual(metrics.length, 6);
    });

    it('renders page views', () => {
      const totals = {
        pageViews: 1500, visits: 500, bounces: 100, lcpP75: 2500, clsP75: 0.1, inpP75: 200,
      };
      renderKeyMetrics(totals, overlay);
      assert.include(overlay.textContent, '1.50K');
      assert.include(overlay.textContent, 'Page Views');
    });

    it('renders visits', () => {
      const totals = {
        pageViews: 1000, visits: 500, bounces: 100, lcpP75: 2500, clsP75: 0.1, inpP75: 200,
      };
      renderKeyMetrics(totals, overlay);
      assert.include(overlay.textContent, '500');
      assert.include(overlay.textContent, 'Visits');
    });

    it('renders bounce rate as percentage', () => {
      const totals = {
        pageViews: 1000, visits: 500, bounces: 100, lcpP75: 2500, clsP75: 0.1, inpP75: 200,
      };
      renderKeyMetrics(totals, overlay);
      assert.include(overlay.textContent, '20%');
      assert.include(overlay.textContent, 'Bounce Rate');
    });

    it('renders 0% bounce rate when no visits', () => {
      const totals = {
        pageViews: 0, visits: 0, bounces: 0, lcpP75: 0, clsP75: 0, inpP75: 0,
      };
      renderKeyMetrics(totals, overlay);
      assert.include(overlay.textContent, '0%');
    });

    it('renders LCP p75', () => {
      const totals = {
        pageViews: 1000, visits: 500, bounces: 100, lcpP75: 2500, clsP75: 0.1, inpP75: 200,
      };
      renderKeyMetrics(totals, overlay);
      assert.include(overlay.textContent, '2.5s');
      assert.include(overlay.textContent, 'LCP p75');
    });

    it('renders CLS p75', () => {
      const totals = {
        pageViews: 1000, visits: 500, bounces: 100, lcpP75: 2500, clsP75: 0.15, inpP75: 200,
      };
      renderKeyMetrics(totals, overlay);
      assert.include(overlay.textContent, '0.15');
      assert.include(overlay.textContent, 'CLS p75');
    });

    it('renders INP p75', () => {
      const totals = {
        pageViews: 1000, visits: 500, bounces: 100, lcpP75: 2500, clsP75: 0.1, inpP75: 250,
      };
      renderKeyMetrics(totals, overlay);
      assert.include(overlay.textContent, '250ms');
      assert.include(overlay.textContent, 'INP p75');
    });
  });

  describe('populateRumTimeRangeSelect', () => {
    it('returns currentTimeRange when select is null', () => {
      const result = populateRumTimeRangeSelect(null, '30d');
      assert.strictEqual(result, '30d');
    });

    it('populates select with RUM time range options', () => {
      const select = document.createElement('select');
      populateRumTimeRangeSelect(select, '7d');
      assert.strictEqual(select.options.length, 3);
      assert.strictEqual(select.options[0].value, '7d');
      assert.strictEqual(select.options[1].value, '30d');
      assert.strictEqual(select.options[2].value, '365d');
    });

    it('sets select value to current time range', () => {
      const select = document.createElement('select');
      populateRumTimeRangeSelect(select, '30d');
      assert.strictEqual(select.value, '30d');
    });

    it('falls back to 7d for invalid time range', () => {
      const select = document.createElement('select');
      const result = populateRumTimeRangeSelect(select, 'invalid');
      assert.strictEqual(result, '7d');
      assert.strictEqual(select.value, '7d');
    });

    it('clears existing options before populating', () => {
      const select = document.createElement('select');
      const existingOption = document.createElement('option');
      existingOption.value = 'old';
      select.appendChild(existingOption);
      populateRumTimeRangeSelect(select, '7d');
      assert.strictEqual(select.options.length, 3);
      assert.notInclude(
        Array.from(select.options).map((o) => o.value),
        'old',
      );
    });

    it('uses label text from TIME_RANGES', () => {
      const select = document.createElement('select');
      populateRumTimeRangeSelect(select, '7d');
      assert.strictEqual(select.options[0].textContent, 'Last 7 days');
      assert.strictEqual(select.options[1].textContent, 'Last Month');
      assert.strictEqual(select.options[2].textContent, 'Last Year');
    });
  });
});
