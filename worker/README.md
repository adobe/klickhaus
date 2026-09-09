# support-access-grant worker

Mints a time-boxed, tenant-scoped ClickHouse user after a site admin has consented,
so a support engineer can look at that customer's CDN logs without the customer
handing over an account and without support holding standing access.

## Why consent lives in the site config

The Admin API authenticates with an httpOnly `auth_token` cookie on
`admin.hlx.page`. The Sidekick extension exposes no message that returns that
token (`getAuthInfo` returns only the list of orgs), so a page cannot forward a
credential to a worker, and a browser-side permission check proves nothing to a
server.

What *is* verifiable: the `public` block of a site config is writable only with the
config role on that site, and is served unauthenticated at
`https://main--<site>--<org>.aem.live/config.json`. If the worker can read its own
challenge nonce back out of that document, an admin of that site must have put it
there. That inverts the problem into something the worker can check on its own,
with no caller token and no standing Admin API credential.

## Flow

```
support engineer                customer (site admin)              worker
      |                                  |                            |
      |  sends link ------------------->  |                            |
      |                                  |-- POST /challenge --------> |
      |                                  |<- nonce + config snippet -- |
      |                                  |                            |
      |                        pastes snippet into site               |
      |                        config, publishes it                   |
      |                                  |                            |
      |                                  |-- POST /grant ------------> |
      |                                  |                     reads public
      |                                  |                     config, sees nonce
      |                                  |                     mints CH user
      |                                  |<- username + password ---- |
      |<--- customer shares credentials --|                            |
```

## Endpoints

| Route | Purpose |
|---|---|
| `GET /health` | liveness |
| `POST /challenge` `{org, site, ticket?}` | returns `nonce`, `expires` and a paste-ready `snippet` |
| `POST /grant` `{org, site, nonce}` | verifies consent, mints the user, returns credentials once |

The grant block the customer adds:

```json
{
  "public": {
    "supportAccess": {
      "nonce": "<from /challenge>",
      "ticket": "SUP-12345",
      "scope": "site"
    }
  }
}
```

`scope` is `site` or `org`. `ticket` is required so every grant is auditable.

## What stops abuse

- **Challenge nonces are HMAC-signed and bound to one org/site**, so a nonce
  obtained for a site you do control cannot be replayed against one you do not.
  Signed rather than stored, so the worker needs no KV or database.
- **The config must have been modified after the challenge was issued.** This turns
  a leaked nonce from a standing capability into a single-use one.
- **Cache-busting on the config read.** `config.json` is served with
  `max-age=7200`, so a plain fetch could see a two-hour-old copy. The worker adds a
  unique query parameter and `cache-control: no-cache`.
- **Org and site are validated against a hostname-safe pattern**, not escaped,
  because they are interpolated into the config hostname.
- **One active grant per scope.** A repeat request returns `409` with the existing
  username instead of minting a second credential.
- **Two independent expiries**, both server-side: `VALID UNTIL` on the ClickHouse
  user blocks authentication, and the registry row's `expires` makes the scoped
  views return zero rows. Nothing has to be revoked by hand.
- **The worker cannot read customer data.** It authenticates as `tenant_minter`,
  which holds no SELECT on any log table. Since ClickHouse only lets a user grant
  privileges it holds itself, a leaked minter credential can only produce users
  limited to `tenant_selfserve`.
- **Credentials are returned once**, with `Cache-Control: no-store`, and raw
  ClickHouse errors are never forwarded to the caller because they can echo
  statement text containing the generated password.

## Setup

Apply the SQL first, in this order:

```sh
clickhouse client ... < ../sql/tenant_scoped_access.poc.sql
clickhouse client ... < ../sql/tenant_minter_user.sql   # after setting a password
```

Then configure the worker:

```sh
npm install
wrangler secret put CHALLENGE_SECRET     # openssl rand -base64 32
wrangler secret put CLICKHOUSE_USER      # tenant_minter
wrangler secret put CLICKHOUSE_PASSWORD
```

Non-secret settings live in `wrangler.toml`. `ALLOWED_ORIGINS` defaults to
`https://tools.aem.live`.

## Tests

```sh
npm test                                  # 32 unit tests, no network
CLICKHOUSE_PASSWORD=... node test/smoke.mjs <org> <site>
```

The smoke test runs the real fetch handler under Node against the real cluster and
the real published config. It stubs only the site-config read for the happy path,
since writing a grant into a live site config needs an Admin API session; every
other hop, including all ClickHouse work, is real. It also asserts that the minted
user can read its own scoped view and cannot reach `helix_logs_production.delivery`
or the grant registry.

It creates a real 72-hour user when it passes. Drop it afterwards:

```sql
DROP USER <username>;
ALTER TABLE tenant_poc.tenant_grants DELETE WHERE ch_user = '<username>';
```

## Known gaps

- **Org-scope grants still verify against one site's config**, because there is no
  published config surface at org level. The customer proves admin on a site they
  own, and receives org-wide log access. Tighten this before enabling `org` scope
  for real.
- **`tenant_poc` is a proof-of-concept database.** Promote it to
  `helix_logs_tenant` before production use.
- **The customer receives the credentials and forwards them.** If support should
  receive them directly, that changes the audit story and needs deciding.
- **No notification.** Nothing tells the org owner that a grant was minted. A
  Slack or email notice on mint would be worth adding.
