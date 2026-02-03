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
import { escapeHtml } from '../utils.js';

/**
 * Render a single filter tag HTML.
 * @param {Object} params
 * @param {string} params.label - Display label
 * @param {boolean} params.exclude - Whether filter is an exclusion
 * @param {number} params.index - Filter index
 * @param {string} params.colorIndicator - Color indicator HTML
 * @param {string} [params.title] - Tooltip title
 * @returns {string} HTML string
 */
export function renderFilterTag({
  label, exclude, index, colorIndicator, title,
}) {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `<span class="filter-tag ${exclude ? 'exclude' : ''}" data-action="remove-filter" data-index="${index}"${titleAttr}>${colorIndicator}${escapeHtml(label)}</span>`;
}

/**
 * Render all filter tags HTML.
 * @param {Array<{label: string, exclude: boolean, colorIndicator: string}>} filters
 * @returns {string} HTML string
 */
export function renderFilterTags(filters) {
  return filters.map((f, i) => renderFilterTag({
    label: f.label,
    exclude: f.exclude,
    index: i,
    colorIndicator: f.colorIndicator,
    title: f.title,
  })).join('');
}
