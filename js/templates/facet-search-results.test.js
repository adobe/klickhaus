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
import { renderFacetSearchResultsHtml } from './facet-search-results.js';

describe('renderFacetSearchResultsHtml', () => {
  it('renders search results with correct structure', () => {
    const results = [
      { dim: 'example.com', cnt: 1500 },
      { dim: 'test.com', cnt: 200 },
    ];
    const html = renderFacetSearchResultsHtml(results, 0);
    assert.include(html, 'facet-search-item');
    assert.include(html, 'example.com');
    assert.include(html, 'test.com');
    assert.include(html, 'facet-search-value');
    assert.include(html, 'facet-search-count');
  });

  it('marks selected item', () => {
    const results = [
      { dim: 'first', cnt: 10 },
      { dim: 'second', cnt: 5 },
    ];
    const html = renderFacetSearchResultsHtml(results, 1);
    // Second item should be selected
    assert.include(html, 'aria-selected="true"');
    assert.include(html, 'aria-selected="false"');
  });

  it('renders filter and exclude buttons per row', () => {
    const results = [{ dim: 'val', cnt: 1 }];
    const html = renderFacetSearchResultsHtml(results, -1);
    assert.include(html, 'data-exclude="false"');
    assert.include(html, 'data-exclude="true"');
    assert.include(html, 'Filter');
    assert.include(html, 'Exclude');
  });

  it('handles empty dim as (empty)', () => {
    const results = [{ dim: '', cnt: 100 }];
    const html = renderFacetSearchResultsHtml(results, -1);
    assert.include(html, '(empty)');
  });

  it('escapes HTML in dim values', () => {
    const results = [{ dim: '<b>bold</b>', cnt: 1 }];
    const html = renderFacetSearchResultsHtml(results, -1);
    assert.notInclude(html, '<b>bold</b>');
    assert.include(html, '&lt;b&gt;bold&lt;/b&gt;');
  });

  it('returns empty string for empty results', () => {
    assert.strictEqual(renderFacetSearchResultsHtml([], 0), '');
  });
});
