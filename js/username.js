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

const USERNAME_RE = /^[A-Za-z0-9_]+$/;

/**
 * Normalize an email address (or other free-form identifier) into a ClickHouse
 * username matching the existing `[A-Za-z0-9_]+` validator. The transform is
 * idempotent for already-normalized inputs (apart from lower-casing).
 */
export function emailToUsername(input) {
  if (typeof input !== 'string') {
    throw new TypeError('emailToUsername expects a string');
  }
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!normalized) {
    throw new Error(`Cannot derive username from "${input}"`);
  }
  return normalized;
}

export function isValidUsername(name) {
  return typeof name === 'string' && USERNAME_RE.test(name);
}

/**
 * Treat user-typed login input forgivingly: trim whitespace, then normalize
 * email-style values (with @, +, dots, etc.) to a ClickHouse username. Plain
 * usernames pass through (lower-cased). Blank input becomes empty string.
 * Falls back to the trimmed input if normalization is impossible.
 */
export function normalizeLoginIdentifier(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) { return ''; }
  try {
    return emailToUsername(trimmed);
  } catch {
    return trimmed;
  }
}
