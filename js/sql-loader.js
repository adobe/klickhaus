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

const SQL_BASE_PATH = new URL('../sql/queries', import.meta.url).pathname;
const templateCache = new Map();

/**
 * Interpolate {{param}} placeholders in a SQL template.
 * @param {string} template - SQL template with {{param}} placeholders
 * @param {Record<string, string>} params - Parameter values
 * @returns {string} Interpolated SQL
 */
export function interpolate(template, params) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in params)) {
      throw new Error(`Missing SQL template parameter: ${key}`);
    }
    return params[key];
  });
}

/**
 * Fetch a SQL template file and cache it.
 * @param {string} name - Template name (without .sql extension)
 * @returns {Promise<string>} Raw template string
 */
async function fetchTemplate(name) {
  if (templateCache.has(name)) {
    return templateCache.get(name);
  }

  const response = await fetch(`${SQL_BASE_PATH}/${name}.sql`);
  if (!response.ok) {
    throw new Error(`Failed to load SQL template: ${name} (${response.status})`);
  }
  const text = await response.text();
  templateCache.set(name, text);
  return text;
}

/**
 * Load a SQL template and interpolate parameters.
 * @param {string} name - Template name (without .sql extension)
 * @param {Record<string, string>} params - Parameter values
 * @returns {Promise<string>} Interpolated SQL
 */
export async function loadSql(name, params) {
  const template = await fetchTemplate(name);
  return interpolate(template, params);
}

const ALL_TEMPLATES = [
  'time-series',
  'logs',
  'logs-more',
  'logs-at',
  'breakdown',
  'breakdown-approx-top',
  'breakdown-facet',
  'breakdown-missing',
  'autocomplete-hosts',
  'autocomplete-forwarded',
  'autocomplete-functions',
  'releases',
  'facet-search-initial',
  'facet-search-pattern',
  'investigate-facet',
  'investigate-selection',
  'log-detail',
];

/**
 * Preload all SQL templates in parallel.
 * @returns {Promise<void>}
 */
export async function preloadAllTemplates() {
  await Promise.all(ALL_TEMPLATES.map((name) => fetchTemplate(name)));
}
