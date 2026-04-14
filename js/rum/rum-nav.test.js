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
  ALL_RUM_BREAKDOWNS, RUM_VIEWS, buildNavUrl, renderRumNav, updateCheckpointSubfacets,
} from './rum-nav.js';
import { state } from '../state.js';
import { isValidFilterColumn, resetAllowedColumnsCache } from '../filter-sql.js';

describe('rum-nav', () => {
  describe('RUM_VIEWS', () => {
    it('defines exactly 4 views', () => {
      assert.lengthOf(RUM_VIEWS, 4);
    });

    it('has traffic, lcp, cls, inp views', () => {
      const ids = RUM_VIEWS.map((v) => v.id);
      assert.deepEqual(ids, ['traffic', 'lcp', 'cls', 'inp']);
    });

    it('each view has href, label, and id', () => {
      for (const view of RUM_VIEWS) {
        assert.isString(view.id);
        assert.isString(view.href);
        assert.isString(view.label);
        assert.isTrue(view.href.endsWith('.html'));
      }
    });

    it('has correct page hrefs', () => {
      const hrefs = RUM_VIEWS.map((v) => v.href);
      assert.deepEqual(hrefs, [
        'rum-traffic.html',
        'rum-lcp.html',
        'rum-cls.html',
        'rum-inp.html',
      ]);
    });
  });

  describe('ALL_RUM_BREAKDOWNS', () => {
    it('includes all RUM facet columns', () => {
      const cols = ALL_RUM_BREAKDOWNS.map((b) => b.col);
      // Core facets
      assert.include(cols, 'url');
      assert.include(cols, 'userAgent');
      assert.include(cols, 'checkpoint');
      // Checkpoint subfacets
      assert.include(cols, 'clickSource');
      assert.include(cols, 'clickTarget');
      assert.include(cols, 'mediaSource');
      assert.include(cols, 'mediaTarget');
      // CWV-specific facets
      assert.include(cols, 'enterSource');
      assert.include(cols, 'viewblock');
      assert.include(cols, 'navigate');
      assert.include(cols, 'language');
      assert.include(cols, 'accessibility');
      assert.include(cols, 'consent');
      assert.include(cols, 'loadresource');
      assert.include(cols, 'acquisitionSource');
      assert.include(cols, 'error');
      assert.include(cols, 'four04');
      assert.include(cols, 'redirect');
    });

    it('has 18 unique facet columns', () => {
      const cols = new Set(ALL_RUM_BREAKDOWNS.map((b) => b.col));
      assert.strictEqual(cols.size, 18);
    });

    it('each entry has id, facetName, and col', () => {
      for (const bd of ALL_RUM_BREAKDOWNS) {
        assert.isString(bd.id);
        assert.isString(bd.facetName);
        assert.isString(bd.col);
      }
    });

    it('has no duplicate IDs', () => {
      const ids = ALL_RUM_BREAKDOWNS.map((b) => b.id);
      assert.strictEqual(new Set(ids).size, ids.length);
    });
  });

  describe('buildNavUrl', () => {
    it('builds URL with domain and domainkey from current params', () => {
      const currentParams = new URLSearchParams('domain=www.aem.live&domainkey=abc123');
      const url = buildNavUrl('rum-lcp.html', currentParams);
      assert.include(url, 'rum-lcp.html');
      assert.include(url, 'domain=www.aem.live');
      assert.include(url, 'domainkey=abc123');
    });

    it('preserves time range parameter', () => {
      const currentParams = new URLSearchParams('domain=test.com&domainkey=key&t=30d');
      const url = buildNavUrl('rum-cls.html', currentParams);
      assert.include(url, 't=30d');
    });

    it('preserves filters parameter', () => {
      const filters = JSON.stringify([{ col: 'url', value: '/page1', exclude: false }]);
      const currentParams = new URLSearchParams(`domain=test.com&domainkey=key&filters=${encodeURIComponent(filters)}`);
      const url = buildNavUrl('rum-inp.html', currentParams);
      assert.include(url, 'filters=');
    });

    it('preserves topN parameter', () => {
      const currentParams = new URLSearchParams('domain=test.com&domainkey=key&n=20');
      const url = buildNavUrl('rum-lcp.html', currentParams);
      assert.include(url, 'n=20');
    });

    it('preserves host parameter', () => {
      const currentParams = new URLSearchParams('domain=test.com&domainkey=key&host=www.aem.live');
      const url = buildNavUrl('rum-lcp.html', currentParams);
      assert.include(url, 'host=www.aem.live');
    });

    it('preserves pinned facets parameter', () => {
      const currentParams = new URLSearchParams('domain=test.com&domainkey=key&pf=url,checkpoint');
      const url = buildNavUrl('rum-cls.html', currentParams);
      assert.include(url, 'pf=url');
    });

    it('preserves hidden facets parameter', () => {
      const currentParams = new URLSearchParams('domain=test.com&domainkey=key&hf=userAgent');
      const url = buildNavUrl('rum-cls.html', currentParams);
      assert.include(url, 'hf=userAgent');
    });

    it('returns page href with no params when current params are empty', () => {
      const currentParams = new URLSearchParams('');
      const url = buildNavUrl('rum-traffic.html', currentParams);
      assert.strictEqual(url, 'rum-traffic.html');
    });

    it('does not include empty params', () => {
      const currentParams = new URLSearchParams('domain=test.com&domainkey=key');
      const url = buildNavUrl('rum-lcp.html', currentParams);
      const parsedParams = new URL(url, 'http://localhost').searchParams;
      assert.isNull(parsedParams.get('t'));
      assert.isNull(parsedParams.get('filters'));
      assert.isNull(parsedParams.get('n'));
    });
  });

  describe('renderRumNav', () => {
    let container;

    beforeEach(() => {
      container = document.createElement('nav');
      container.id = 'rumNav';
      document.body.appendChild(container);
    });

    afterEach(() => {
      container.remove();
    });

    it('renders navigation links for all 4 views', () => {
      renderRumNav(container, 'traffic');
      const links = container.querySelectorAll('a.rum-nav-link');
      assert.strictEqual(links.length, 4);
    });

    it('marks the current view as active', () => {
      renderRumNav(container, 'traffic');
      const activeLinks = container.querySelectorAll('a.rum-nav-link.active');
      assert.strictEqual(activeLinks.length, 1);
      assert.strictEqual(activeLinks[0].textContent, 'Traffic');
    });

    it('marks LCP as active when currentView is lcp', () => {
      renderRumNav(container, 'lcp');
      const activeLinks = container.querySelectorAll('a.rum-nav-link.active');
      assert.strictEqual(activeLinks.length, 1);
      assert.strictEqual(activeLinks[0].textContent, 'LCP');
    });

    it('marks CLS as active when currentView is cls', () => {
      renderRumNav(container, 'cls');
      const activeLinks = container.querySelectorAll('a.rum-nav-link.active');
      assert.strictEqual(activeLinks.length, 1);
      assert.strictEqual(activeLinks[0].textContent, 'CLS');
    });

    it('marks INP as active when currentView is inp', () => {
      renderRumNav(container, 'inp');
      const activeLinks = container.querySelectorAll('a.rum-nav-link.active');
      assert.strictEqual(activeLinks.length, 1);
      assert.strictEqual(activeLinks[0].textContent, 'INP');
    });

    it('non-active links do not have active class', () => {
      renderRumNav(container, 'traffic');
      const inactiveLinks = container.querySelectorAll('a.rum-nav-link:not(.active)');
      assert.strictEqual(inactiveLinks.length, 3);
    });

    it('links have correct href attributes', () => {
      renderRumNav(container, 'traffic');
      const links = container.querySelectorAll('a.rum-nav-link');
      const hrefs = Array.from(links).map((l) => {
        const href = l.getAttribute('href');
        // Extract just the page name (before ?)
        return href.split('?')[0];
      });
      assert.deepEqual(hrefs, [
        'rum-traffic.html',
        'rum-lcp.html',
        'rum-cls.html',
        'rum-inp.html',
      ]);
    });

    it('preserves URL params in navigation links', () => {
      // Pass explicit params since we can't change window.location.search in tests
      renderRumNav(container, 'traffic', new URLSearchParams('domain=test.com&domainkey=key123'));
      const links = container.querySelectorAll('a.rum-nav-link:not(.active)');
      for (const link of links) {
        assert.include(link.getAttribute('href'), 'domain=test.com');
        assert.include(link.getAttribute('href'), 'domainkey=key123');
      }
    });

    it('does nothing when container is null', () => {
      // Should not throw
      renderRumNav(null, 'traffic');
    });

    it('adds rum-nav class to container', () => {
      renderRumNav(container, 'traffic');
      assert.isTrue(container.classList.contains('rum-nav'));
    });

    it('replaces content on subsequent calls', () => {
      renderRumNav(container, 'traffic');
      renderRumNav(container, 'lcp');
      const links = container.querySelectorAll('a.rum-nav-link');
      assert.strictEqual(links.length, 4);
      const activeLinks = container.querySelectorAll('a.rum-nav-link.active');
      assert.strictEqual(activeLinks.length, 1);
      assert.strictEqual(activeLinks[0].textContent, 'LCP');
    });

    it('round-trip navigation preserves state params', () => {
      const params = new URLSearchParams(
        'domain=www.aem.live&domainkey=key&t=30d&filters=%5B%7B%22col%22%3A%22url%22%2C%22value%22%3A%22%2Fpage1%22%2C%22exclude%22%3Afalse%7D%5D',
      );
      renderRumNav(container, 'traffic', params);

      // Get LCP link
      const lcpLink = container.querySelector('a.rum-nav-link[href*="rum-lcp"]');
      const lcpUrl = new URL(lcpLink.getAttribute('href'), 'http://localhost');
      const lcpParams = lcpUrl.searchParams;

      // Verify state preservation
      assert.strictEqual(lcpParams.get('domain'), 'www.aem.live');
      assert.strictEqual(lcpParams.get('domainkey'), 'key');
      assert.strictEqual(lcpParams.get('t'), '30d');
      assert.isNotNull(lcpParams.get('filters'));

      // Now simulate rendering nav on the LCP page with same params
      renderRumNav(container, 'lcp', lcpParams);

      // Get Traffic link (round-trip back)
      const trafficLink = container.querySelector('a.rum-nav-link[href*="rum-traffic"]');
      const trafficUrl = new URL(trafficLink.getAttribute('href'), 'http://localhost');
      const trafficParams = trafficUrl.searchParams;

      // Verify full state preservation on round-trip
      assert.strictEqual(trafficParams.get('domain'), 'www.aem.live');
      assert.strictEqual(trafficParams.get('domainkey'), 'key');
      assert.strictEqual(trafficParams.get('t'), '30d');
      assert.strictEqual(trafficParams.get('filters'), params.get('filters'));
    });
  });

  describe('updateCheckpointSubfacets', () => {
    let clickSource;
    let clickTarget;
    let mediaSource;
    let mediaTarget;

    beforeEach(() => {
      clickSource = document.createElement('div');
      clickSource.id = 'breakdown-clickSource';
      clickSource.className = 'breakdown-card checkpoint-subfacet';
      clickSource.style.display = 'none';
      document.body.appendChild(clickSource);

      clickTarget = document.createElement('div');
      clickTarget.id = 'breakdown-clickTarget';
      clickTarget.className = 'breakdown-card checkpoint-subfacet';
      clickTarget.style.display = 'none';
      document.body.appendChild(clickTarget);

      mediaSource = document.createElement('div');
      mediaSource.id = 'breakdown-mediaSource';
      mediaSource.className = 'breakdown-card checkpoint-subfacet';
      mediaSource.style.display = 'none';
      document.body.appendChild(mediaSource);

      mediaTarget = document.createElement('div');
      mediaTarget.id = 'breakdown-mediaTarget';
      mediaTarget.className = 'breakdown-card checkpoint-subfacet';
      mediaTarget.style.display = 'none';
      document.body.appendChild(mediaTarget);
    });

    afterEach(() => {
      clickSource.remove();
      clickTarget.remove();
      mediaSource.remove();
      mediaTarget.remove();
    });

    it('shows click sub-facets when checkpoint=click filter is active', () => {
      updateCheckpointSubfacets([
        { col: 'checkpoint', value: 'click', exclude: false },
      ]);
      assert.strictEqual(clickSource.style.display, '');
      assert.strictEqual(clickTarget.style.display, '');
      assert.strictEqual(mediaSource.style.display, 'none');
      assert.strictEqual(mediaTarget.style.display, 'none');
    });

    it('shows viewmedia sub-facets when checkpoint=viewmedia filter is active', () => {
      updateCheckpointSubfacets([
        { col: 'checkpoint', value: 'viewmedia', exclude: false },
      ]);
      assert.strictEqual(clickSource.style.display, 'none');
      assert.strictEqual(clickTarget.style.display, 'none');
      assert.strictEqual(mediaSource.style.display, '');
      assert.strictEqual(mediaTarget.style.display, '');
    });

    it('shows both click and viewmedia when both filters active', () => {
      updateCheckpointSubfacets([
        { col: 'checkpoint', value: 'click', exclude: false },
        { col: 'checkpoint', value: 'viewmedia', exclude: false },
      ]);
      assert.strictEqual(clickSource.style.display, '');
      assert.strictEqual(clickTarget.style.display, '');
      assert.strictEqual(mediaSource.style.display, '');
      assert.strictEqual(mediaTarget.style.display, '');
    });

    it('hides all sub-facets when no checkpoint filter is active', () => {
      // First show them
      updateCheckpointSubfacets([
        { col: 'checkpoint', value: 'click', exclude: false },
      ]);
      // Then remove filter
      updateCheckpointSubfacets([]);
      assert.strictEqual(clickSource.style.display, 'none');
      assert.strictEqual(clickTarget.style.display, 'none');
      assert.strictEqual(mediaSource.style.display, 'none');
      assert.strictEqual(mediaTarget.style.display, 'none');
    });

    it('ignores exclude checkpoint filters', () => {
      updateCheckpointSubfacets([
        { col: 'checkpoint', value: 'click', exclude: true },
      ]);
      assert.strictEqual(clickSource.style.display, 'none');
      assert.strictEqual(clickTarget.style.display, 'none');
    });

    it('ignores non-checkpoint filters', () => {
      updateCheckpointSubfacets([
        { col: 'url', value: '/page1', exclude: false },
      ]);
      assert.strictEqual(clickSource.style.display, 'none');
      assert.strictEqual(clickTarget.style.display, 'none');
    });

    it('does nothing when no sub-facet cards exist', () => {
      clickSource.remove();
      clickTarget.remove();
      mediaSource.remove();
      mediaTarget.remove();
      // Should not throw
      updateCheckpointSubfacets([
        { col: 'checkpoint', value: 'click', exclude: false },
      ]);
    });
  });

  describe('filter column validation with RUM breakdowns', () => {
    const savedBreakdowns = state.breakdowns;

    beforeEach(() => {
      // Set state.breakdowns to ALL_RUM_BREAKDOWNS (as RUM entry points do)
      state.breakdowns = ALL_RUM_BREAKDOWNS;
      resetAllowedColumnsCache();
    });

    afterEach(() => {
      state.breakdowns = savedBreakdowns;
      resetAllowedColumnsCache();
    });

    it('accepts core RUM filter columns when state.breakdowns is set', () => {
      assert.isTrue(isValidFilterColumn('url'));
      assert.isTrue(isValidFilterColumn('userAgent'));
      assert.isTrue(isValidFilterColumn('checkpoint'));
    });

    it('accepts checkpoint subfacet columns', () => {
      assert.isTrue(isValidFilterColumn('clickSource'));
      assert.isTrue(isValidFilterColumn('clickTarget'));
      assert.isTrue(isValidFilterColumn('mediaSource'));
      assert.isTrue(isValidFilterColumn('mediaTarget'));
    });

    it('accepts CWV-specific facet columns', () => {
      assert.isTrue(isValidFilterColumn('enterSource'));
      assert.isTrue(isValidFilterColumn('viewblock'));
      assert.isTrue(isValidFilterColumn('navigate'));
      assert.isTrue(isValidFilterColumn('language'));
      assert.isTrue(isValidFilterColumn('accessibility'));
      assert.isTrue(isValidFilterColumn('consent'));
      assert.isTrue(isValidFilterColumn('loadresource'));
      assert.isTrue(isValidFilterColumn('acquisitionSource'));
      assert.isTrue(isValidFilterColumn('error'));
      assert.isTrue(isValidFilterColumn('four04'));
      assert.isTrue(isValidFilterColumn('redirect'));
    });

    it('rejects unknown columns', () => {
      assert.isFalse(isValidFilterColumn('nonexistent'));
      assert.isFalse(isValidFilterColumn('sql_injection'));
    });
  });
});
