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
 * Copy facet data as TSV (Tab-Separated Values) for pasting into spreadsheets
 * @param {string} facetId - The facet card ID (e.g., 'breakdown-hosts')
 * @returns {Promise<boolean>} - True if copy succeeded, false otherwise
 */
export async function copyFacetAsTsv(facetId) {
  const card = document.getElementById(facetId);
  if (!card || !card.dataset.facetData) {
    return false;
  }

  try {
    const facetData = JSON.parse(card.dataset.facetData);
    const { title, data, mode } = facetData;

    // Build TSV with headers
    const headers = ['Value', 'Count', 'OK (2xx/3xx)', '4xx', '5xx'];
    const rows = [headers];

    // Add data rows
    for (const row of data) {
      rows.push([
        row.dim || '(empty)',
        mode === 'bytes' ? formatBytesForExport(row.cnt) : row.cnt.toString(),
        mode === 'bytes' ? formatBytesForExport(row.cnt_ok) : row.cnt_ok.toString(),
        mode === 'bytes' ? formatBytesForExport(row.cnt_4xx) : row.cnt_4xx.toString(),
        mode === 'bytes' ? formatBytesForExport(row.cnt_5xx) : row.cnt_5xx.toString(),
      ]);
    }

    // Convert to TSV format (tab-separated)
    const tsv = rows.map((row) => row.join('\t')).join('\n');

    // Copy to clipboard
    await navigator.clipboard.writeText(tsv);

    // Show success feedback
    showCopyFeedback(card, true);
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to copy facet data:', err);
    showCopyFeedback(card, false);
    return false;
  }
}

/**
 * Format bytes for export (keep as raw number for spreadsheet calculations)
 * @param {number} bytes
 * @returns {string}
 */
function formatBytesForExport(bytes) {
  return bytes.toString();
}

/**
 * Show visual feedback for copy operation
 * @param {HTMLElement} card - The facet card element
 * @param {boolean} success - Whether copy succeeded
 */
function showCopyFeedback(card, success) {
  const btn = card.querySelector('[data-action="copy-facet-tsv"]');
  if (!btn) return;

  const originalText = btn.textContent;
  btn.textContent = success ? '✓' : '✗';
  btn.style.color = success ? 'var(--status-ok)' : 'var(--error)';

  setTimeout(() => {
    btn.textContent = originalText;
    btn.style.color = '';
  }, 1500);
}
