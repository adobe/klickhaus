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
 * Stateless challenge nonces.
 *
 * The nonce a customer has to paste into their site config is signed rather than
 * stored, so the worker needs no KV namespace or database of its own. It is bound
 * to the org and site it was issued for, which stops a nonce obtained for one site
 * being replayed against another.
 */

const ENCODER = new TextEncoder();

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(secret, payload) {
  const key = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, ENCODER.encode(payload));
  return base64url(new Uint8Array(signature));
}

/**
 * Compares two strings without leaking their contents through timing. Length is
 * not secret here (both are fixed-width base64url HMACs), the bytes are.
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Issues a challenge for an org/site pair.
 *
 * @param {object} params
 * @param {string} params.org
 * @param {string} params.site
 * @param {string} params.secret       HMAC secret (worker secret, never sent out)
 * @param {number} [params.ttlSeconds] how long the customer has to paste it in
 * @param {number} [params.now]        epoch millis, injectable for tests
 * @returns {Promise<{nonce: string, issuedAt: number, expires: number}>}
 */
export async function createChallenge({
  org, site, secret, ttlSeconds = 1800, now = Date.now(),
}) {
  const issuedAt = Math.floor(now / 1000);
  const expires = issuedAt + ttlSeconds;
  const random = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `${org}|${site}|${issuedAt}|${expires}|${random}`;
  const signature = await sign(secret, payload);
  return {
    nonce: `${issuedAt}.${expires}.${random}.${signature}`,
    issuedAt: issuedAt * 1000,
    expires: expires * 1000,
  };
}

/**
 * Verifies a challenge nonce against the org/site it must have been issued for.
 *
 * @returns {Promise<{valid: boolean, reason?: string, issuedAt?: number}>}
 */
export async function verifyChallenge({
  nonce, org, site, secret, now = Date.now(),
}) {
  if (typeof nonce !== 'string') {
    return { valid: false, reason: 'missing nonce' };
  }
  const parts = nonce.split('.');
  if (parts.length !== 4) {
    return { valid: false, reason: 'malformed nonce' };
  }
  const [issuedAt, expires, random, signature] = parts;
  if (!/^\d+$/.test(issuedAt) || !/^\d+$/.test(expires)) {
    return { valid: false, reason: 'malformed nonce' };
  }
  const payload = `${org}|${site}|${issuedAt}|${expires}|${random}`;
  const expected = await sign(secret, payload);
  if (!timingSafeEqual(signature, expected)) {
    return { valid: false, reason: 'bad signature' };
  }
  if (Number(expires) * 1000 <= now) {
    return { valid: false, reason: 'challenge expired' };
  }
  return { valid: true, issuedAt: Number(issuedAt) * 1000 };
}
