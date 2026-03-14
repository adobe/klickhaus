# Coralogix Integration Quick Start

## Setup (5 minutes)

### 1. Start the Dev Server on Port 5567

The OAuth redirect URI is registered with Coralogix for port 5567:

```bash
PORT=5567 npm start
```

### 2. Configure Environment

Create `env.js` in the repo root (already git-ignored):

```javascript
window.ENV = {
  CX_CLIENT_ID: 'a7699e23-6939-4a03-80a4-61c0e883d5bb',
  CX_REDIRECT_URI: 'http://localhost:5567/oauth-callback.html',
  CX_BASE_URL: 'https://api.eu2.coralogix.com',
  CX_DATAPRIME_URL: 'https://ng-api-http.eu2.coralogix.com/api/v1/dataprime/query',
};
```

No team ID needed — it is fetched automatically after login.

### 3. Login

Open the dashboard, click **Sign In**, and authenticate with your Coralogix credentials. The OAuth callback auto-selects your first available team and redirects back to the dashboard.

### 4. Done!

The dashboard uses the Coralogix Data Prime API for all queries.

## How It Works

### Login Flow

```
User clicks "Sign In"
    ↓
Redirect to Coralogix authorization endpoint (OAuth2 + PKCE)
    ↓
User authenticates on Coralogix
    ↓
Redirect to oauth-callback.html?code=...
    ↓
Code exchanged for access + refresh tokens
Teams fetched, first team auto-selected
    ↓
Redirect back to dashboard
Dashboard loads data via Data Prime
```

### Session Management

- Access token stored in `localStorage` — persists across reloads
- Refresh token stored in memory only — cleared on page reload (requires re-login after reload)
- Token auto-refreshed 60 seconds before expiry
- Auto-logout on unrecoverable 401 errors

### Query Translation

ClickHouse SQL queries are automatically translated to Data Prime syntax:

```sql
-- ClickHouse
SELECT count() FROM cdn_requests_v2
WHERE timestamp >= now() - INTERVAL 1 HOUR
```

```dataprime
-- Data Prime
source logs between @'2024-01-01T00:00:00Z' and @'2024-01-01T01:00:00Z'
| filter $l.subsystemname in ['cloudflare', 'fastly']
| aggregate count()
```

## Common Issues

### Wrong port (not 5567)
Coralogix rejects the redirect URI with a mismatch error. Always use `PORT=5567 npm start`.

### "Coralogix is not configured"
`CX_CLIENT_ID` or `CX_REDIRECT_URI` is missing from `window.ENV`. Check that `env.js` exists and is loaded.

### Dashboard loads but shows no data
1. Check `localStorage.getItem('token')` is set
2. Check `localStorage.getItem('selectedTeamId')` is set
3. Check the network tab for Data Prime query errors

### "Session expired" / auto-logout after reload
The refresh token is in-memory only and is lost on page reload. Click **Sign In** to re-authenticate.

## Debug Helpers (Browser Console)

```javascript
// View current auth state
console.log('Token:', localStorage.getItem('token'));
console.log('User:', JSON.parse(localStorage.getItem('auth_user')));
console.log('Team:', localStorage.getItem('selectedTeamId'));
console.log('Teams:', JSON.parse(localStorage.getItem('oauth_allowed_teams')));
console.log('Expires:', new Date(parseInt(localStorage.getItem('auth_expires_at'), 10)));

// Clear session (forces re-login)
['token', 'auth_user', 'auth_expires_at', 'selectedTeamId', 'oauth_allowed_teams'].forEach(k => localStorage.removeItem(k));
location.reload();
```

## Key Files

| File | Purpose |
|------|---------|
| `env.js` | Local config — client ID, redirect URI, API URLs (not committed) |
| `oauth-callback.html` | OAuth redirect target — exchanges code, selects team, redirects back |
| `js/coralogix/auth.js` | OAuth2 PKCE implementation |
| `js/coralogix/interceptor.js` | Adds auth headers, handles token refresh and 401 retry |
| `js/coralogix/adapter.js` | Data Prime query builder |
| `js/dashboard-init.js` | Dashboard initialization and auth integration |

See `CORALOGIX_INTEGRATION.md` for full architecture and security details.
