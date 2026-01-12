// Utility functions

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Check if a value is a synthetic bucket like (same), (empty), (other)
 * These should not get links or color indicators, and don't set bar scale
 * Empty/null values are also synthetic (they display as "(empty)")
 */
export function isSyntheticBucket(value) {
  // Empty/null values are synthetic - they display as "(empty)"
  if (!value) return true;
  if (typeof value !== 'string') return false;
  return value.startsWith('(') && value.endsWith(')');
}
