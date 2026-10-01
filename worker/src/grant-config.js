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
/**
 * Reads the consent grant out of a site's *public* config.
 *
 * This is the whole authorisation model: the `public` block of a site config is
 * writable only by someone with the config role on that site, and is served
 * unauthenticated at https://main--<site>--<org>.aem.live/config.json. So if the
 * worker can read its own challenge nonce back out of that document, an admin of
 * that site must have put it there. No token from the caller is involved, and the
 * worker needs no standing Admin API credential.
 */

/**
 * Org and site names end up inside a hostname, so they are validated strictly
 * rather than escaped. Anything outside this shape is rejected before a request
 * is built.
 */
const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export const GRANT_PROPERTY = 'supportAccess';
export const VALID_SCOPES = ['site', 'org'];

export function isValidName(name) {
  return typeof name === 'string' && NAME_PATTERN.test(name);
}

/**
 * Builds the public config URL for a site.
 *
 * Always reads the aem.live host rather than a configured production host: the
 * production host may sit behind the customer's own CDN, whose caching and
 * routing we do not control.
 */
export function publicConfigUrl(org, site, cacheBuster) {
  if (!isValidName(org) || !isValidName(site)) {
    throw new Error('invalid org or site');
  }
  const buster = encodeURIComponent(cacheBuster);
  return `https://main--${site}--${org}.aem.live/config.json?cb=${buster}`;
}

/**
 * Validates the grant block found in a public config.
 *
 * @param {object} config       parsed config.json
 * @param {object} expected
 * @param {string} expected.nonce
 * @returns {{ok: boolean, reason?: string, grant?: object}}
 */
export function validateGrant(config, { nonce }) {
  const grant = config?.public?.[GRANT_PROPERTY];
  if (!grant || typeof grant !== 'object') {
    return { ok: false, reason: `no public.${GRANT_PROPERTY} block in site config` };
  }
  if (grant.nonce !== nonce) {
    return { ok: false, reason: 'nonce in site config does not match the challenge' };
  }
  const scope = grant.scope || 'site';
  if (!VALID_SCOPES.includes(scope)) {
    return { ok: false, reason: `scope must be one of ${VALID_SCOPES.join(', ')}` };
  }
  if (typeof grant.ticket !== 'string' || grant.ticket.trim() === '') {
    return { ok: false, reason: 'ticket is required so the grant can be audited' };
  }
  return { ok: true, grant: { ...grant, scope, ticket: grant.ticket.trim() } };
}

/**
 * Fetches and validates the grant for an org/site.
 *
 * `lastModified` is returned so the caller can require the config to have been
 * touched after the challenge was issued, which turns a leaked nonce from a
 * standing capability into a single-use one.
 */
export async function fetchGrant(org, site, { nonce, fetchImpl = fetch, cacheBuster }) {
  const url = publicConfigUrl(org, site, cacheBuster ?? crypto.randomUUID());
  const response = await fetchImpl(url, {
    headers: { 'cache-control': 'no-cache' },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if (response.status === 404) {
    return { ok: false, status: 404, reason: `no published site at main--${site}--${org}.aem.live` };
  }
  if (!response.ok) {
    return { ok: false, status: 502, reason: `could not read site config (${response.status})` };
  }
  let config;
  try {
    config = await response.json();
  } catch {
    return { ok: false, status: 502, reason: 'site config is not valid JSON' };
  }
  const result = validateGrant(config, { nonce });
  if (!result.ok) {
    return { ok: false, status: 403, reason: result.reason };
  }
  const lastModified = response.headers.get('last-modified');
  return {
    ok: true,
    grant: result.grant,
    lastModified: lastModified ? Date.parse(lastModified) : null,
  };
}
