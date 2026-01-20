// Link generation helpers for breakdown tables
import { state } from '../state.js';

export function hostLink(val) {
  if (!val) return null;
  return `https://${val}`;
}

export function forwardedHostLink(val) {
  if (!val) return null;
  // Take first host if comma-separated
  const firstHost = val.split(',')[0].trim();
  return `https://${firstHost}`;
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
  // Only link if we have a single active host or forwarded host filter
  const hostFilter = state.filters.find((f) => f.col === '`request.host`' && !f.exclude);
  if (hostFilter) {
    return `https://${hostFilter.value}${val}`;
  }
  // Check for forwarded host filter (take first host if comma-separated)
  const fwdHostFilter = state.filters.find(
    (f) =>
      f.col ===
        "if(`request.headers.x_forwarded_host` = `request.host`, '(same)', `request.headers.x_forwarded_host`)" &&
      !f.exclude,
  );
  if (fwdHostFilter && fwdHostFilter.value !== '(same)') {
    const firstHost = fwdHostFilter.value.split(',')[0].trim();
    return `https://${firstHost}${val}`;
  }
  return null;
}
