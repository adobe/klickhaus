# Coralogix Dashboard Integration

## Overview

The dashboard supports Coralogix as a backend via OAuth2 Authorization Code + PKCE authentication, while maintaining backward compatibility with ClickHouse.

## Dev Server Port

The dev server port is deterministically derived from the working directory path. The Coralogix OAuth redirect URI is **registered with Coralogix as `http://localhost:5567/oauth-callback.html`**, so the dev server **must run on port 5567**.

```bash
PORT=5567 npm start
```

To verify the port without starting:
```bash
PORT=5567 node scripts/dev-server.mjs --dry-run
```

If you start the server on a different port, the OAuth callback will fail with a redirect URI mismatch error.

## Authentication

### Protocol: OAuth2 Authorization Code + PKCE

The integration uses **OAuth2 Authorization Code flow with PKCE** (RFC 7636). There is no username/password form — login redirects to the Coralogix authorization endpoint.

**Key security properties:**
- **PKCE** — prevents authorization code interception; the code verifier is never sent to the auth server until the token exchange
- **State parameter** — CSRF protection
- **Public client (no secret)** — web apps cannot securely store a client secret; PKCE replaces it
- **Refresh token in memory only** — never written to localStorage, reducing XSS exposure
- **Proactive token refresh** — refreshes 60 seconds before expiry to avoid 401 errors

### Login Flow

1. User clicks "Sign In"
2. `login()` in `js/coralogix/auth.js`:
   - Generates a random PKCE code verifier (43 chars) and SHA-256 challenge
   - Generates a random state value for CSRF protection
   - Stores verifier, state, and current URL in `localStorage` (temp)
   - Redirects browser to `https://api.eu2.coralogix.com/oauth/login` with params:
     ```
     response_type=code
     client_id=<CX_CLIENT_ID>
     redirect_uri=<CX_REDIRECT_URI>
     scope=openid profile email offline_access
     code_challenge=<sha256(verifier)>
     code_challenge_method=S256
     state=<random>
     ```
3. User authenticates with Coralogix
4. Coralogix redirects to `oauth-callback.html?code=...&state=...`
5. `handleOAuthCallback()` in `js/coralogix/auth.js`:
   - Verifies state matches (CSRF check)
   - POSTs code + verifier to `https://api.eu2.coralogix.com/oauth/token`
   - Stores access token and expiry in `localStorage`; refresh token in memory only
   - Fetches user info and team list
6. `oauth-callback.html` auto-selects the first available team and redirects back to the original page

### Session Persistence

`initAuth()` checks `localStorage` for an existing access token and expiry. If valid (not expired), the user stays logged in without re-authenticating. If expired and a refresh token is in memory, it refreshes automatically.

**Storage keys (localStorage):**

| Key | Value |
|-----|-------|
| `token` | Access token |
| `auth_user` | Decoded user info (JSON) |
| `auth_expires_at` | Expiry timestamp (ms) |
| `selectedTeamId` | Currently selected Coralogix team ID |
| `oauth_allowed_teams` | User's accessible teams (JSON) |

**In-memory only (not persisted):**
- Refresh token — cleared on page reload, requires re-login

### Token Refresh

`ensureFreshToken()` is called before every API request. If the access token is expired or within 60 seconds of expiry, it POSTs to the token endpoint with `grant_type=refresh_token`. On success, the new access token and expiry replace the old ones in `localStorage`.

If refresh fails (e.g., refresh token expired after page reload), an `auth-logout` event is dispatched and the login flow restarts.

### API Request Interceptor

`js/coralogix/interceptor.js` wraps all Coralogix API calls via `authenticatedFetch()`:

1. Calls `ensureFreshToken()` to proactively refresh if needed
2. Adds `Authorization: Bearer <token>` header
3. Adds `CGX-Team-Id: <team_id>` header (if a team is selected)
4. On 401 response: refreshes token and retries the request once
5. On persistent auth failure: dispatches `auth-logout` event → dashboard shows login screen

### Logout

1. User clicks logout
2. `logout()` clears all `localStorage` auth keys and the in-memory refresh token
3. POSTs to `/oauth/revoke` to revoke the token server-side (best-effort)
4. Dashboard shows login screen

### Auto-Logout on Auth Errors

`js/coralogix/interceptor.js` dispatches `auth-logout` when token refresh fails. `js/dashboard-init.js` listens for this event, shows the error message, and redirects to the login screen.

## Configuration

### env.js (local, not committed)

Create `env.js` in the repo root (excluded from git). This file is loaded by `dashboard.html` before other scripts:

```javascript
window.ENV = {
  // OAuth2 public client ID (no secret needed — PKCE handles security)
  CX_CLIENT_ID: 'a7699e23-6939-4a03-80a4-61c0e883d5bb',

  // Must match the redirect URI registered with Coralogix
  // Port 5567 is required (see Dev Server Port section above)
  CX_REDIRECT_URI: 'http://localhost:5567/oauth-callback.html',

  // Coralogix region API base URL
  CX_BASE_URL: 'https://api.eu2.coralogix.com',

  // DataPrime query endpoint
  CX_DATAPRIME_URL: 'https://ng-api-http.eu2.coralogix.com/api/v1/dataprime/query',

  // ClickHouse credentials (optional, for Domain Explorer read-only access)
  CH_USER: '',
  CH_PASSWORD: '',
};
```

### Coralogix Config (js/coralogix/config.js)

OAuth2 endpoints are hardcoded to the EU2 region:

| Setting | Value |
|---------|-------|
| Authorization endpoint | `https://api.eu2.coralogix.com/oauth/login` |
| Token endpoint | `https://api.eu2.coralogix.com/oauth/token` |
| Revocation endpoint | `https://api.eu2.coralogix.com/oauth/revoke` |
| Client ID | From `window.ENV.CX_CLIENT_ID` |
| Redirect URI | From `window.ENV.CX_REDIRECT_URI` |

## Testing

### Manual Testing

1. Start dev server on port 5567:
   ```bash
   PORT=5567 npm start
   ```
2. Open `http://localhost:5567/dashboard.html`
3. Should see "Sign In" button (not a username/password form)
4. Click "Sign In" → redirected to Coralogix login page
5. Authenticate with Coralogix credentials
6. Browser redirects to `oauth-callback.html` → auto-redirects to dashboard
7. Dashboard loads data
8. Refresh page → stays logged in (access token in localStorage)
9. Click logout → returns to login screen; refresh token cleared from memory

### Error Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Wrong port (not 5567) | Coralogix rejects redirect URI mismatch |
| Missing `CX_CLIENT_ID` | Configuration error shown before login |
| Expired access token (still have refresh token) | Auto-refresh on next API call |
| Expired access token (no refresh token, e.g. after reload) | `auth-logout` dispatched, login screen shown |
| Network error during token exchange | Error shown on callback page |
| Invalid OAuth state (CSRF attempt) | Error thrown, login aborted |

## Architecture

### Key Files

| File | Purpose |
|------|---------|
| `js/coralogix/auth.js` | OAuth2 PKCE implementation: login, callback handling, token storage, refresh |
| `js/coralogix/interceptor.js` | `authenticatedFetch()` — adds auth headers, handles 401 retry |
| `js/coralogix/config.js` | Configuration with `getEnv()` for browser/Node.js compatibility |
| `js/coralogix/adapter.js` | Query builder for DataPrime (time series, breakdowns, logs) |
| `js/dashboard-init.js` | Initialization flow: check auth → show login or dashboard |
| `oauth-callback.html` | OAuth redirect target: exchanges code, selects team, redirects back |
| `env.js` | Local config (not committed) |

### Dashboard Init Flow

1. Load URL state
2. Apply dashboard configuration
3. Populate UI selects and initialize components
4. Check Coralogix configuration (warn if incomplete)
5. Call `initAuth()` — checks for valid existing session
6. **If authenticated**: preload templates → sync UI → show dashboard → load data
7. **If not authenticated**: show login screen → wait for `login-success` event
8. After login: attach team selector, load data

## Backend Compatibility

The changes are backward-compatible:
- ClickHouse auth (`js/auth.js`) is untouched
- `js/backend-adapter.js` defaults to ClickHouse when Coralogix is not configured
- Other dashboards using ClickHouse continue to work unchanged

## Security Notes

1. **No client secret** — PKCE replaces it for public clients; the client ID is not sensitive
2. **Refresh token in memory** — cleared on page reload; trade-off between security (no XSS persistence) and UX (requires re-login after reload)
3. **Access token in localStorage** — XSS-vulnerable; consider `httpOnly` cookies in production
4. **HTTPS required in production** — credentials and tokens are exposed over HTTP in dev only
5. **Never commit `env.js`** — it contains the client ID and redirect URI; git-ignored
