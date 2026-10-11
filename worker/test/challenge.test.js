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
import { createChallenge, verifyChallenge, timingSafeEqual } from '../src/challenge.js';

const SECRET = 'test-secret-not-used-anywhere-real';

test('a freshly issued challenge verifies for its own org and site', async () => {
  const { nonce } = await createChallenge({ org: 'acme', site: 'www', secret: SECRET });
  const result = await verifyChallenge({
    nonce, org: 'acme', site: 'www', secret: SECRET,
  });
  assert.equal(result.valid, true);
});

test('a challenge issued for one site is rejected for another', async () => {
  const { nonce } = await createChallenge({ org: 'acme', site: 'www', secret: SECRET });
  const result = await verifyChallenge({
    nonce, org: 'acme', site: 'other', secret: SECRET,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'bad signature');
});

test('a challenge issued for one org is rejected for another', async () => {
  const { nonce } = await createChallenge({ org: 'acme', site: 'www', secret: SECRET });
  const result = await verifyChallenge({
    nonce, org: 'evilcorp', site: 'www', secret: SECRET,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'bad signature');
});

test('a challenge signed with a different secret is rejected', async () => {
  const { nonce } = await createChallenge({ org: 'acme', site: 'www', secret: 'other-secret' });
  const result = await verifyChallenge({
    nonce, org: 'acme', site: 'www', secret: SECRET,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'bad signature');
});

test('an expired challenge is rejected even though the signature is valid', async () => {
  const now = Date.now();
  const { nonce } = await createChallenge({
    org: 'acme', site: 'www', secret: SECRET, ttlSeconds: 60, now,
  });
  const result = await verifyChallenge({
    nonce, org: 'acme', site: 'www', secret: SECRET, now: now + 61_000,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'challenge expired');
});

test('tampering with the embedded expiry invalidates the signature', async () => {
  const now = Date.now();
  const { nonce } = await createChallenge({
    org: 'acme', site: 'www', secret: SECRET, ttlSeconds: 60, now,
  });
  const [issuedAt, expires, random, signature] = nonce.split('.');
  const extended = [issuedAt, String(Number(expires) + 86_400), random, signature].join('.');
  const result = await verifyChallenge({
    nonce: extended, org: 'acme', site: 'www', secret: SECRET, now,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'bad signature');
});

test('malformed and missing nonces are rejected without throwing', async () => {
  for (const nonce of [undefined, null, '', 'a.b.c', 'x.y.z.w', 42, {}]) {
    // eslint-disable-next-line no-await-in-loop
    const result = await verifyChallenge({
      nonce, org: 'acme', site: 'www', secret: SECRET,
    });
    assert.equal(result.valid, false);
  }
});

test('issued nonces are unique', async () => {
  const nonces = await Promise.all(Array.from({ length: 25 }, () => createChallenge({
    org: 'acme', site: 'www', secret: SECRET,
  }).then((c) => c.nonce)));
  assert.equal(new Set(nonces).size, nonces.length);
});

test('timingSafeEqual compares by value and rejects mismatched lengths', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
  assert.equal(timingSafeEqual('abc', 42), false);
});
