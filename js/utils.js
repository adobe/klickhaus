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
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:']);

function hasExplicitPath(urlString) {
  const schemeIndex = urlString.indexOf('://');
  if (schemeIndex === -1) return false;
  const afterScheme = urlString.slice(schemeIndex + 3);
  const delimiterIndex = afterScheme.search(/[/?#]/);
  if (delimiterIndex === -1) return false;
  return afterScheme[delimiterIndex] === '/';
}

export function sanitizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    return null;
  }
  if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) return null;

  const base = parsed.origin;
  const path = parsed.pathname;
  const suffix = `${parsed.search}${parsed.hash}`;
  if (hasExplicitPath(trimmed)) {
    return `${base}${path}${suffix}`;
  }
  return `${base}${suffix}`;
}

/**
 * Check if a value is a synthetic bucket like (same), (empty), (other)
 * These should not get links or color indicators, and don't set bar scale
 * Empty/null values are also synthetic (they display as "(empty)")
 * Also matches values containing synthetic patterns like "0 (empty)"
 */
export function isSyntheticBucket(value) {
  // Empty/null values are synthetic - they display as "(empty)"
  if (!value) return true;
  if (typeof value !== 'string') return false;
  // Exact match: (same), (empty), (other), etc.
  if (value.startsWith('(') && value.endsWith(')')) return true;
  // Contains synthetic pattern: "0 (empty)", etc.
  if (value.includes('(empty)') || value.includes('(other)') || value.includes('(same)')) return true;
  return false;
}
