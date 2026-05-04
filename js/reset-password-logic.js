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
/* Pure logic for the password reset page. Kept DOM-free so the test suite can
 * exercise it without a browser shell. */
import { isValidUsername } from './username.js';

export function parseFragment(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const params = new URLSearchParams(raw);
  return {
    user: params.get('u') || '',
    resetUser: params.get('r') || '',
    token: params.get('t') || '',
    displayName: params.get('e') || '',
  };
}

export function pickDisplayName(params) {
  if (params && params.displayName) { return params.displayName; }
  return params && params.user ? params.user : '';
}

export function evaluatePassword(password) {
  const { length } = password;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  const classes = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;

  let score = 0;
  if (length >= 12) { score += 1; }
  if (length >= 16) { score += 1; }
  if (classes >= 3) { score += 1; }
  if (classes >= 4 && length >= 12) { score += 1; }
  score = Math.min(score, 4);

  const valid = length >= 12 && classes >= 4;
  let hint = 'At least 12 characters with upper, lower, digit, and symbol.';
  if (length === 0) {
    hint = 'At least 12 characters with upper, lower, digit, and symbol.';
  } else if (!valid) {
    const missing = [];
    if (length < 12) { missing.push('12+ chars'); }
    if (!hasLower) { missing.push('lowercase'); }
    if (!hasUpper) { missing.push('uppercase'); }
    if (!hasDigit) { missing.push('digit'); }
    if (!hasSymbol) { missing.push('symbol'); }
    hint = `Need: ${missing.join(', ')}`;
  } else if (score >= 4) {
    hint = 'Strong password.';
  } else {
    hint = 'OK. A longer passphrase is even better.';
  }

  return {
    score, valid, hint,
  };
}

export function escapeSqlString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "''");
}

export function escapeIdentifier(value) {
  if (!isValidUsername(value)) {
    throw new Error(`Invalid identifier: ${value}`);
  }
  return value;
}

export function describeError(err) {
  const text = String(err?.message || err || '');
  if (err?.status === 401 || /authentication failed|required_password|access_denied/i.test(text)) {
    return 'This reset link has expired or is invalid. Ask an admin to run iforgot.mjs again.';
  }
  if (/not enough privileges/i.test(text)) {
    return 'The reset link is missing required privileges. Ask an admin to re-issue it.';
  }
  if (/networkerror|failed to fetch/i.test(text)) {
    return 'Network error. Check your connection and try again.';
  }
  return text.slice(0, 240) || 'Unknown error';
}

export function buildAlterUserSql(user, newPassword) {
  return `ALTER USER ${escapeIdentifier(user)} IDENTIFIED BY '${escapeSqlString(newPassword)}'`;
}

export function buildDropUserSql(user) {
  return `DROP USER IF EXISTS ${escapeIdentifier(user)}`;
}

export function isResetLinkValid(params) {
  return Boolean(
    params
    && isValidUsername(params.user)
    && isValidUsername(params.resetUser)
    && params.token,
  );
}
