# Coralogix Interceptor Integration Guide

This guide shows how to integrate the Coralogix HTTP interceptor into your existing codebase.

## Quick Start

### 1. Set Up Authentication

```javascript
import { setAuthCredentials } from './js/coralogix/auth.js';

// After successful login, store credentials
setAuthCredentials('your-bearer-token', 12345); // token, teamId
```

### 2. Replace Existing Fetch Calls

```javascript
// Before
const response = await fetch('/api/data', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: 'test' }),
});

// After
import { authenticatedFetch } from './js/coralogix/interceptor.js';

const response = await authenticatedFetch('/api/data', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: 'test' }),
});
```

## Integration Examples

### Example 1: Login Flow

```javascript
import { setAuthCredentials } from './js/coralogix/auth.js';
import { authenticatedFetch } from './js/coralogix/interceptor.js';

async function login(username, password) {
  // Login request skips auth (X-Skip-Auth header added automatically)
  const response = await authenticatedFetch('/user/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    throw new Error('Login failed');
  }

  const data = await response.json();

  // Store credentials for future requests
  setAuthCredentials(data.token, data.teamId);

  return data;
}
```

### Example 2: API Calls with Token Refresh

```javascript
import { authenticatedFetch } from './js/coralogix/interceptor.js';

async function fetchData() {
  try {
    // If token is expired (401), interceptor automatically:
    // 1. Calls refreshToken()
    // 2. Retries with new token
    const response = await authenticatedFetch('/api/data');

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    return await response.json();
  } catch (err) {
    console.error('Failed to fetch data:', err);
    throw err;
  }
}
```

### Example 3: AbortController Integration

```javascript
import { authenticatedFetch } from './js/coralogix/interceptor.js';

let currentController = null;

async function searchWithCancel(query) {
  // Cancel previous request if still running
  if (currentController) {
    currentController.abort();
  }

  currentController = new AbortController();

  try {
    const response = await authenticatedFetch('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
      signal: currentController.signal,
    });

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }

    return await response.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('Search cancelled');
      return null;
    }
    throw err;
  }
}
```

### Example 4: Logout Handler

```javascript
import { clearAuthCredentials } from './js/coralogix/auth.js';

// Listen for logout events
window.addEventListener('auth-logout', (event) => {
  console.log('User logged out:', event.detail.reason);

  // Clear UI state
  document.getElementById('loginSection').classList.remove('hidden');
  document.getElementById('dashboardSection').classList.add('hidden');

  // Show error message
  const errorMsg = document.getElementById('loginError');
  errorMsg.textContent = event.detail.reason;
  errorMsg.classList.add('visible');
});

async function logout() {
  // Clear auth credentials
  clearAuthCredentials();

  // Call logout endpoint (skips auth)
  await authenticatedFetch('/user/logout', {
    method: 'DELETE',
  });

  // Redirect to login
  window.location.href = '/login';
}
```

### Example 5: DataPrime Query with Interceptor

```javascript
import { setAuthCredentials } from './js/coralogix/auth.js';
import { executeDataPrimeQuery, TIER_ARCHIVE } from './js/coralogix/api.js';

// Set credentials once at startup
setAuthCredentials('your-token', 12345);

async function queryLogs(filter, startDate, endDate) {
  const query = `source logs | filter ${filter} | limit 100`;

  try {
    // The api.js uses authenticatedFetch internally
    // so token refresh is automatic
    const results = await executeDataPrimeQuery(query, {
      tier: TIER_ARCHIVE,
      startDate,
      endDate,
      limit: 100,
    });

    console.log('Query results:', results);
    return results;
  } catch (err) {
    console.error('Query failed:', err);
    throw err;
  }
}
```

## Migration Checklist

- [ ] Import `authenticatedFetch` from `./js/coralogix/interceptor.js`
- [ ] Replace all `fetch()` calls with `authenticatedFetch()`
- [ ] Set up authentication on login with `setAuthCredentials(token, teamId)`
- [ ] Add logout event listener for `auth-logout` events
- [ ] Test token refresh flow (force a 401 response)
- [ ] Test AbortController integration
- [ ] Verify skip auth URLs (login, refresh, etc.)

## API Reference

### Auth Module (`auth.js`)

```javascript
// Set credentials
setAuthCredentials(token, teamId);

// Get credentials
const token = getToken();
const teamId = getSelectedTeamId();

// Clear credentials
clearAuthCredentials();

// Refresh token (called automatically by interceptor)
await refreshToken();

// Force logout
forceLogout('Session expired');
```

### Interceptor Module (`interceptor.js`)

```javascript
// Authenticated fetch (drop-in replacement for fetch)
const response = await authenticatedFetch(url, options);

// Skip auth for specific request
const response = await authenticatedFetch(url, {
  headers: { 'X-Skip-Auth': 'true' }
});
```

## Error Handling

The interceptor preserves all standard fetch error handling:

```javascript
try {
  const response = await authenticatedFetch('/api/data');

  // Check response status
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data;
} catch (err) {
  // Handle errors
  if (err.name === 'AbortError') {
    console.log('Request cancelled');
  } else if (err.message.includes('401')) {
    console.log('Authentication failed');
  } else {
    console.error('Request failed:', err);
  }
}
```

## Testing

Run the interceptor tests:

```bash
npm test js/coralogix/interceptor.test.js
```

## Troubleshooting

### Token not being added to requests

Check that credentials are set:

```javascript
import { getToken, getSelectedTeamId } from './js/coralogix/auth.js';

console.log('Token:', getToken());
console.log('Team ID:', getSelectedTeamId());
```

### Token refresh not working

Ensure the refresh token is set:

```javascript
import { setRefreshToken } from './js/coralogix/auth.js';

setRefreshToken('your-refresh-token');
```

### Infinite retry loop

The interceptor uses a `WeakSet` to track retrying requests. If you see infinite retries, check:

1. The refresh endpoint is returning a valid token
2. The new token is being stored correctly
3. The retry is not being triggered for `/refresh` URLs

### CORS errors

The interceptor preserves all fetch behavior. CORS errors should be fixed on the server side.

## Performance Considerations

1. **Token refresh is automatic**: No need to manually refresh tokens before requests
2. **Single retry per request**: Each request retries at most once on 401
3. **No request queuing**: Multiple concurrent requests during token refresh may trigger multiple refresh calls (consider implementing a refresh queue if needed)
4. **Minimal overhead**: The interceptor adds negligible latency (< 1ms) to each request

## Security Best Practices

1. **Never log tokens**: The interceptor doesn't log sensitive data
2. **Use HTTPS**: Always use HTTPS for production deployments
3. **Short token lifetimes**: Use short-lived access tokens (< 15 minutes)
4. **Secure refresh tokens**: Store refresh tokens securely (httpOnly cookies preferred)
5. **Logout on refresh failure**: The interceptor automatically logs out when refresh fails
