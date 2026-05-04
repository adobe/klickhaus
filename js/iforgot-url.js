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
/* Helpers for the admin-side iforgot.mjs script. Kept under js/ so the
 * existing browser test-runner can exercise them without bespoke tooling. */

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Validate the `--base-url` flag for `scripts/iforgot.mjs`. Reset links must
 * use https:// because their fragment carries the temp credentials and any
 * in-transit modification of the page would let an attacker exfiltrate them.
 * http:// is permitted only when the host is a loopback address so local
 * development still works.
 *
 * Throws on invalid input; returns the validated URL string otherwise.
 */
export function validateBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid --base-url value (not a valid URL): ${value}`);
  }
  const isHttps = parsed.protocol === 'https:';
  const isLocalhost = LOCALHOST_HOSTS.has(parsed.hostname);
  const isHttpLocal = parsed.protocol === 'http:' && isLocalhost;
  if (!isHttps && !isHttpLocal) {
    throw new Error(
      `Invalid --base-url value (must be https://, or http:// only for localhost): ${value}`,
    );
  }
  return value;
}
