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
import { renderFilterTag, renderFilterTags } from './filter-tags.js';

describe('renderFilterTag', () => {
  it('renders an include filter tag', () => {
    const html = renderFilterTag({
      label: 'example.com',
      exclude: false,
      index: 0,
      colorIndicator: '<span class="color"></span>',
    });
    assert.include(html, 'filter-tag');
    assert.notInclude(html, 'exclude');
    assert.include(html, 'data-action="remove-filter"');
    assert.include(html, 'data-index="0"');
    assert.include(html, 'example.com');
    assert.include(html, '<span class="color"></span>');
  });

  it('renders an exclude filter tag', () => {
    const html = renderFilterTag({
      label: 'bad-bot',
      exclude: true,
      index: 3,
      colorIndicator: '',
    });
    assert.include(html, 'exclude');
    assert.include(html, 'data-index="3"');
    assert.include(html, 'bad-bot');
  });

  it('escapes HTML in label', () => {
    const html = renderFilterTag({
      label: '<script>alert(1)</script>',
      exclude: false,
      index: 0,
      colorIndicator: '',
    });
    assert.notInclude(html, '<script>');
    assert.include(html, '&lt;script&gt;');
  });
});

describe('renderFilterTags', () => {
  it('renders multiple tags', () => {
    const filters = [
      { label: 'host1', exclude: false, colorIndicator: '' },
      { label: 'host2', exclude: true, colorIndicator: '' },
    ];
    const html = renderFilterTags(filters);
    assert.include(html, 'host1');
    assert.include(html, 'host2');
    assert.include(html, 'data-index="0"');
    assert.include(html, 'data-index="1"');
  });

  it('returns empty string for empty array', () => {
    assert.strictEqual(renderFilterTags([]), '');
  });
});
