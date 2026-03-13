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
import {
  buildBreakdownQuery,
  buildFacetQuery,
  FACET_DIMENSIONS,
  FACET_FILTERS,
} from './breakdown.dataprime.js';

describe('Data Prime Breakdown Queries', () => {
  describe('buildBreakdownQuery', () => {
    it('builds basic breakdown query with status aggregations', () => {
      const query = buildBreakdownQuery({
        dimExpr: '`request.host`',
        topN: 10,
      });

      assert.include(query, 'source logs');
      assert.include(query, "$l.subsystemname in ['cloudflare', 'fastly']");
      assert.include(query, 'groupby $d.request.host as dim');
      assert.include(query, 'count() as cnt');
      assert.include(query, 'count($d.response.status < 400) as cnt_ok');
      assert.include(query, 'count($d.response.status >= 400 && $d.response.status < 500) as cnt_4xx');
      assert.include(query, 'count($d.response.status >= 500) as cnt_5xx');
      assert.include(query, 'sort cnt desc');
      assert.include(query, 'limit 10');
    });

    it('includes custom filter expression', () => {
      const query = buildBreakdownQuery({
        dimExpr: '`response.status`',
        filterExpr: '`response.status` >= 400',
        topN: 10,
      });

      assert.include(query, '$d.response.status >= 400');
    });

    it('includes time filter', () => {
      const query = buildBreakdownQuery({
        dimExpr: '`request.method`',
        timeFilter: '$m.timestamp >= now() - 1h',
        topN: 10,
      });

      assert.include(query, '$m.timestamp >= now() - 1h');
    });

    it('supports custom topN and orderBy', () => {
      const query = buildBreakdownQuery({
        dimExpr: '`cdn.cache_status`',
        topN: 20,
        orderBy: 'cnt_5xx',
      });

      assert.include(query, 'sort cnt_5xx desc');
      assert.include(query, 'limit 20');
    });
  });

  describe('FACET_DIMENSIONS', () => {
    it('defines all required facets', () => {
      assert.strictEqual(FACET_DIMENSIONS.status_range, "strcat(tostring(todecimal($d.response.status / 100)), 'xx')");
      assert.strictEqual(FACET_DIMENSIONS.source, '$l.subsystemname');
      assert.strictEqual(FACET_DIMENSIONS.host, '$d.request.host');
      assert.strictEqual(FACET_DIMENSIONS.content_type, '$d.response.headers.content_type');
      assert.strictEqual(FACET_DIMENSIONS.cache_status, 'toupper($d.cdn.cache_status)');
      assert.strictEqual(FACET_DIMENSIONS.status, 'tostring($d.response.status)');
      assert.strictEqual(FACET_DIMENSIONS.method, '$d.request.method');
      assert.strictEqual(FACET_DIMENSIONS.datacenter, '$d.cdn.datacenter');
      assert.strictEqual(FACET_DIMENSIONS.request_type, '$d.helix.request_type');
      assert.strictEqual(FACET_DIMENSIONS.backend_type, '$d.helix.backend_type');
      assert.strictEqual(FACET_DIMENSIONS.url, '$d.request.url');
      assert.strictEqual(FACET_DIMENSIONS.referer, '$d.request.headers.referer');
      assert.strictEqual(FACET_DIMENSIONS.user_agent, '$d.request.headers.user_agent');
      assert.strictEqual(FACET_DIMENSIONS.client_ip, '$d.request.headers.x_forwarded_for != "" ? $d.request.headers.x_forwarded_for : $d.client.ip');
      assert.strictEqual(FACET_DIMENSIONS.x_error_grouped, "replace_regex($d.response.headers.x_error, '/[a-zA-Z0-9/_.-]+', '/...')");
    });
  });

  describe('FACET_FILTERS', () => {
    it('defines filters for facets requiring non-empty values', () => {
      assert.strictEqual(FACET_FILTERS.x_error_grouped, '$d.response.headers.x_error != ""');
      assert.strictEqual(FACET_FILTERS.request_type, '$d.helix.request_type != ""');
      assert.strictEqual(FACET_FILTERS.accept, '$d.request.headers.accept != ""');
      assert.strictEqual(FACET_FILTERS.location, '$d.response.headers.location != ""');
    });
  });

  describe('buildFacetQuery', () => {
    it('builds status_range facet query', () => {
      const query = buildFacetQuery('status_range', { topN: 10 });
      assert.include(query, "strcat(tostring(todecimal($d.response.status / 100)), 'xx') as dim");
      assert.include(query, 'limit 10');
    });

    it('builds host facet query with time filter', () => {
      const query = buildFacetQuery('host', {
        topN: 20,
        timeFilter: '$m.timestamp >= now() - 24h',
      });

      assert.include(query, '$d.request.host as dim');
      assert.include(query, '$m.timestamp >= now() - 24h');
      assert.include(query, 'limit 20');
    });

    it('builds cache_status facet query', () => {
      const query = buildFacetQuery('cache_status', { topN: 10 });
      assert.include(query, 'toupper($d.cdn.cache_status) as dim');
    });

    it('builds request_type facet query with filter', () => {
      const query = buildFacetQuery('request_type', { topN: 10 });
      assert.include(query, '$d.helix.request_type as dim');
      assert.include(query, '$d.helix.request_type != ""');
    });

    it('includes additional filter when provided', () => {
      const query = buildFacetQuery('host', {
        topN: 10,
        additionalFilter: '$d.response.status >= 500',
      });
      assert.include(query, '$d.response.status >= 500');
    });

    it('throws error for unknown facet', () => {
      assert.throws(() => buildFacetQuery('unknown_facet'), /Unknown facet: unknown_facet/);
    });
  });

  describe('All Facet Queries', () => {
    const facets = [
      'status_range',
      'source',
      'host',
      'x_forwarded_host',
      'content_type',
      'status',
      'x_error_grouped',
      'cache_status',
      'url',
      'referer',
      'user_agent',
      'client_ip',
      'request_type',
      'backend_type',
      'method',
      'datacenter',
      'accept',
      'accept_encoding',
      'cache_control',
      'byo_cdn',
      'location',
    ];

    facets.forEach((facet) => {
      it(`generates valid query for ${facet} facet`, () => {
        const query = buildFacetQuery(facet, { topN: 10 });

        // All queries should have these common elements
        assert.include(query, 'source logs');
        assert.include(query, "$l.subsystemname in ['cloudflare', 'fastly']");
        assert.include(query, 'groupby');
        assert.include(query, 'as dim');
        assert.include(query, 'count() as cnt');
        assert.include(query, 'cnt_ok');
        assert.include(query, 'cnt_4xx');
        assert.include(query, 'cnt_5xx');
        assert.include(query, 'sort cnt desc');
        assert.include(query, 'limit 10');
      });
    });
  });

  describe('Example Queries', () => {
    it('generates status range breakdown for last hour', () => {
      const query = buildFacetQuery('status_range', {
        topN: 10,
        timeFilter: '$m.timestamp >= now() - 1h',
      });

      assert.strictEqual(query, `source logs
| filter $l.subsystemname in ['cloudflare', 'fastly'] && $m.timestamp >= now() - 1h
| groupby strcat(tostring(todecimal($d.response.status / 100)), 'xx') as dim aggregate
    count() as cnt,
    count($d.response.status < 400) as cnt_ok,
    count($d.response.status >= 400 && $d.response.status < 500) as cnt_4xx,
    count($d.response.status >= 500) as cnt_5xx
| sort cnt desc
| limit 10`);
    });
  });
});
