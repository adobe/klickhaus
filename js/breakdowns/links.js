// Link generation helpers for breakdown tables
import { state } from '../state.js';

export function hostLink(val) {
  if (!val) return null;
  return 'https://' + val;
}

export function forwardedHostLink(val) {
  if (!val) return null;
  // Take first host if comma-separated
  const firstHost = val.split(',')[0].trim();
  return 'https://' + firstHost;
}

export function refererLink(val) {
  if (!val) return null;
  // Referer is already a full URL
  if (val.startsWith('http://') || val.startsWith('https://')) {
    return val;
  }
  return null;
}

export function pathLink(val) {
  if (!val) return null;
  // Only link if we have an active host filter
  const hostFilter = state.filters.find(f => f.col === '`request.host`' && !f.exclude);
  if (hostFilter) {
    return 'https://' + hostFilter.value + val;
  }
  return null;
}
