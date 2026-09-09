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
 * Support access grant worker.
 *
 * Flow:
 *   1. POST /challenge {org, site}  -> nonce + the exact config snippet to paste
 *   2. customer, who must be an admin, adds that snippet to their site config
 *   3. POST /grant {org, site, nonce} -> worker reads the nonce back out of the
 *      publicly served site config, then mints a 72h tenant-scoped ClickHouse user
 *      and returns the credentials once
 *
 * The worker never sees or wants an Admin API token. Authorisation rests entirely
 * on the fact that only a site admin can change that site's config.
 */

import { createChallenge, verifyChallenge } from './challenge.js';
import { fetchGrant, GRANT_PROPERTY, isValidName } from './grant-config.js';
import { findActiveGrant, mintTenant } from './clickhouse.js';

const DEFAULT_ALLOWED_ORIGINS = 'https://tools.aem.live';
/**
 * The config must have been modified after the challenge was issued. CDN
 * last-modified granularity and clock skew between us and the pipeline mean this
 * needs slack; five minutes is well inside the 30 minute challenge lifetime.
 */
const FRESHNESS_GRACE_MS = 5 * 60 * 1000;

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS).split(',').map((o) => o.trim());
  const origin = request.headers.get('Origin');
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(body, { status = 200, request, env } = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Credentials must never be cached by anything in front of the worker.
      'Cache-Control': 'no-store',
      ...(request ? corsHeaders(request, env) : {}),
    },
  });
}

async function readBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

function configSnippet(nonce, ticket) {
  return {
    public: {
      [GRANT_PROPERTY]: {
        nonce,
        ticket: ticket || '<support ticket id>',
        scope: 'site',
      },
    },
  };
}

async function handleChallenge(request, env) {
  const { org, site, ticket } = await readBody(request);
  if (!isValidName(org) || !isValidName(site)) {
    return json({ error: 'org and site must be lowercase names' }, { status: 400, request, env });
  }
  const { nonce, expires } = await createChallenge({
    org,
    site,
    secret: env.CHALLENGE_SECRET,
    ttlSeconds: Number(env.CHALLENGE_TTL_SECONDS || 1800),
  });
  return json({
    org,
    site,
    nonce,
    expires: new Date(expires).toISOString(),
    instructions: `Add this block to the site config for ${org}/${site}, publish it, then confirm.`,
    snippet: configSnippet(nonce, ticket),
    configUrl: `https://tools.aem.live/tools/site-admin/index.html?org=${org}&site=${site}`,
  }, { request, env });
}

async function handleGrant(request, env) {
  const { org, site, nonce } = await readBody(request);
  if (!isValidName(org) || !isValidName(site)) {
    return json({ error: 'org and site must be lowercase names' }, { status: 400, request, env });
  }

  const challenge = await verifyChallenge({ nonce, org, site, secret: env.CHALLENGE_SECRET });
  if (!challenge.valid) {
    return json({ error: challenge.reason }, { status: 403, request, env });
  }

  const found = await fetchGrant(org, site, { nonce });
  if (!found.ok) {
    return json({ error: found.reason, hint: `Add public.${GRANT_PROPERTY} and publish the config.` }, {
      status: found.status,
      request,
      env,
    });
  }
  if (found.lastModified !== null && found.lastModified < challenge.issuedAt - FRESHNESS_GRACE_MS) {
    return json({
      error: 'site config predates the challenge, so the nonce was not added for this request',
    }, { status: 403, request, env });
  }

  const { scope, ticket } = found.grant;
  const existing = await findActiveGrant(env, { org, site, scope });
  if (existing) {
    return json({
      error: 'an active grant already exists for this scope',
      username: existing.username,
      expires: existing.expires,
      hint: 'Wait for it to expire or have it revoked before requesting another.',
    }, { status: 409, request, env });
  }

  const minted = await mintTenant(env, {
    org, site, scope, ticket, ttlHours: Number(env.GRANT_TTL_HOURS || 72),
  });
  return json({
    username: minted.username,
    password: minted.password,
    expires: new Date(minted.expiresAt).toISOString(),
    scope,
    ticket,
    host: env.CLICKHOUSE_HOST,
    dashboardUrl: env.DASHBOARD_URL,
    notice: 'Shown once. Access expires automatically; no action needed to revoke it.'
      + ` You can remove the public.${GRANT_PROPERTY} block from your config now.`,
  }, { request, env });
}

const ROUTES = {
  'POST /challenge': handleChallenge,
  'POST /grant': handleGrant,
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true }, { request, env });
    }
    const handler = ROUTES[`${request.method} ${url.pathname}`];
    if (!handler) {
      return json({ error: 'not found' }, { status: 404, request, env });
    }
    if (!env.CHALLENGE_SECRET) {
      return json({ error: 'worker is not configured' }, { status: 500, request, env });
    }
    try {
      return await handler(request, env);
    } catch (err) {
      console.error('grant request failed', err.message);
      return json({ error: 'internal error' }, { status: 500, request, env });
    }
  },
};
