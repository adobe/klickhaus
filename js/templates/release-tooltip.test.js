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
import { renderReleaseTooltipHtml } from './release-tooltip.js';

describe('renderReleaseTooltipHtml', () => {
  it('renders release info', () => {
    const release = { repo: 'adobe/helix-publish', tag: 'v1.2.3', body: '- fix bug' };
    const html = renderReleaseTooltipHtml(release, '2025-01-15 10:30', (b) => `<p>${b}</p>`);
    assert.include(html, 'adobe/helix-publish');
    assert.include(html, 'v1.2.3');
    assert.include(html, '2025-01-15 10:30 UTC');
    assert.include(html, '<p>- fix bug</p>');
  });

  it('includes structural classes', () => {
    const release = { repo: 'r', tag: 't', body: 'b' };
    const html = renderReleaseTooltipHtml(release, '12:00', (b) => b);
    assert.include(html, 'release-tooltip-header');
    assert.include(html, 'release-repo');
    assert.include(html, 'release-tag');
    assert.include(html, 'release-tooltip-time');
    assert.include(html, 'release-tooltip-body');
  });

  it('uses provided formatReleaseNotes function', () => {
    const release = { repo: 'r', tag: 't', body: 'raw notes' };
    const formatter = (body) => body.toUpperCase();
    const html = renderReleaseTooltipHtml(release, '12:00', formatter);
    assert.include(html, 'RAW NOTES');
  });
});
