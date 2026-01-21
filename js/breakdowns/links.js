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
  const fwdHostFilter = state.filters.find((f) => f.col === "if(`request.headers.x_forwarded_host` = `request.host`, '(same)', `request.headers.x_forwarded_host`)" && !f.exclude);
  if (fwdHostFilter && fwdHostFilter.value !== '(same)') {
    const firstHost = fwdHostFilter.value.split(',')[0].trim();
    return `https://${firstHost}${val}`;
  }
  return null;
}
