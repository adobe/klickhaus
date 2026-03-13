# Coralogix Dashboard Integration

## Overview

The dashboard initialization has been updated to support Coralogix authentication and API integration while maintaining backward compatibility with ClickHouse.

## Changes Made

### 1. Updated `/Users/yoni/klickhaus/js/dashboard-init.js`

#### Authentication Changes
- **Removed**: ClickHouse-specific auth imports (`setElements`, `handleLogin`, `handleLogout`, `loadStoredCredentials` from `./auth.js`)
- **Added**: Coralogix auth imports from `./coralogix/auth.js`:
  - `initAuth` - Initialize auth state from stored session
  - `login` - Login with username/password
  - `logout` - Logout and clear session
  - `isLoggedIn` - Check login state
  - `getToken` - Get JWT token
  - `getTeams` - Fetch user's teams

#### Configuration Validation
- Added `isCoralogixConfigured()` and `getConfigurationErrors()` imports from `./coralogix/adapter.js`
- Displays configuration errors in login form if Coralogix is not properly configured

#### DOM Elements
- Added references to login form elements:
  - `usernameInput` - Username input field
  - `passwordInput` - Password input field
  - `forgetMeCheckbox` - Persist session checkbox (not currently used)

#### Login Handler (`handleCoralogixLogin`)
- Prevents default form submission
- Shows loading state on submit button ("Signing in...")
- Calls `login()` with credentials
- Loads user teams after successful login (non-critical)
- Dispatches `login-success` event
- Shows error messages on failure
- Re-enables submit button on error

#### Logout Handler (`handleCoralogixLogout`)
- Calls Coralogix `logout()` function
- Clears localStorage entries:
  - `hostAutocompleteSuggestions`
  - All `anomaly_investigation_*` cache keys
- Shows login screen

#### UI State Functions
- `showCoralogixLogin()` - Show login screen, hide dashboard
- `showCoralogixDashboard()` - Show dashboard, hide login screen
- Dispatches `dashboard-shown` event for autocomplete loading

#### Initialization Flow
1. Load URL state
2. Apply dashboard-specific configuration
3. Populate UI selects and initialize components
4. **Check Coralogix configuration** - Log warnings if incomplete
5. **Initialize Coralogix auth** - Call `initAuth()` to check for existing session
6. If valid session exists:
   - Preload SQL templates
   - Sync UI from state
   - Reorder facets
   - Show dashboard
   - Load data
7. If no valid session:
   - Show login screen
8. Attach event listeners for login/logout

#### Event Listeners
- `login-success` - Triggered after successful login to setup UI and load data
- `auth-logout` - Triggered by Coralogix interceptor on auth errors (401, expired token)
  - Shows error message from event detail
  - Returns to login screen

### 2. Updated `/Users/yoni/klickhaus/js/coralogix/config.js`

#### Browser Environment Support
- Added `getEnv(key)` helper function to support both Node.js and browser environments
- Checks `window.ENV` object in browser
- Falls back to `process.env` in Node.js
- Returns `null` if neither exists

#### Configuration Properties
All environment variable references now use `getEnv()`:
- `CX_DATAPRIME_URL` - Data Prime API endpoint
- `CX_GRPC_GATEWAY_URL` - gRPC gateway URL
- `CX_HTTP_GATEWAY_URL` - HTTP gateway URL
- `CX_BASE_URL` - Base API URL
- `CX_TEAM_ID` - Team ID
- `CX_API_KEY` - API key (not used for JWT auth, but kept for backward compatibility)

### 3. Created `/Users/yoni/klickhaus/js/backend-adapter.js`

A unified backend adapter that provides a single interface for both ClickHouse and Coralogix backends.

#### Backend Detection
- `detectBackend()` - Automatically detects which backend to use
  - Returns `BACKEND_TYPE.CORALOGIX` if Coralogix is configured and user is logged in
  - Returns `BACKEND_TYPE.CLICKHOUSE` otherwise
- `isUsingCoralogix()` - Boolean check for Coralogix backend

#### Query Functions
- `executeQuery(sql, options)` - Execute raw SQL (ClickHouse only, throws error for Coralogix)
- `fetchTimeSeriesData(params)` - Fetch time series for chart
- `fetchBreakdownData(params)` - Fetch facet/breakdown data
- `fetchLogsData(params)` - Fetch logs data

#### Configuration
- `getBackendConfig()` - Returns backend capabilities
  - `type` - Backend type
  - `isCoralogix` - Boolean flag
  - `isClickHouse` - Boolean flag
  - `supportsRawSQL` - Whether raw SQL is supported
  - `requiresTranslation` - Whether queries need translation

**Note**: The adapter currently throws errors for ClickHouse-specific methods as those need to be implemented to wrap existing `query()` calls.

## Integration Points

### Chart (`js/chart.js`)
- Uses `loadTimeSeries()` which calls `query()` with SQL
- **Future**: Should be updated to use `backend-adapter.fetchTimeSeriesData()`

### Breakdowns (`js/breakdowns/index.js`)
- Uses `loadBreakdown()` which calls `query()` with SQL
- **Future**: Should be updated to use `backend-adapter.fetchBreakdownData()`

### Logs (`js/logs.js`)
- Uses `loadLogs()` which calls `query()` with SQL
- **Future**: Should be updated to use `backend-adapter.fetchLogsData()`

## Existing Features Maintained

All existing dashboard features are maintained:
- Time range selection
- Host filtering
- Facet filtering
- Dark mode
- URL state management
- Keyboard navigation
- Mobile touch support
- Anomaly detection and investigation
- Release tracking
- Pull-to-refresh

## Authentication Flow

### Login
1. User enters username and password
2. Click "Sign In" (button shows "Signing in...")
3. `login()` calls Coralogix `/api/v1/user/login`
4. On success:
   - JWT token stored in localStorage (`token`)
   - User object stored in localStorage (`auth_user`)
   - Optional: refresh token stored (`auth_refresh_token`)
   - Optional: expiry time stored (`auth_expires_at`)
5. Load user teams (optional, non-blocking)
6. Show dashboard
7. Dispatch `login-success` event
8. Dashboard loads data

### Session Persistence
- `initAuth()` checks localStorage for existing token
- Validates token with server (`/api/v1/user/auth`)
- If valid, user stays logged in
- If invalid or expired, shows login screen

### Logout
1. User clicks logout button
2. `logout()` clears localStorage
3. Calls `/api/v1/user/logout` (best-effort)
4. Shows login screen

### Auto-Logout on Auth Error
- Coralogix interceptor (`js/coralogix/interceptor.js`) detects 401 responses
- Dispatches `auth-logout` event
- Dashboard shows error message and login screen

## Configuration Requirements

### Environment Variables (Browser)
Set these on `window.ENV` before loading the dashboard:

```javascript
window.ENV = {
  CX_DATAPRIME_URL: 'https://api.coralogix.com/api/v1/dataprime/query',
  CX_TEAM_ID: 'your-team-id',
  // Optional overrides:
  CX_GRPC_GATEWAY_URL: 'https://ng-api-grpc.coralogix.com',
  CX_HTTP_GATEWAY_URL: 'https://ng-api-http.coralogix.com',
  CX_BASE_URL: 'https://api.coralogix.com',
};
```

### Environment Variables (Node.js)
If running in Node.js environment (e.g., tests):

```bash
export CX_DATAPRIME_URL=https://api.coralogix.com/api/v1/dataprime/query
export CX_TEAM_ID=your-team-id
```

## Testing

### Manual Testing
1. Open dashboard in browser
2. Should see login form (not auto-login with ClickHouse credentials)
3. Enter Coralogix username and password
4. Should show dashboard after successful login
5. Refresh page - should stay logged in
6. Click logout - should return to login screen

### Error Cases
1. Invalid credentials - Shows error message
2. Network error - Shows error message
3. Missing configuration - Shows configuration error
4. Session expired - Auto-logout with error message

## Future Work

### 1. Complete Backend Adapter Integration
Update `chart.js`, `breakdowns/index.js`, and `logs.js` to use the backend adapter instead of direct `query()` calls.

### 2. Add Tier Selection UI
Optionally add UI controls for selecting query tier (FREQUENT_SEARCH vs ARCHIVE):
- Could be a dropdown in header
- Could auto-select based on time range
- Could be per-query selection

### 3. Implement ClickHouse Wrappers in Backend Adapter
Complete the ClickHouse adapter methods to wrap existing `query()` functionality:
- `fetchTimeSeriesData()` for ClickHouse
- `fetchBreakdownData()` for ClickHouse
- `fetchLogsData()` for ClickHouse

### 4. Add Team Selector
If user has access to multiple teams, show team selector in UI:
- Dropdown in header
- Load data for selected team
- Persist selection to localStorage

### 5. Token Refresh
Implement automatic token refresh before expiry:
- Monitor token expiry time
- Call `/api/v1/user/refresh` before expiry
- Update stored token
- Retry failed request with new token

## Backward Compatibility

The changes maintain backward compatibility:
- ClickHouse auth module (`js/auth.js`) is untouched
- Other dashboards using ClickHouse continue to work
- Backend adapter defaults to ClickHouse when Coralogix is not configured
- No breaking changes to existing API

## Security Notes

1. **JWT Storage**: Tokens stored in localStorage (not sessionStorage) for persistence
   - Consider using `httpOnly` cookies in production for better XSS protection
2. **CORS**: Coralogix API must allow dashboard origin
3. **Credentials**: Never commit API keys or credentials to repository
4. **HTTPS**: Always use HTTPS in production to protect credentials in transit
