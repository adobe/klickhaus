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
  showDashboardError,
  hideDashboardError,
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
    function createNavElement() {
      const nav = document.createElement('nav');
      nav.innerHTML = `
        <a class="rum-nav-link">Traffic</a>
        <a class="rum-nav-link">LCP<span class="rum-nav-metric" data-metric="lcp"></span></a>
        <a class="rum-nav-link">CLS<span class="rum-nav-metric" data-metric="cls"></span></a>
        <a class="rum-nav-link">INP<span class="rum-nav-metric" data-metric="inp"></span></a>
        <div class="nav-metrics"></div>
      `;
      return nav;
    }

    it('formats sub-second LCP as ms', () => {
      const nav = createNavElement();
      renderKeyMetrics({
        pageViews: 1, visits: 1, bounces: 0, lcpP75: 500, clsP75: 0, inpP75: 0,
      }, nav);
      const lcpSpan = nav.querySelector('[data-metric="lcp"]');
      assert.include(lcpSpan.textContent, '500ms');
    });

    it('formats LCP >= 1000ms as seconds', () => {
      const nav = createNavElement();
      renderKeyMetrics({
        pageViews: 1, visits: 1, bounces: 0, lcpP75: 2500, clsP75: 0, inpP75: 0,
      }, nav);
      const lcpSpan = nav.querySelector('[data-metric="lcp"]');
      assert.include(lcpSpan.textContent, '2.5s');
    });

    it('formats exactly 1000ms as 1.0s', () => {
      const nav = createNavElement();
      renderKeyMetrics({
        pageViews: 1, visits: 1, bounces: 0, lcpP75: 1000, clsP75: 0, inpP75: 0,
      }, nav);
      const lcpSpan = nav.querySelector('[data-metric="lcp"]');
      assert.include(lcpSpan.textContent, '1.0s');
    });
  });

  describe('renderKeyMetrics', () => {
    let navEl;

    function createNavElement() {
      const nav = document.createElement('nav');
      nav.innerHTML = `
        <a class="rum-nav-link">Traffic</a>
        <a class="rum-nav-link">LCP<span class="rum-nav-metric" data-metric="lcp"></span></a>
        <a class="rum-nav-link">CLS<span class="rum-nav-metric" data-metric="cls"></span></a>
        <a class="rum-nav-link">INP<span class="rum-nav-metric" data-metric="inp"></span></a>
        <div class="nav-metrics"></div>
      `;
      return nav;
    }

    beforeEach(() => {
      navEl = createNavElement();
    });

    it('adds visible class to metrics container when totals provided', () => {
      const totals = {
        pageViews: 1000, visits: 500, bounces: 100, lcpP75: 2500, clsP75: 0.1, inpP75: 200,
      };
      renderKeyMetrics(totals, navEl);
      const metricsDiv = navEl.querySelector('.nav-metrics');
      assert.isTrue(metricsDiv.classList.contains('visible'));
    });

    it('removes visible class when totals is null', () => {
      const metricsDiv = navEl.querySelector('.nav-metrics');
      metricsDiv.classList.add('visible');
      renderKeyMetrics(null, navEl);
      assert.isFalse(metricsDiv.classList.contains('visible'));
    });

    it('does nothing when navElement is null', () => {
      // Should not throw
      renderKeyMetrics({ pageViews: 100 }, null);
    });

    it('renders three traffic metrics in nav-metrics container', () => {
      const totals = {
        pageViews: 1000, visits: 500, bounces: 100, lcpP75: 2500, clsP75: 0.1, inpP75: 200,
      };
      renderKeyMetrics(totals, navEl);
      const metricsDiv = navEl.querySelector('.nav-metrics');
      const metrics = metricsDiv.querySelectorAll('.key-metric');
      assert.strictEqual(metrics.length, 3);
    });

    it('renders CWV values in nav tab spans', () => {
      const totals = {
        pageViews: 1000, visits: 500, bounces: 100, lcpP75: 2500, clsP75: 0.1, inpP75: 200,
      };
      renderKeyMetrics(totals, navEl);
      assert.include(navEl.querySelector('[data-metric="lcp"]').textContent, '2.5s');
      assert.include(navEl.querySelector('[data-metric="cls"]').textContent, '0.10');
      assert.include(navEl.querySelector('[data-metric="inp"]').textContent, '200ms');
    });

    it('clears CWV spans when totals is null', () => {
      const totals = {
        pageViews: 1000, visits: 500, bounces: 100, lcpP75: 2500, clsP75: 0.1, inpP75: 200,
      };
      renderKeyMetrics(totals, navEl);
      renderKeyMetrics(null, navEl);
      assert.strictEqual(navEl.querySelector('[data-metric="lcp"]').textContent, '');
      assert.strictEqual(navEl.querySelector('[data-metric="cls"]').textContent, '');
      assert.strictEqual(navEl.querySelector('[data-metric="inp"]').textContent, '');
    });

    it('renders page views', () => {
      const totals = {
        pageViews: 1500, visits: 500, bounces: 100, lcpP75: 2500, clsP75: 0.1, inpP75: 200,
      };
      renderKeyMetrics(totals, navEl);
      const metricsDiv = navEl.querySelector('.nav-metrics');
      assert.include(metricsDiv.textContent, '1.50K');
      assert.include(metricsDiv.textContent, 'Page Views');
    });

    it('renders visits', () => {
      const totals = {
        pageViews: 1000, visits: 500, bounces: 100, lcpP75: 2500, clsP75: 0.1, inpP75: 200,
      };
      renderKeyMetrics(totals, navEl);
      const metricsDiv = navEl.querySelector('.nav-metrics');
      assert.include(metricsDiv.textContent, '500');
      assert.include(metricsDiv.textContent, 'Visits');
    });

    it('renders bounce rate as percentage', () => {
      const totals = {
        pageViews: 1000, visits: 500, bounces: 100, lcpP75: 2500, clsP75: 0.1, inpP75: 200,
      };
      renderKeyMetrics(totals, navEl);
      const metricsDiv = navEl.querySelector('.nav-metrics');
      assert.include(metricsDiv.textContent, '20%');
      assert.include(metricsDiv.textContent, 'Bounce Rate');
    });

    it('renders 0% bounce rate when no visits', () => {
      const totals = {
        pageViews: 0, visits: 0, bounces: 0, lcpP75: 0, clsP75: 0, inpP75: 0,
      };
      renderKeyMetrics(totals, navEl);
      const metricsDiv = navEl.querySelector('.nav-metrics');
      assert.include(metricsDiv.textContent, '0%');
    });

    it('renders LCP p75 in nav tab', () => {
      const totals = {
        pageViews: 1000, visits: 500, bounces: 100, lcpP75: 2500, clsP75: 0.1, inpP75: 200,
      };
      renderKeyMetrics(totals, navEl);
      const lcpSpan = navEl.querySelector('[data-metric="lcp"]');
      assert.include(lcpSpan.textContent, '2.5s');
    });

    it('renders CLS p75 in nav tab', () => {
      const totals = {
        pageViews: 1000, visits: 500, bounces: 100, lcpP75: 2500, clsP75: 0.15, inpP75: 200,
      };
      renderKeyMetrics(totals, navEl);
      const clsSpan = navEl.querySelector('[data-metric="cls"]');
      assert.include(clsSpan.textContent, '0.15');
    });

    it('renders INP p75 in nav tab', () => {
      const totals = {
        pageViews: 1000, visits: 500, bounces: 100, lcpP75: 2500, clsP75: 0.1, inpP75: 250,
      };
      renderKeyMetrics(totals, navEl);
      const inpSpan = navEl.querySelector('[data-metric="inp"]');
      assert.include(inpSpan.textContent, '250ms');
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

  describe('showDashboardError', () => {
    let banner;

    beforeEach(() => {
      banner = document.createElement('div');
    });

    it('sets text content and adds visible class', () => {
      showDashboardError('Something went wrong', banner);
      assert.strictEqual(banner.textContent, 'Something went wrong');
      assert.isTrue(banner.classList.contains('visible'));
    });

    it('replaces previous error message', () => {
      showDashboardError('First error', banner);
      showDashboardError('Second error', banner);
      assert.strictEqual(banner.textContent, 'Second error');
    });

    it('does nothing when banner is null', () => {
      // Should not throw
      showDashboardError('Error', null);
    });
  });

  describe('hideDashboardError', () => {
    let banner;

    beforeEach(() => {
      banner = document.createElement('div');
      banner.textContent = 'Some error';
      banner.classList.add('visible');
    });

    it('clears text content and removes visible class', () => {
      hideDashboardError(banner);
      assert.strictEqual(banner.textContent, '');
      assert.isFalse(banner.classList.contains('visible'));
    });

    it('does nothing when banner is null', () => {
      // Should not throw
      hideDashboardError(null);
    });

    it('is safe to call when already hidden', () => {
      banner.classList.remove('visible');
      banner.textContent = '';
      hideDashboardError(banner);
      assert.strictEqual(banner.textContent, '');
      assert.isFalse(banner.classList.contains('visible'));
    });
  });
});
