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
 * End-to-end smoke test against the real cluster and the real published config.
 *
 * The worker only uses web-standard APIs, so its fetch handler runs unmodified
 * under Node; no wrangler or miniflare needed.
 *
 * Usage:
 *   CLICKHOUSE_PASSWORD=... node test/smoke.mjs <org> <site>
 *
 * The happy path stubs *only* the site-config fetch, because writing a real grant
 * into somebody's site config needs an Admin API session. Every other hop,
 * including all ClickHouse work, is real.
 */

import worker from '../src/index.js';

const [org = 'ai-ecoverse', site = 'slicc-website'] = process.argv.slice(2);

const env = {
  CHALLENGE_SECRET: 'smoke-test-secret',
  CLICKHOUSE_URL: 'https://s2p5b8wmt5.eastus2.azure.clickhouse.cloud:8443/',
  CLICKHOUSE_HOST: 's2p5b8wmt5.eastus2.azure.clickhouse.cloud',
  CLICKHOUSE_USER: 'tenant_minter',
  CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD,
  CLICKHOUSE_DATABASE: 'tenant_poc',
  TENANT_ROLE: 'tenant_selfserve',
  DASHBOARD_URL: 'https://klickhaus.aemstatus.net/delivery.html',
  ALLOWED_ORIGINS: 'https://tools.aem.live',
};

function post(path, body) {
  return new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://tools.aem.live' },
    body: JSON.stringify(body),
  });
}

async function call(request) {
  const response = await worker.fetch(request, env);
  return { status: response.status, body: await response.json(), headers: response.headers };
}

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

const realFetch = globalThis.fetch;
function stubConfig(payload, { lastModified = new Date().toUTCString() } = {}) {
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('/config.json')) {
      return Response.json(payload, { headers: { 'last-modified': lastModified } });
    }
    return realFetch(url, options);
  };
}

async function main() {
  if (!env.CLICKHOUSE_PASSWORD) {
    console.error('CLICKHOUSE_PASSWORD is required');
    process.exit(1);
  }

  // --- unconfigured worker -------------------------------------------------
  const unconfigured = await worker.fetch(post('/grant', { org, site }), { ...env, CHALLENGE_SECRET: '' });
  check('missing secret yields 500 and no work', unconfigured.status === 500);

  // --- input validation ----------------------------------------------------
  const badName = await call(post('/challenge', { org: 'Foo.Bar', site }));
  check('rejects a hostname-unsafe org', badName.status === 400);

  // --- challenge -----------------------------------------------------------
  const challenge = await call(post('/challenge', { org, site, ticket: 'SUP-SMOKE' }));
  check('challenge returns 200', challenge.status === 200, `status ${challenge.status}`);
  const { nonce } = challenge.body;
  check('challenge returns a nonce', typeof nonce === 'string' && nonce.split('.').length === 4);
  check(
    'challenge returns a paste-ready snippet carrying the nonce',
    challenge.body.snippet?.public?.supportAccess?.nonce === nonce,
  );
  check('no-store on every response', challenge.headers.get('cache-control') === 'no-store');
  check(
    'CORS is restricted to the allowlist',
    challenge.headers.get('access-control-allow-origin') === 'https://tools.aem.live',
  );

  // --- real config read, grant not yet present -----------------------------
  const notGranted = await call(post('/grant', { org, site, nonce }));
  check(
    'real published config without a grant is refused',
    notGranted.status === 403 && /no public\.supportAccess/.test(notGranted.body.error),
    `${notGranted.status} ${notGranted.body.error}`,
  );

  // --- forged nonce --------------------------------------------------------
  const forged = await call(post('/grant', { org, site, nonce: `${nonce}x` }));
  check('a tampered nonce is refused', forged.status === 403);

  // --- nonce from another site ---------------------------------------------
  const otherChallenge = await call(post('/challenge', { org, site: 'some-other-site' }));
  const crossSite = await call(post('/grant', { org, site, nonce: otherChallenge.body.nonce }));
  check('a nonce issued for another site is refused', crossSite.status === 403);

  // --- stale config --------------------------------------------------------
  stubConfig(
    { public: { supportAccess: { nonce, ticket: 'SUP-SMOKE', scope: 'site' } } },
    { lastModified: new Date(Date.now() - 3600_000).toUTCString() },
  );
  const stale = await call(post('/grant', { org, site, nonce }));
  check(
    'a config older than the challenge is refused',
    stale.status === 403 && /predates the challenge/.test(stale.body.error),
    stale.body.error,
  );

  // --- happy path ----------------------------------------------------------
  stubConfig({ public: { supportAccess: { nonce, ticket: 'SUP-SMOKE', scope: 'site' } } });
  const granted = await call(post('/grant', { org, site, nonce }));
  check('grant succeeds and mints a user', granted.status === 200, `${granted.status} ${granted.body.error || ''}`);
  const minted = granted.body;
  check('credentials are returned', !!minted.username && !!minted.password);
  check('expiry is ~72h out', Math.abs(Date.parse(minted.expires) - Date.now() - 72 * 3600e3) < 60_000);

  // --- duplicate request ---------------------------------------------------
  const second = await call(post('/grant', { org, site, nonce }));
  check('a second grant for the same scope is a 409', second.status === 409, `status ${second.status}`);

  globalThis.fetch = realFetch;

  // --- what the minted user can and cannot see ------------------------------
  if (minted.username) {
    const query = async (sql) => {
      const response = await realFetch(env.CLICKHOUSE_URL, {
        method: 'POST',
        headers: {
          'X-ClickHouse-User': minted.username,
          'X-ClickHouse-Key': minted.password,
          'Content-Type': 'text/plain',
        },
        body: sql,
      });
      return { ok: response.ok, text: (await response.text()).trim() };
    };
    const own = await query('SELECT count() FROM tenant_poc.delivery WHERE timestamp > now() - INTERVAL 1 HOUR');
    check('minted user can query its scoped view', own.ok, own.text.slice(0, 80));
    const raw = await query('SELECT count() FROM helix_logs_production.delivery');
    check('minted user cannot reach the raw table', !raw.ok && /ACCESS_DENIED/.test(raw.text));
    const registry = await query('SELECT * FROM tenant_poc.tenant_grants');
    check('minted user cannot read the grant registry', !registry.ok && /ACCESS_DENIED/.test(registry.text));
    console.log(`\nminted user for cleanup: ${minted.username}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main();
