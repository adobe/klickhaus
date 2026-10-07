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
import { isFilterOverflowing, updateFilterOverflow } from './filter-overflow.js';

const TAG_STYLE = 'display:inline-flex;max-width:200px;white-space:nowrap;flex-shrink:0';
const LABEL_STYLE = 'min-width:0;overflow:hidden;text-overflow:ellipsis';

function tag(label, index) {
  return `<span class="filter-tag" data-action="remove-filter" data-index="${index}" style="${TAG_STYLE}"><span class="filter-tag-label" style="${LABEL_STYLE}">${label}</span></span>`;
}

describe('filter-overflow', () => {
  let parent;
  let container;

  beforeEach(() => {
    parent = document.createElement('div');
    parent.style.cssText = 'display:flex;width:400px;overflow:hidden';
    container = document.createElement('div');
    container.style.cssText = 'display:flex;gap:8px;min-width:0';
    parent.appendChild(container);
    document.body.appendChild(parent);
  });

  afterEach(() => {
    parent.remove();
    document.getElementById('activeFiltersPopover')?.remove();
  });

  describe('isFilterOverflowing', () => {
    it('returns false without tags', () => {
      assert.isFalse(isFilterOverflowing(container));
    });

    it('returns false when tags fit', () => {
      container.innerHTML = tag('5xx', 0);
      assert.isFalse(isFilterOverflowing(container));
    });

    it('returns true when a label is truncated', () => {
      container.innerHTML = tag('x'.repeat(200), 0);
      assert.isTrue(isFilterOverflowing(container));
    });

    it('returns true when tags extend past the visible header area', () => {
      container.innerHTML = [0, 1, 2, 3].map((i) => tag(`filter-${i}-abcdef`, i)).join('');
      assert.isTrue(isFilterOverflowing(container));
    });
  });

  describe('updateFilterOverflow', () => {
    it('shows a popover with all filters on hover when overflowing', () => {
      container.innerHTML = [0, 1, 2, 3].map((i) => tag(`filter-${i}-abcdef`, i)).join('');
      updateFilterOverflow(container);
      container.dispatchEvent(new MouseEvent('mouseenter'));
      const popover = document.getElementById('activeFiltersPopover');
      assert.isFalse(popover.hidden);
      assert.lengthOf(popover.querySelectorAll('[data-action="remove-filter"]'), 4);
    });

    it('does not show the popover when filters fit', () => {
      container.innerHTML = tag('5xx', 0);
      updateFilterOverflow(container);
      container.dispatchEvent(new MouseEvent('mouseenter'));
      const popover = document.getElementById('activeFiltersPopover');
      assert.isTrue(!popover || popover.hidden);
    });

    it('hides the open popover once filters fit again', () => {
      container.innerHTML = tag('x'.repeat(200), 0);
      updateFilterOverflow(container);
      container.dispatchEvent(new MouseEvent('mouseenter'));
      const popover = document.getElementById('activeFiltersPopover');
      assert.isFalse(popover.hidden);
      container.innerHTML = tag('5xx', 0);
      updateFilterOverflow(container);
      assert.isTrue(popover.hidden);
    });
  });
});
