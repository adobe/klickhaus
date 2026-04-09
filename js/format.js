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
export function formatNumber(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toString();
}

export function formatBytes(bytes) {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(2)} KB`;
  return `${bytes} B`;
}

/**
 * Compact bytes formatting for bucket labels (no fixed decimals).
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytesCompact(bytes) {
  if (bytes === 0) return '0';
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000000) {
    const kb = bytes / 1000;
    return Number.isInteger(kb) ? `${kb} KB` : `${kb} KB`;
  }
  const mb = bytes / 1000000;
  return Number.isInteger(mb) ? `${mb} MB` : `${mb} MB`;
}

export function formatPercent(current, previous) {
  if (!previous || previous === 0) return { text: '', className: '' };
  const change = ((current - previous) / previous) * 100;
  const sign = change >= 0 ? '+' : '';
  return {
    text: `${sign}${change.toFixed(1)}%`,
    className: change >= 0 ? 'positive' : 'negative',
  };
}

export function formatQueryTime(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

const FACET_HEADER_PERCENT_MAX_DECIMALS = 5;

/**
 * Round a non-negative number to a given count of significant digits.
 * @param {number} value
 * @param {number} sig
 * @returns {number}
 */
export function roundToSignificantDigits(value, sig) {
  if (value === 0 || !Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const v = Math.abs(value);
  const p = Math.floor(Math.log10(v));
  const n = 10 ** (sig - 1 - p);
  return sign * Math.round(v * n) / n;
}

/**
 * Format a 0–100 percentage for the top-right facet summary chip:
 * three significant digits, at most five digits after the decimal point.
 * @param {number} pct
 * @returns {string}
 */
export function formatFacetHeaderPercent(pct) {
  if (!Number.isFinite(pct)) {
    return new Intl.NumberFormat('en-US', {
      minimumSignificantDigits: 3,
      maximumSignificantDigits: 3,
      maximumFractionDigits: FACET_HEADER_PERCENT_MAX_DECIMALS,
    }).format(0);
  }
  if (pct === 0) {
    return new Intl.NumberFormat('en-US', {
      minimumSignificantDigits: 3,
      maximumSignificantDigits: 3,
      maximumFractionDigits: FACET_HEADER_PERCENT_MAX_DECIMALS,
    }).format(0);
  }
  const sig3 = roundToSignificantDigits(pct, 3);
  const capped = Math.round(sig3 * 1e5) / 1e5;

  let formatted = new Intl.NumberFormat('en-US', {
    minimumSignificantDigits: 3,
    maximumSignificantDigits: 3,
    maximumFractionDigits: FACET_HEADER_PERCENT_MAX_DECIMALS,
  }).format(capped);

  const plain = formatted.replace(/,/g, '');
  const dotIdx = plain.indexOf('.');
  if (dotIdx !== -1 && plain.slice(dotIdx + 1).length > FACET_HEADER_PERCENT_MAX_DECIMALS) {
    formatted = capped.toFixed(FACET_HEADER_PERCENT_MAX_DECIMALS).replace(/\.?0+$/, '');
  }
  return formatted;
}
