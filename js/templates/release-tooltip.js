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

/**
 * Render the release tooltip HTML content.
 * @param {Object} release - Release data with repo, tag, body
 * @param {string} timeStr - Formatted published time string
 * @param {Function} formatReleaseNotes - Function to format body as HTML
 * @returns {string} HTML string
 */
export function renderReleaseTooltipHtml(release, timeStr, formatReleaseNotes) {
  return `
    <div class="release-tooltip-header">
      <span class="release-repo">${release.repo}</span>
      <span class="release-tag">${release.tag}</span>
    </div>
    <div class="release-tooltip-time">${timeStr} UTC</div>
    <div class="release-tooltip-body">${formatReleaseNotes(release.body)}</div>
  `;
}
