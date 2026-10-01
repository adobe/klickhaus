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
import { initHoverTooltips, hideHoverTooltip } from './hover-tooltip.js';

describe('hover tooltip', () => {
  let container;

  const hover = (el) => el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  const tooltip = () => document.querySelector('.hover-tooltip');

  before(() => initHoverTooltips());

  beforeEach(() => {
    container = document.createElement('div');
    container.innerHTML = '<span id="a" data-tooltip="Frankfurt, Germany">FRA</span>'
      + '<span id="b" data-tooltip="Agra, India">QAS</span><span id="c">plain</span>';
    document.body.appendChild(container);
  });

  afterEach(() => {
    hideHoverTooltip();
    container.remove();
  });

  it('shows the tooltip text when hovering a target', () => {
    hover(container.querySelector('#a'));
    assert.isFalse(tooltip().hidden);
    assert.strictEqual(tooltip().textContent, 'Frankfurt, Germany');
  });

  it('switches directly between adjacent targets', () => {
    hover(container.querySelector('#a'));
    hover(container.querySelector('#b'));
    assert.isFalse(tooltip().hidden);
    assert.strictEqual(tooltip().textContent, 'Agra, India');
  });

  it('hides when hovering an element without a tooltip', () => {
    hover(container.querySelector('#a'));
    hover(container.querySelector('#c'));
    assert.isTrue(tooltip().hidden);
  });

  it('positions the tooltip below the target', () => {
    const target = container.querySelector('#a');
    hover(target);
    const top = parseFloat(tooltip().style.top);
    assert.isAtLeast(top, target.getBoundingClientRect().bottom);
  });
});
