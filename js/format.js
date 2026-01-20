// Formatting utilities

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
