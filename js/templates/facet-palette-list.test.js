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
  renderFacetPaletteItem,
  renderQueryPaletteItem,
  renderPaletteListHtml,
} from './facet-palette-list.js';

describe('renderFacetPaletteItem', () => {
  it('renders a facet item with title', () => {
    const html = renderFacetPaletteItem({
      facet: { id: 'hosts', title: 'Hosts', isHidden: false },
      matchedValue: null,
      isSelected: false,
      index: 0,
      facetColumns: {},
    });
    assert.include(html, 'palette-item');
    assert.include(html, 'data-type="facet"');
    assert.include(html, 'data-facet-id="hosts"');
    assert.include(html, 'Hosts');
  });

  it('marks selected item', () => {
    const html = renderFacetPaletteItem({
      facet: { id: 'hosts', title: 'Hosts', isHidden: false },
      matchedValue: null,
      isSelected: true,
      index: 2,
      facetColumns: {},
    });
    assert.include(html, 'selected');
    assert.include(html, 'data-index="2"');
  });

  it('renders hidden badge', () => {
    const html = renderFacetPaletteItem({
      facet: { id: 'hosts', title: 'Hosts', isHidden: true },
      matchedValue: null,
      isSelected: false,
      index: 0,
      facetColumns: {},
    });
    assert.include(html, 'palette-hidden-badge');
    assert.include(html, 'hidden');
  });

  it('renders matched value with facet badge', () => {
    const html = renderFacetPaletteItem({
      facet: { id: 'hosts', title: 'Hosts', isHidden: false },
      matchedValue: 'example.com',
      isSelected: false,
      index: 0,
      facetColumns: { hosts: '`request.host`' },
    });
    assert.include(html, 'example.com');
    assert.include(html, 'palette-facet-badge');
    assert.include(html, 'value-match');
  });

  it('escapes HTML in matched value', () => {
    const html = renderFacetPaletteItem({
      facet: { id: 'f', title: 'F', isHidden: false },
      matchedValue: '<script>xss</script>',
      isSelected: false,
      index: 0,
      facetColumns: {},
    });
    assert.notInclude(html, '<script>xss</script>');
    assert.include(html, '&lt;script&gt;');
  });
});

describe('renderQueryPaletteItem', () => {
  it('renders a query item', () => {
    const html = renderQueryPaletteItem({
      query: {
        title: 'Error Rates',
        description: 'Show 5xx errors over time',
        section: 'Dashboards',
        href: '/errors.html',
      },
      isSelected: false,
      index: 0,
    });
    assert.include(html, 'palette-query');
    assert.include(html, 'data-type="query"');
    assert.include(html, 'data-href="/errors.html"');
    assert.include(html, 'Error Rates');
    assert.include(html, 'Show 5xx errors over time');
    assert.include(html, 'Dashboards');
  });

  it('strips legacy section prefixes', () => {
    const html = renderQueryPaletteItem({
      query: {
        title: 'Old View',
        description: 'desc',
        section: 'Legacy Views - Old Stuff (Migration from Coralogix)',
        href: '/old',
      },
      isSelected: false,
      index: 0,
    });
    assert.include(html, 'Old Stuff');
    assert.notInclude(html, 'Legacy Views');
    assert.notInclude(html, 'Migration from Coralogix');
  });

  it('marks selected query item', () => {
    const html = renderQueryPaletteItem({
      query: {
        title: 'Q', description: 'd', section: 'S', href: '/q',
      },
      isSelected: true,
      index: 5,
    });
    assert.include(html, 'selected');
    assert.include(html, 'data-index="5"');
  });
});

describe('renderPaletteListHtml', () => {
  it('renders mixed facet and query items', () => {
    const results = [
      { type: 'facet', facet: { id: 'h', title: 'Hosts', isHidden: false }, matchedValue: null },
      {
        type: 'query',
        query: {
          title: 'Q', description: 'd', section: 'S', href: '/',
        },
      },
    ];
    const html = renderPaletteListHtml(results, 0, {});
    assert.include(html, 'data-type="facet"');
    assert.include(html, 'data-type="query"');
  });

  it('returns empty string for unknown type', () => {
    const results = [{ type: 'unknown' }];
    const html = renderPaletteListHtml(results, 0, {});
    assert.strictEqual(html.trim(), '');
  });

  it('returns empty string for empty results', () => {
    assert.strictEqual(renderPaletteListHtml([], 0, {}), '');
  });

  it('selects correct item by index', () => {
    const results = [
      { type: 'facet', facet: { id: 'a', title: 'A', isHidden: false }, matchedValue: null },
      { type: 'facet', facet: { id: 'b', title: 'B', isHidden: false }, matchedValue: null },
    ];
    const html = renderPaletteListHtml(results, 1, {});
    // First item (data-index="0") should NOT be selected
    assert.include(html, 'data-index="0" data-type="facet" data-facet-id="a"');
    // Second item (data-index="1") should be selected
    assert.include(html, 'selected');
    assert.include(html, 'data-index="1" data-type="facet" data-facet-id="b"');
    // Verify first item does not have selected class by checking its specific chunk
    const firstItem = html.split('data-facet-id="a"')[0].split('data-index="0"')[1];
    assert.notInclude(firstItem, 'selected');
  });
});
