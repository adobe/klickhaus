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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchGrant, isValidName, publicConfigUrl, validateGrant,
} from '../src/grant-config.js';

const NONCE = '1700000000.1700001800.abc123.sig';

function config(supportAccess) {
  return { public: { supportAccess } };
}

test('accepts a well formed grant and defaults the scope to site', () => {
  const result = validateGrant(config({ nonce: NONCE, ticket: 'SUP-1' }), { nonce: NONCE });
  assert.equal(result.ok, true);
  assert.equal(result.grant.scope, 'site');
  assert.equal(result.grant.ticket, 'SUP-1');
});

test('rejects a config with no grant block', () => {
  const result = validateGrant({ public: {} }, { nonce: NONCE });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no public\.supportAccess/);
});

test('rejects a grant carrying somebody elses nonce', () => {
  const result = validateGrant(config({ nonce: 'other', ticket: 'SUP-1' }), { nonce: NONCE });
  assert.equal(result.ok, false);
  assert.match(result.reason, /does not match/);
});

test('requires a ticket so every grant is auditable', () => {
  for (const ticket of [undefined, '', '   ', 5]) {
    const result = validateGrant(config({ nonce: NONCE, ticket }), { nonce: NONCE });
    assert.equal(result.ok, false, `ticket ${JSON.stringify(ticket)} should be rejected`);
    assert.match(result.reason, /ticket is required/);
  }
});

test('rejects an unknown scope', () => {
  const grant = { nonce: NONCE, ticket: 'SUP-1', scope: 'everything' };
  const result = validateGrant(config(grant), { nonce: NONCE });
  assert.equal(result.ok, false);
  assert.match(result.reason, /scope must be one of/);
});

test('accepts org scope', () => {
  const grant = { nonce: NONCE, ticket: 'SUP-1', scope: 'org' };
  const result = validateGrant(config(grant), { nonce: NONCE });
  assert.equal(result.ok, true);
  assert.equal(result.grant.scope, 'org');
});

test('name validation only allows hostname-safe lowercase labels', () => {
  for (const good of ['acme', 'ai-ecoverse', 'a', 'site123']) {
    assert.equal(isValidName(good), true, `${good} should be valid`);
  }
  for (const bad of ['Acme', 'foo.bar', 'foo/bar', '-lead', 'trail-', 'a b', '', undefined,
    'foo--bar.evil.com', '../etc']) {
    assert.equal(isValidName(bad), false, `${JSON.stringify(bad)} should be invalid`);
  }
});

test('config url is built from the aem.live host and refuses injection attempts', () => {
  const url = publicConfigUrl('ai-ecoverse', 'slicc-website', 'xyz');
  assert.equal(url, 'https://main--slicc-website--ai-ecoverse.aem.live/config.json?cb=xyz');
  assert.throws(() => publicConfigUrl('acme', 'www.evil.com', 'x'), /invalid org or site/);
  assert.throws(() => publicConfigUrl('acme@evil', 'www', 'x'), /invalid org or site/);
});

test('fetchGrant reports a missing site distinctly from a missing grant', async () => {
  const notFound = await fetchGrant('acme', 'www', {
    nonce: NONCE,
    cacheBuster: 'x',
    fetchImpl: async () => new Response('nope', { status: 404 }),
  });
  assert.equal(notFound.ok, false);
  assert.equal(notFound.status, 404);
  assert.match(notFound.reason, /no published site/);

  const noGrant = await fetchGrant('acme', 'www', {
    nonce: NONCE,
    cacheBuster: 'x',
    fetchImpl: async () => Response.json({ public: {} }),
  });
  assert.equal(noGrant.ok, false);
  assert.equal(noGrant.status, 403);
});

test('fetchGrant surfaces last-modified so freshness can be enforced', async () => {
  const lastModified = 'Mon, 07 Sep 2026 17:35:42 GMT';
  const result = await fetchGrant('acme', 'www', {
    nonce: NONCE,
    cacheBuster: 'x',
    fetchImpl: async () => Response.json(
      config({ nonce: NONCE, ticket: 'SUP-1' }),
      { headers: { 'last-modified': lastModified } },
    ),
  });
  assert.equal(result.ok, true);
  assert.equal(result.lastModified, Date.parse(lastModified));
});

test('fetchGrant treats non-JSON as a bad gateway rather than a crash', async () => {
  const result = await fetchGrant('acme', 'www', {
    nonce: NONCE,
    cacheBuster: 'x',
    fetchImpl: async () => new Response('<html>error</html>', { status: 200 }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
});

test('fetchGrant sends a cache-busting query so a stale CDN copy cannot satisfy it', async () => {
  let requested;
  await fetchGrant('acme', 'www', {
    nonce: NONCE,
    cacheBuster: 'unique-value',
    fetchImpl: async (url) => {
      requested = url;
      return Response.json(config({ nonce: NONCE, ticket: 'SUP-1' }));
    },
  });
  assert.match(requested, /\?cb=unique-value$/);
});
