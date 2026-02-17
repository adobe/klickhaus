# Coralogix Integration Quick Start

## Setup (5 minutes)

### 1. Configure Environment
Add to your HTML before loading dashboard scripts:

```html
<script>
  window.ENV = {
    CX_TEAM_ID: 'your-team-id-here'
  };
</script>
```

### 2. Login
The dashboard will show a login form. Enter your Coralogix username and password.

### 3. Done!
The dashboard now uses Coralogix Data Prime API for all queries.

## How It Works

### Login Flow
```
User enters credentials
    ↓
POST /api/v1/user/login
    ↓
JWT token stored in localStorage
    ↓
Dashboard loads data via Data Prime
```

### Query Translation
ClickHouse SQL queries are automatically translated to Data Prime syntax:

```sql
-- ClickHouse
SELECT count() FROM cdn_requests_v2
WHERE timestamp >= now() - INTERVAL 1 HOUR
```

```dataprime
// Data Prime
source logs
| filter $m.timestamp >= timestamp('2024-01-01T00:00:00Z')
| aggregate count()
```

### Session Management
- Token stored in localStorage (`token` key)
- Auto-validates on page load
- Auto-logout on 401 errors
- Manual logout button available

## Files Modified

1. **`js/dashboard-init.js`** - Main initialization with Coralogix auth
2. **`js/coralogix/config.js`** - Browser environment support
3. **`js/backend-adapter.js`** - New: unified backend interface

## Common Issues

### "Coralogix is not configured"
**Solution**: Set `window.ENV.CX_TEAM_ID` before loading dashboard

### Login shows "Authentication failed"
**Check**:
1. Credentials are correct
2. Network tab shows 200 response from `/api/v1/user/login`
3. Token is stored in localStorage

### Dashboard loads but shows no data
**Check**:
1. Token exists in localStorage
2. Network requests to Data Prime API
3. Console for query errors

### "Session expired" after page refresh
**Check**:
1. Token exists in localStorage (`localStorage.getItem('token')`)
2. Token is valid (not expired)
3. `/api/v1/user/auth` returns 200

## API Endpoints

All requests go to `https://api.coralogix.com` (configurable):

- `POST /api/v1/user/login` - Login with credentials
- `GET /api/v1/user/auth` - Validate current session
- `GET /api/v1/user/team` - Get user's teams
- `POST /api/v1/dataprime/query` - Execute Data Prime query
- `DELETE /api/v1/user/logout` - Logout (optional)

## Development

### Enable Debug Logging
```javascript
// In browser console
localStorage.setItem('debug', 'coralogix:*');
```

### View Current Token
```javascript
// In browser console
console.log('Token:', localStorage.getItem('token'));
console.log('User:', JSON.parse(localStorage.getItem('auth_user')));
```

### Clear Session
```javascript
// In browser console
localStorage.removeItem('token');
localStorage.removeItem('auth_user');
localStorage.removeItem('auth_refresh_token');
location.reload();
```

## Next Steps

### Add Team Selector
If user has multiple teams, add UI to switch between them:

```javascript
import { getTeams, selectTeam } from './coralogix/auth.js';

const teams = await getTeams();
// Show dropdown with teams
// On selection: selectTeam(teamId)
```

### Add Tier Selection
Add UI control for query tier (Frequent Search vs Archive):

```javascript
import { QUERY_TIERS } from './coralogix/config.js';

// In dashboard UI:
<select id="tierSelect">
  <option value="TIER_FREQUENT_SEARCH">Recent Data (Fast)</option>
  <option value="TIER_ARCHIVE">Archive (Slower, Cost-effective)</option>
</select>
```

### Customize API Endpoints
Override default endpoints:

```javascript
window.ENV = {
  CX_TEAM_ID: 'your-team-id',
  CX_BASE_URL: 'https://api.eu2.coralogix.com',
  CX_DATAPRIME_URL: 'https://api.eu2.coralogix.com/api/v1/dataprime/query',
};
```

## Support

### Coralogix Documentation
- [Data Prime Syntax](https://coralogix.com/docs/dataprime-query-language/)
- [Authentication](https://coralogix.com/docs/authentication/)
- [API Reference](https://coralogix.com/docs/api-reference/)

### Project Files
- `/Users/yoni/klickhaus/js/coralogix/README.md` - Full Coralogix module documentation
- `/Users/yoni/klickhaus/CORALOGIX_INTEGRATION.md` - Integration details
- `/Users/yoni/klickhaus/js/coralogix/auth.js` - Authentication service
- `/Users/yoni/klickhaus/js/coralogix/adapter.js` - Query adapter
- `/Users/yoni/klickhaus/js/backend-adapter.js` - Backend abstraction layer
