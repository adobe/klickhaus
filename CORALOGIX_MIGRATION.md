# Coralogix Migration Guide

Complete guide for migrating klickhaus from ClickHouse to Coralogix Data Prime.

---

## Table of Contents

1. [Overview](#overview)
2. [Setup](#setup)
3. [Configuration](#configuration)
4. [Query Translation Guide](#query-translation-guide)
5. [API Reference](#api-reference)
6. [Testing](#testing)
7. [Deployment](#deployment)
8. [Troubleshooting](#troubleshooting)

---

## Overview

### Why Migrate to Coralogix?

- **Unified observability platform**: Combine logs, metrics, and traces in one system
- **Cost optimization**: Archive tier for historical data reduces storage costs
- **Enhanced security**: Enterprise-grade security and compliance features
- **Managed infrastructure**: No database maintenance or scaling concerns
- **Advanced querying**: Data Prime query language with powerful analytics capabilities

### Architecture Changes

**Before (ClickHouse):**
```
CDN Logs → ClickHouse Cloud → SQL Queries → Dashboard
```

**After (Coralogix):**
```
CDN Logs → Coralogix Ingestion → Data Prime Queries → Dashboard
```

### Key Benefits

| Feature | ClickHouse | Coralogix |
|---------|------------|-----------|
| **Query Language** | SQL | Data Prime (more expressive) |
| **Data Retention** | Manual TTL management | Tiered storage (Frequent/Archive) |
| **Authentication** | Basic auth | Bearer token with team-based access |
| **API** | HTTP endpoint | RESTful API with retry logic |
| **Field Access** | Flat dot notation | Namespaced (`$d`, `$l`, `$m`) |
| **Real-time** | Async inserts | Built-in real-time indexing |

---

## Setup

### Prerequisites

- Node.js 18+ installed
- Active Coralogix account
- Access to create API keys in Coralogix

### 1. Coralogix Account Setup

1. **Log into Coralogix**
   - Navigate to [https://coralogix.com](https://coralogix.com)
   - Sign in with your credentials

2. **Identify Your Region**

   Coralogix has regional endpoints. Identify your region from the Coralogix UI URL:

   | Region | UI URL | API Base |
   |--------|--------|----------|
   | **US1** (Default) | `https://coralogix.com` | `https://api.coralogix.com` |
   | **EU1** (Ireland) | `https://coralogix.com` | `https://api.coralogix.com` |
   | **EU2** (Stockholm) | `https://eu2.coralogix.com` | `https://api.eu2.coralogix.com` |
   | **AP1** (India) | `https://app.coralogix.in` | `https://api.app.coralogix.in` |
   | **AP2** (Singapore) | `https://coralogixsg.com` | `https://api.coralogixsg.com` |

### 2. API Key Generation

1. **Navigate to Settings**
   - Settings → Account → API Keys

2. **Create New API Key**
   - Click "Generate New Key"
   - Name: `klickhaus-dashboard`
   - Select required scopes:
     - ✅ **DataPrime Query** (required)
     - ✅ **Logs Query** (required)
   - Click "Generate"

3. **Copy API Key**
   - Copy the generated key immediately
   - Store securely (1Password, AWS Secrets Manager, etc.)
   - **Warning**: Key is only shown once!

### 3. Team ID Configuration

1. **Find Team ID**
   - Settings → Account → General Information
   - Copy the **Team ID** value (numeric)

2. **Record Team ID**
   - Save alongside your API key
   - Format: `12345` (numeric value)

### 4. Environment Variables

Create a `.env` file in the project root:

```bash
# Copy example configuration
cp .env.example .env
```

Edit `.env` and add your credentials:

```bash
# Required: Authentication
CX_TEAM_ID=12345
CX_API_KEY=your-api-key-here

# Optional: Regional Endpoints (uncomment for non-US regions)
# For EU2 (Stockholm):
# CX_BASE_URL=https://api.eu2.coralogix.com
# CX_GRPC_GATEWAY_URL=https://ng-api-grpc.eu2.coralogix.com
# CX_HTTP_GATEWAY_URL=https://ng-api-http.eu2.coralogix.com

# Optional: Environment
NODE_ENV=development
```

### 5. Install Dependencies

```bash
npm install
```

### 6. Verify Setup

Run the configuration validator:

```bash
node -e "import('./js/coralogix/config.js').then(({ CORALOGIX_CONFIG }) => {
  const validation = CORALOGIX_CONFIG.validate();
  console.log(validation.isValid ? '✅ Configuration valid' : '❌ ' + validation.message);
})"
```

Expected output:
```
✅ Configuration valid
```

---

## Configuration

### .env File Setup

Complete `.env` file reference:

```bash
# ============================================================================
# REQUIRED: Coralogix Authentication
# ============================================================================

# Your Coralogix Team ID (found in Settings > Account > General Information)
CX_TEAM_ID=12345

# Your Coralogix API Key (created in Settings > Account > API Keys)
# Required scopes: DataPrime Query, Logs Query
CX_API_KEY=your-api-key-here

# ============================================================================
# OPTIONAL: API Endpoints (defaults provided if not set)
# ============================================================================

# DataPrime Query API endpoint
# Default: https://api.coralogix.com/api/v1/dataprime/query
CX_DATAPRIME_URL=https://api.coralogix.com/api/v1/dataprime/query

# gRPC Service Gateway endpoint
# Default: https://ng-api-grpc.coralogix.com
CX_GRPC_GATEWAY_URL=https://ng-api-grpc.coralogix.com

# HTTP Service Gateway endpoint
# Default: https://ng-api-http.coralogix.com
CX_HTTP_GATEWAY_URL=https://ng-api-http.coralogix.com

# Base API URL
# Default: https://api.coralogix.com
CX_BASE_URL=https://api.coralogix.com

# ============================================================================
# OPTIONAL: Query Configuration
# ============================================================================

# Node environment (development, staging, production)
NODE_ENV=development
```

### Endpoint URLs by Region

Copy the appropriate section into your `.env` file:

**US1 / EU1 (Default - Ireland):**
```bash
CX_BASE_URL=https://api.coralogix.com
CX_GRPC_GATEWAY_URL=https://ng-api-grpc.coralogix.com
CX_HTTP_GATEWAY_URL=https://ng-api-http.coralogix.com
```

**EU2 (Stockholm):**
```bash
CX_BASE_URL=https://api.eu2.coralogix.com
CX_GRPC_GATEWAY_URL=https://ng-api-grpc.eu2.coralogix.com
CX_HTTP_GATEWAY_URL=https://ng-api-http.eu2.coralogix.com
```

**AP1 (India):**
```bash
CX_BASE_URL=https://api.app.coralogix.in
CX_GRPC_GATEWAY_URL=https://ng-api-grpc.app.coralogix.in
CX_HTTP_GATEWAY_URL=https://ng-api-http.app.coralogix.in
```

**AP2 (Singapore):**
```bash
CX_BASE_URL=https://api.coralogixsg.com
CX_GRPC_GATEWAY_URL=https://ng-api-grpc.coralogixsg.com
CX_HTTP_GATEWAY_URL=https://ng-api-http.coralogixsg.com
```

### Tier Selection

Coralogix uses tiered storage for cost optimization:

| Tier | Use Case | Retention | Cost | Query Speed |
|------|----------|-----------|------|-------------|
| **TIER_FREQUENT_SEARCH** | Last 24 hours | 24 hours | Higher | Fastest |
| **TIER_ARCHIVE** | Historical data | > 24 hours | Lower | Fast enough |

**Automatic tier selection** is built into the adapter:

```javascript
// In js/coralogix/config.js
getTierForTimeRange(hours) {
  return hours <= 24 ? TIER_FREQUENT_SEARCH : TIER_ARCHIVE;
}
```

**Manual tier override:**

```javascript
import { executeDataPrimeQuery, TIER_ARCHIVE } from './js/coralogix/api.js';

const results = await executeDataPrimeQuery(query, {
  tier: TIER_ARCHIVE,  // Force archive tier
  startDate: '2026-02-01T00:00:00Z',
  endDate: '2026-02-16T23:59:59Z',
});
```

---

## Query Translation Guide

### SQL → Data Prime Mapping

#### Field Path Mapping

Data Prime uses namespaced field paths:

| Namespace | Purpose | Example Fields |
|-----------|---------|----------------|
| **`$m`** | Metadata | `$m.timestamp` |
| **`$l`** | Labels | `$l.subsystemname`, `$l.response.status` |
| **`$d`** | Data | `$d.request.host`, `$d.cdn.cache_status` |

**Conversion rules:**

| ClickHouse Column | Data Prime Path | Namespace |
|-------------------|-----------------|-----------|
| `` `timestamp` `` | `$m.timestamp` | Metadata |
| `` `source` `` | `$l.subsystemname` | Label ('cloudflare'/'fastly') |
| `` `request.host` `` | `$d.request.host` | Data |
| `` `response.status` `` | `$l.response.status` | Label (indexed) |
| `` `cdn.cache_status` `` | `$d.cdn.cache_status` | Data |
| `` `client.ip` `` | `$d.client.ip` | Data |

**Helper function:**

```javascript
import { getFieldPath } from './js/coralogix/filter-translator.js';

getFieldPath('`request.host`');     // => '$d.request.host'
getFieldPath('`timestamp`');        // => '$m.timestamp'
getFieldPath('`source`');           // => '$l.subsystemname'
```

#### Syntax Comparison

| Feature | ClickHouse SQL | Data Prime |
|---------|----------------|------------|
| **Data source** | `FROM cdn_requests_v2` | `source logs` |
| **Filter** | `WHERE condition` | `\| filter condition` |
| **Grouping** | `GROUP BY dim` | `\| groupby expr as dim` |
| **Aggregation** | `count()`, `countIf()` | `count()`, `countif()` |
| **Conditional count** | `countIf(status >= 400)` | `countif(status >= 400)` |
| **Sorting** | `ORDER BY cnt DESC` | `\| orderby cnt desc` |
| **Limiting** | `LIMIT 10` | `\| limit 10` |
| **String ops** | `concat()`, `toString()` | `strcat()`, `tostring()` |
| **Case conversion** | `upper()` | `toupper()` |
| **Regex replace** | `REGEXP_REPLACE()` | `replace_regex()` |
| **Logical AND** | `AND` | `&&` |
| **Logical OR** | `OR` | `\|\|` |
| **Ternary** | `if(cond, a, b)` | `cond ? a : b` |

### Common Patterns

#### 1. Simple Filter

**ClickHouse:**
```sql
SELECT count()
FROM cdn_requests_v2
WHERE `request.host` = 'example.com'
  AND `response.status` >= 400
```

**Data Prime:**
```
source logs
| filter $d.request.host == 'example.com' && $l.response.status >= 400
| groupby 1 aggregate count() as cnt
```

#### 2. Time-Based Query

**ClickHouse:**
```sql
SELECT count()
FROM cdn_requests_v2
WHERE timestamp >= now() - INTERVAL 1 HOUR
  AND timestamp <= now()
```

**Data Prime:**
```
source logs
| filter $m.timestamp >= now() - 1h && $m.timestamp <= now()
| groupby 1 aggregate count() as cnt
```

#### 3. Group By with Aggregations

**ClickHouse:**
```sql
SELECT
  `request.host` as dim,
  count() as cnt,
  countIf(`response.status` < 400) as cnt_ok,
  countIf(`response.status` >= 500) as cnt_5xx
FROM cdn_requests_v2
WHERE timestamp >= now() - INTERVAL 24 HOUR
GROUP BY dim
ORDER BY cnt DESC
LIMIT 10
```

**Data Prime:**
```
source logs
| filter $m.timestamp >= now() - 24h
| groupby $d.request.host as dim aggregate
    count() as cnt,
    countif($l.response.status < 400) as cnt_ok,
    countif($l.response.status >= 500) as cnt_5xx
| orderby cnt desc
| limit 10
```

#### 4. Time Series (Bucketing)

**ClickHouse:**
```sql
SELECT
  toStartOfMinute(timestamp) as t,
  count() as cnt
FROM cdn_requests_v2
WHERE timestamp >= now() - INTERVAL 1 HOUR
GROUP BY t
ORDER BY t ASC
```

**Data Prime:**
```
source logs
| filter $m.timestamp >= now() - 1h
| timeslice 1m by $m.timestamp as t
| groupby t aggregate count() as cnt
| orderby t asc
```

### Translation Examples by Facet

#### Status Range

**ClickHouse:**
```sql
SELECT
  concat(toString(intDiv(`response.status`, 100)), 'xx') as dim,
  count() as cnt
FROM cdn_requests_v2
GROUP BY dim
```

**Data Prime:**
```
source logs
| groupby strcat(tostring(todecimal($l.response.status / 100)), 'xx') as dim
  aggregate count() as cnt
```

#### Cache Status

**ClickHouse:**
```sql
SELECT
  upper(`cdn.cache_status`) as dim,
  count() as cnt
FROM cdn_requests_v2
GROUP BY dim
```

**Data Prime:**
```
source logs
| groupby toupper($d.cdn.cache_status) as dim aggregate count() as cnt
```

#### Client IP (with Fallback)

**ClickHouse:**
```sql
SELECT
  if(`request.headers.x_forwarded_for` != '',
     `request.headers.x_forwarded_for`,
     `client.ip`) as dim,
  count() as cnt
FROM cdn_requests_v2
GROUP BY dim
```

**Data Prime:**
```
source logs
| groupby $d.request.headers.x_forwarded_for != ""
    ? $d.request.headers.x_forwarded_for
    : $d.client.ip as dim
  aggregate count() as cnt
```

#### Grouped Errors

**ClickHouse:**
```sql
SELECT
  REGEXP_REPLACE(`response.headers.x_error`, '/[a-zA-Z0-9/_.-]+', '/...') as dim,
  count() as cnt
FROM cdn_requests_v2
WHERE `response.headers.x_error` != ''
GROUP BY dim
```

**Data Prime:**
```
source logs
| filter $d.response.headers.x_error != ""
| groupby replace_regex($d.response.headers.x_error, '/[a-zA-Z0-9/_.-]+', '/...') as dim
  aggregate count() as cnt
```

### Filter Translation API

The `filter-translator.js` module automatically converts klickhaus filters to Data Prime:

```javascript
import {
  translateFilter,
  buildFilterClause,
  translateHostFilter,
} from './js/coralogix/filter-translator.js';

// Single filter
const filter = {
  col: '`request.host`',
  value: 'example.com',
  exclude: false,
};
translateFilter(filter);
// => "$d.request.host == 'example.com'"

// Multiple filters
const filters = [
  { col: '`request.host`', value: 'example.com', exclude: false },
  { col: '`response.status`', value: 200, exclude: false },
];
buildFilterClause(filters);
// => "| filter ($d.request.host == 'example.com') && ($l.response.status == 200)"

// Host filter shorthand
translateHostFilter('example.com');
// => "$d.request.host == 'example.com'"
```

---

## API Reference

### Authentication

#### Set Credentials

```javascript
import { setAuthCredentials } from './js/coralogix/auth.js';

// After login, store token and team ID
setAuthCredentials('your-bearer-token', 12345);
```

#### Get Credentials

```javascript
import { getToken, getTeamId } from './js/coralogix/auth.js';

const token = getToken();
const teamId = getTeamId();
```

#### Clear Credentials

```javascript
import { clearAuthCredentials } from './js/coralogix/auth.js';

// On logout
clearAuthCredentials();
```

### Query Execution

#### Execute Data Prime Query

```javascript
import { executeDataPrimeQuery, TIER_ARCHIVE } from './js/coralogix/api.js';

const query = `
source logs
| filter $d.request.host == 'example.com'
| groupby $l.response.status as status aggregate count() as cnt
| limit 100
`;

const results = await executeDataPrimeQuery(query, {
  tier: TIER_ARCHIVE,
  startDate: '2026-02-01T00:00:00Z',
  endDate: '2026-02-16T23:59:59Z',
  limit: 100,
  signal: abortController.signal,  // Optional: for cancellation
});

console.log('Results:', results);
// Array of { userData: { ... }, labels: { ... } }
```

#### Fetch Time Series Data

```javascript
import { fetchTimeSeriesData } from './js/coralogix/adapter.js';

const timeSeriesData = await fetchTimeSeriesData({
  timeRange: '24h',
  interval: 'toStartOfMinute(timestamp)',
  filters: [
    { col: '`request.host`', value: 'example.com', exclude: false },
  ],
  hostFilter: 'example.com',
  signal: abortController.signal,
});

console.log('Time series:', timeSeriesData);
// [{ t: '2026-02-16T12:00:00', cnt_ok: 100, cnt_4xx: 5, cnt_5xx: 2 }, ...]
```

#### Fetch Breakdown Data

```javascript
import { fetchBreakdownData } from './js/coralogix/adapter.js';

const breakdownData = await fetchBreakdownData({
  facet: '`request.host`',
  topN: 10,
  timeRange: '24h',
  filters: [
    { col: '`response.status`', value: 200, exclude: false },
  ],
  hostFilter: '',
  extraFilter: '',
  orderBy: 'cnt DESC',
  signal: abortController.signal,
});

console.log('Breakdown:', breakdownData);
// {
//   data: [
//     { dim: 'example.com', cnt: 1000, cnt_ok: 950, cnt_4xx: 30, cnt_5xx: 20 },
//     ...
//   ],
//   totals: { cnt: 5000, cnt_ok: 4800, cnt_4xx: 150, cnt_5xx: 50 }
// }
```

#### Fetch Logs Data

```javascript
import { fetchLogsData } from './js/coralogix/adapter.js';

const logsData = await fetchLogsData({
  timeRange: '1h',
  filters: [
    { col: '`response.status`', value: 500, exclude: false },
  ],
  hostFilter: 'example.com',
  limit: 100,
  offset: 0,
  signal: abortController.signal,
});

console.log('Logs:', logsData);
// [
//   { 'timestamp': '2026-02-16T12:00:00', 'request.host': 'example.com', ... },
//   ...
// ]
```

### Response Parsing

#### Parse NDJSON Response

```javascript
import { parseNDJSONResponse } from './js/coralogix/api.js';

const ndjsonText = `
{"result":{"results":[{"userData":"{\"host\":\"example.com\",\"cnt\":100}"}]}}
{"result":{"results":[{"userData":"{\"host\":\"test.com\",\"cnt\":50}"}]}}
`;

const results = parseNDJSONResponse(ndjsonText);
console.log('Parsed:', results);
// [
//   { userData: { host: 'example.com', cnt: 100 }, labels: {} },
//   { userData: { host: 'test.com', cnt: 50 }, labels: {} }
// ]
```

### Error Handling

#### Query Error Class

```javascript
import { CoralogixQueryError, getQueryErrorDetails } from './js/coralogix/api.js';

try {
  const results = await executeDataPrimeQuery(invalidQuery);
} catch (err) {
  if (err.name === 'CoralogixQueryError') {
    const details = getQueryErrorDetails(err);
    console.error('Query failed:', {
      category: details.category,  // 'auth', 'syntax', 'timeout', etc.
      message: details.message,
      label: details.label,         // Human-readable category
      status: details.status,       // HTTP status code
    });
  }
}
```

#### Error Categories

| Category | Description | Example |
|----------|-------------|---------|
| `auth` | Authentication failure | Invalid API key, expired token |
| `syntax` | Query syntax error | Malformed Data Prime query |
| `timeout` | Query timeout | Long-running query exceeded limit |
| `resource` | Resource limits | Rate limit exceeded |
| `network` | Network error | Connection failed |
| `cancelled` | User cancelled | AbortController triggered |
| `unknown` | Other error | Unexpected failure |

### Request Cancellation

```javascript
import { executeDataPrimeQuery } from './js/coralogix/api.js';

const controller = new AbortController();

// Start query
const queryPromise = executeDataPrimeQuery(query, {
  signal: controller.signal,
});

// Cancel after 5 seconds
setTimeout(() => {
  controller.abort();
}, 5000);

try {
  const results = await queryPromise;
} catch (err) {
  if (err.name === 'AbortError') {
    console.log('Query cancelled');
  }
}
```

---

## Testing

### Running Tests

Execute the full test suite:

```bash
npm test
```

Run specific test files:

```bash
# API tests
npm test js/coralogix/api.test.js

# Auth tests
npm test js/coralogix/auth.test.js

# Filter translator tests
npm test js/coralogix/filter-translator.test.js

# Query builder tests
npm test js/coralogix/query-builder.test.js

# NDJSON parser tests
npm test js/coralogix/ndjson-parser.test.js

# Interceptor tests
npm test js/coralogix/interceptor.test.js
```

### Manual Testing

#### 1. Test Authentication

```bash
node -e "
import('./js/coralogix/config.js').then(({ CORALOGIX_CONFIG }) => {
  const validation = CORALOGIX_CONFIG.validate();
  console.log('Validation:', validation);
});
"
```

Expected output:
```json
{
  "isValid": true,
  "missing": [],
  "message": "Configuration is valid"
}
```

#### 2. Test Data Prime Query

Create `test-query.mjs`:

```javascript
import { setAuthCredentials } from './js/coralogix/auth.js';
import { executeDataPrimeQuery, TIER_ARCHIVE } from './js/coralogix/api.js';
import { CORALOGIX_CONFIG } from './js/coralogix/config.js';

// Load credentials from .env
const teamId = parseInt(CORALOGIX_CONFIG.teamId, 10);
const apiKey = CORALOGIX_CONFIG.apiKey;

setAuthCredentials(apiKey, teamId);

const query = `
source logs
| filter $l.subsystemname in ['cloudflare', 'fastly']
| groupby $d.request.host as dim aggregate count() as cnt
| orderby cnt desc
| limit 10
`;

try {
  const results = await executeDataPrimeQuery(query, {
    tier: TIER_ARCHIVE,
  });

  console.log('Query results:', JSON.stringify(results, null, 2));
} catch (err) {
  console.error('Query failed:', err.message);
  console.error('Details:', err);
}
```

Run:
```bash
node test-query.mjs
```

#### 3. Test Filter Translation

```bash
node -e "
import('./js/coralogix/filter-translator.js').then(({ translateFilter, buildFilterClause }) => {
  const filter = { col: '\`request.host\`', value: 'example.com', exclude: false };
  console.log('Single filter:', translateFilter(filter));

  const filters = [
    { col: '\`request.host\`', value: 'example.com', exclude: false },
    { col: '\`response.status\`', value: 200, exclude: false }
  ];
  console.log('Multiple filters:', buildFilterClause(filters));
});
"
```

Expected output:
```
Single filter: $d.request.host == 'example.com'
Multiple filters: | filter ($d.request.host == 'example.com') && ($l.response.status == 200)
```

### Performance Testing

Create `benchmark.mjs`:

```javascript
import { setAuthCredentials } from './js/coralogix/auth.js';
import { fetchTimeSeriesData, fetchBreakdownData } from './js/coralogix/adapter.js';
import { CORALOGIX_CONFIG } from './js/coralogix/config.js';

setAuthCredentials(CORALOGIX_CONFIG.apiKey, parseInt(CORALOGIX_CONFIG.teamId, 10));

async function benchmark() {
  console.log('Starting performance benchmarks...\n');

  // Time series query
  const tsStart = performance.now();
  const tsData = await fetchTimeSeriesData({
    timeRange: '1h',
    interval: 'toStartOfMinute(timestamp)',
    filters: [],
    hostFilter: '',
  });
  const tsEnd = performance.now();
  console.log(`Time Series Query: ${(tsEnd - tsStart).toFixed(2)}ms (${tsData.length} data points)`);

  // Breakdown query
  const bdStart = performance.now();
  const bdData = await fetchBreakdownData({
    facet: '`request.host`',
    topN: 10,
    timeRange: '1h',
    filters: [],
    hostFilter: '',
  });
  const bdEnd = performance.now();
  console.log(`Breakdown Query: ${(bdEnd - bdStart).toFixed(2)}ms (${bdData.data.length} results)`);

  // Multiple concurrent queries
  const concurrentStart = performance.now();
  await Promise.all([
    fetchBreakdownData({ facet: '`response.status`', topN: 10, timeRange: '1h', filters: [], hostFilter: '' }),
    fetchBreakdownData({ facet: '`cdn.cache_status`', topN: 10, timeRange: '1h', filters: [], hostFilter: '' }),
    fetchBreakdownData({ facet: '`request.method`', topN: 10, timeRange: '1h', filters: [], hostFilter: '' }),
  ]);
  const concurrentEnd = performance.now();
  console.log(`3 Concurrent Queries: ${(concurrentEnd - concurrentStart).toFixed(2)}ms`);
}

benchmark().catch(console.error);
```

Run:
```bash
node benchmark.mjs
```

---

## Deployment

### Build Steps

1. **Install dependencies:**
   ```bash
   npm ci --production
   ```

2. **Validate configuration:**
   ```bash
   npm run validate-config
   ```

3. **Run linting:**
   ```bash
   npm run lint
   ```

4. **Run tests:**
   ```bash
   npm test
   ```

5. **Build static assets** (if applicable):
   ```bash
   npm run build
   ```

### Environment Configuration

#### Development

```bash
# .env.development
NODE_ENV=development
CX_TEAM_ID=12345
CX_API_KEY=dev-api-key
CX_BASE_URL=https://api.coralogix.com
```

#### Staging

```bash
# .env.staging
NODE_ENV=staging
CX_TEAM_ID=12345
CX_API_KEY=staging-api-key
CX_BASE_URL=https://api.coralogix.com
```

#### Production

```bash
# .env.production
NODE_ENV=production
CX_TEAM_ID=12345
CX_API_KEY=prod-api-key
CX_BASE_URL=https://api.coralogix.com
```

**Important:** Never commit `.env` files! Use secrets management:

- **AWS**: Secrets Manager, Parameter Store
- **Azure**: Key Vault
- **GCP**: Secret Manager
- **GitHub**: Repository secrets

### Docker Deployment

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production

# Copy application code
COPY . .

# Set environment
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Start application
CMD ["npm", "start"]
```

Build and run:

```bash
# Build
docker build -t klickhaus:latest .

# Run with secrets
docker run -d \
  -e CX_TEAM_ID=12345 \
  -e CX_API_KEY=your-api-key \
  -p 3000:3000 \
  klickhaus:latest
```

### Kubernetes Deployment

Create `k8s/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: klickhaus
  labels:
    app: klickhaus
spec:
  replicas: 3
  selector:
    matchLabels:
      app: klickhaus
  template:
    metadata:
      labels:
        app: klickhaus
    spec:
      containers:
      - name: klickhaus
        image: klickhaus:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: CX_TEAM_ID
          valueFrom:
            secretKeyRef:
              name: coralogix-credentials
              key: team-id
        - name: CX_API_KEY
          valueFrom:
            secretKeyRef:
              name: coralogix-credentials
              key: api-key
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: klickhaus
spec:
  selector:
    app: klickhaus
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3000
  type: LoadBalancer
```

Create secrets:

```bash
kubectl create secret generic coralogix-credentials \
  --from-literal=team-id=12345 \
  --from-literal=api-key=your-api-key
```

Deploy:

```bash
kubectl apply -f k8s/deployment.yaml
```

### Monitoring Setup

Add health check endpoint to `server.js`:

```javascript
import { CORALOGIX_CONFIG } from './js/coralogix/config.js';

app.get('/health', (req, res) => {
  const validation = CORALOGIX_CONFIG.validate();

  if (!validation.isValid) {
    return res.status(503).json({
      status: 'unhealthy',
      message: validation.message,
      missing: validation.missing,
    });
  }

  res.json({ status: 'healthy' });
});

app.get('/ready', (req, res) => {
  // Check if can connect to Coralogix
  res.json({ status: 'ready' });
});
```

---

## Troubleshooting

### Common Errors

#### 1. Authentication Failed (401)

**Error:**
```
CoralogixQueryError: Unauthorized
Status: 401
Category: auth
```

**Causes:**
- Invalid API key
- Expired API key
- Missing `CX_API_KEY` in `.env`

**Solution:**

1. Verify API key in Coralogix:
   - Settings → Account → API Keys
   - Check key is active and has correct scopes

2. Regenerate API key if needed:
   - Delete old key
   - Create new key with required scopes:
     - DataPrime Query
     - Logs Query

3. Update `.env`:
   ```bash
   CX_API_KEY=new-api-key-here
   ```

4. Restart application:
   ```bash
   npm start
   ```

#### 2. Team Not Found (403)

**Error:**
```
CoralogixQueryError: Forbidden - Team not found
Status: 403
Category: auth
```

**Causes:**
- Incorrect `CX_TEAM_ID`
- API key doesn't have access to team

**Solution:**

1. Verify Team ID:
   - Settings → Account → General Information
   - Copy exact numeric Team ID

2. Update `.env`:
   ```bash
   CX_TEAM_ID=12345
   ```

3. Verify API key has team access:
   - Check API key was created under correct team

#### 3. Query Syntax Error

**Error:**
```
CoralogixQueryError: Parse error at line 2, column 10
Status: 400
Category: syntax
```

**Causes:**
- Invalid Data Prime syntax
- Incorrect field paths
- Missing operators

**Solution:**

1. Check query syntax:
   ```javascript
   // BAD: SQL-style
   const badQuery = `
   SELECT count()
   FROM logs
   WHERE status = 200
   `;

   // GOOD: Data Prime
   const goodQuery = `
   source logs
   | filter $l.response.status == 200
   | groupby 1 aggregate count() as cnt
   `;
   ```

2. Verify field paths:
   ```javascript
   // BAD: ClickHouse columns
   `response.status`

   // GOOD: Data Prime paths
   $l.response.status
   ```

3. Use filter translator:
   ```javascript
   import { getFieldPath } from './js/coralogix/filter-translator.js';

   const field = getFieldPath('`response.status`');
   console.log(field);  // => '$l.response.status'
   ```

#### 4. Query Timeout

**Error:**
```
CoralogixQueryError: Query timeout exceeded
Status: 408
Category: timeout
```

**Causes:**
- Query too broad (no time filter)
- High cardinality aggregation
- Archive tier query on large dataset

**Solution:**

1. Add time filter:
   ```javascript
   // BAD: No time filter
   source logs
   | groupby $d.request.host as dim aggregate count() as cnt

   // GOOD: Limited time range
   source logs
   | filter $m.timestamp >= now() - 1h
   | groupby $d.request.host as dim aggregate count() as cnt
   ```

2. Use appropriate tier:
   ```javascript
   // For last 24 hours, use FREQUENT_SEARCH
   const results = await executeDataPrimeQuery(query, {
     tier: TIER_FREQUENT_SEARCH,
   });
   ```

3. Limit results:
   ```javascript
   source logs
   | filter $m.timestamp >= now() - 1h
   | groupby $d.request.host as dim aggregate count() as cnt
   | orderby cnt desc
   | limit 100  // Add limit
   ```

#### 5. Network Error

**Error:**
```
CoralogixQueryError: Failed to fetch
Category: network
```

**Causes:**
- Network connectivity issues
- Incorrect API endpoint URL
- Firewall blocking requests
- DNS resolution failure

**Solution:**

1. Test connectivity:
   ```bash
   curl -I https://api.coralogix.com
   ```

2. Verify endpoint URL:
   ```bash
   # Check .env
   cat .env | grep CX_BASE_URL

   # Should match your region
   CX_BASE_URL=https://api.coralogix.com
   ```

3. Check firewall rules:
   - Allow HTTPS (443) to Coralogix endpoints
   - Whitelist domains:
     - `*.coralogix.com`
     - `*.eu2.coralogix.com`
     - `*.app.coralogix.in`
     - `*.coralogixsg.com`

4. Test with curl:
   ```bash
   curl -X POST https://api.coralogix.com/api/v1/dataprime/query \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $CX_API_KEY" \
     -H "CGX-Team-Id: $CX_TEAM_ID" \
     -d '{"query":"source logs | limit 1","metadata":{"tier":"TIER_ARCHIVE"}}'
   ```

#### 6. Rate Limit Exceeded (429)

**Error:**
```
CoralogixQueryError: Too many requests
Status: 429
Category: resource
```

**Causes:**
- Too many concurrent queries
- Query frequency exceeds limits
- API key rate limit

**Solution:**

1. Reduce concurrent queries:
   ```javascript
   // BAD: 20+ concurrent queries
   const promises = breakdowns.map(b => fetchBreakdownData(b));
   const results = await Promise.all(promises);

   // GOOD: Limit concurrency
   import { ConcurrencyLimiter } from './js/concurrency-limiter.js';
   const limiter = new ConcurrencyLimiter(4);  // Max 4 concurrent

   const results = await Promise.all(
     breakdowns.map(b => limiter.run(() => fetchBreakdownData(b)))
   );
   ```

2. Add retry logic (built-in):
   ```javascript
   // Adapter automatically retries on 429
   const results = await executeDataPrimeQuery(query, {
     maxRetries: 3,       // Retry up to 3 times
     retryDelay: 1000,    // 1 second base delay
   });
   ```

3. Increase delay between requests:
   ```javascript
   async function delayedQuery(query, delayMs) {
     await new Promise(resolve => setTimeout(resolve, delayMs));
     return await executeDataPrimeQuery(query);
   }
   ```

### Performance Problems

#### Slow Queries

**Symptoms:**
- Queries take > 5 seconds
- Dashboard loads slowly
- High TTFB (Time To First Byte)

**Diagnosis:**

1. Check query tier:
   ```javascript
   // Log query tier being used
   console.log('Query tier:', tier);
   ```

2. Measure query time:
   ```javascript
   const start = performance.now();
   const results = await executeDataPrimeQuery(query);
   const end = performance.now();
   console.log(`Query took ${(end - start).toFixed(2)}ms`);
   ```

3. Check time range:
   ```javascript
   // Large time ranges = slow queries
   const timeRangeDef = TIME_RANGES[timeRange];
   const hoursInRange = timeRangeDef.periodMs / (60 * 60 * 1000);
   console.log(`Query range: ${hoursInRange} hours`);
   ```

**Solutions:**

1. Use FREQUENT_SEARCH tier for recent data:
   ```javascript
   const tier = hours <= 24 ? TIER_FREQUENT_SEARCH : TIER_ARCHIVE;
   ```

2. Reduce time range:
   ```javascript
   // Instead of 7d, use 24h
   const results = await fetchTimeSeriesData({
     timeRange: '24h',  // Instead of '7d'
     // ...
   });
   ```

3. Add sampling (not yet implemented):
   ```javascript
   // TODO: Implement sampling for large datasets
   ```

#### High Memory Usage

**Symptoms:**
- Node.js process uses > 1GB memory
- Out of memory errors
- Slow garbage collection

**Diagnosis:**

```bash
# Check Node.js memory usage
node --expose-gc --trace-gc app.js
```

**Solutions:**

1. Limit result set size:
   ```javascript
   source logs
   | filter $m.timestamp >= now() - 1h
   | limit 1000  // Limit to 1000 rows
   ```

2. Stream large results (future enhancement):
   ```javascript
   // TODO: Implement streaming NDJSON parser
   ```

3. Increase Node.js memory limit:
   ```bash
   node --max-old-space-size=4096 app.js
   ```

### Authentication Issues

#### Token Refresh Not Working

**Symptoms:**
- 401 errors after initial login
- Interceptor not refreshing token

**Diagnosis:**

```javascript
import { getToken, getRefreshToken } from './js/coralogix/auth.js';

console.log('Access token:', getToken());
console.log('Refresh token:', getRefreshToken());
```

**Solutions:**

1. Implement refresh token endpoint:
   ```javascript
   // In auth.js
   export async function refreshToken() {
     const refreshTokenValue = getRefreshToken();
     if (!refreshTokenValue) {
       throw new Error('No refresh token available');
     }

     const response = await fetch('/user/refresh', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ refresh_token: refreshTokenValue })
     });

     if (!response.ok) {
       throw new Error('Token refresh failed');
     }

     const data = await response.json();
     authState.token = data.token;

     if (data.refresh_token) {
       authState.refreshToken = data.refresh_token;
     }
   }
   ```

2. Store refresh token after login:
   ```javascript
   import { setAuthCredentials, setRefreshToken } from './js/coralogix/auth.js';

   async function login(username, password) {
     const response = await fetch('/user/login', {
       method: 'POST',
       body: JSON.stringify({ username, password })
     });

     const data = await response.json();

     setAuthCredentials(data.token, data.teamId);
     setRefreshToken(data.refresh_token);  // Store refresh token
   }
   ```

#### CORS Errors

**Error:**
```
Access to fetch at 'https://api.coralogix.com/...' from origin 'http://localhost:3000'
has been blocked by CORS policy
```

**Causes:**
- Missing CORS headers
- Preflight request failed
- Browser blocking cross-origin request

**Solution:**

This should not happen with Coralogix API. If it does:

1. Use server-side proxy (recommended for production):
   ```javascript
   // In server.js
   app.post('/api/query', async (req, res) => {
     const response = await fetch(CORALOGIX_CONFIG.dataprimeApiUrl, {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         'Authorization': `Bearer ${CORALOGIX_CONFIG.apiKey}`,
         'CGX-Team-Id': String(CORALOGIX_CONFIG.teamId),
       },
       body: JSON.stringify(req.body),
     });

     const data = await response.text();
     res.send(data);
   });
   ```

2. Or enable CORS on dev server:
   ```javascript
   // In dev server
   import cors from 'cors';
   app.use(cors());
   ```

### Configuration Errors

#### Missing Environment Variables

**Error:**
```
Missing required environment variables: CX_TEAM_ID, CX_API_KEY
```

**Solution:**

1. Create `.env` file:
   ```bash
   cp .env.example .env
   ```

2. Add credentials:
   ```bash
   CX_TEAM_ID=12345
   CX_API_KEY=your-api-key
   ```

3. Restart application:
   ```bash
   npm start
   ```

#### Wrong Region Configuration

**Symptoms:**
- 404 errors
- "Team not found" errors
- DNS resolution failures

**Solution:**

1. Identify your Coralogix region from UI URL:
   - `https://coralogix.com` → US1/EU1
   - `https://eu2.coralogix.com` → EU2
   - `https://app.coralogix.in` → AP1
   - `https://coralogixsg.com` → AP2

2. Update `.env` with correct regional endpoints:
   ```bash
   # For EU2 (Stockholm)
   CX_BASE_URL=https://api.eu2.coralogix.com
   CX_GRPC_GATEWAY_URL=https://ng-api-grpc.eu2.coralogix.com
   CX_HTTP_GATEWAY_URL=https://ng-api-http.eu2.coralogix.com
   ```

3. Restart application.

---

## Additional Resources

### Documentation

- [Coralogix Data Prime Language Reference](https://coralogix.com/docs/dataprime-query-language/)
- [Coralogix API Documentation](https://coralogix.com/docs/api/)
- [Data Prime Migration Guide](/Users/yoni/klickhaus/js/queries/DATAPRIME_MIGRATION.md)
- [Coralogix Integration Guide](/Users/yoni/klickhaus/js/coralogix/INTEGRATION.md)
- [Filter Translator README](/Users/yoni/klickhaus/js/coralogix/README.md)

### Code Examples

- Filter translator: `/Users/yoni/klickhaus/js/coralogix/filter-translator.example.js`
- Query builder tests: `/Users/yoni/klickhaus/js/coralogix/query-builder.test.js`
- API tests: `/Users/yoni/klickhaus/js/coralogix/api.test.js`

### Support

- Coralogix Support: support@coralogix.com
- Coralogix Community: community.coralogix.com
- klickhaus GitHub Issues: github.com/adobe/klickhaus/issues

---

## Migration Checklist

### Pre-Migration

- [ ] Coralogix account created
- [ ] Team ID identified
- [ ] API key generated with correct scopes (DataPrime Query, Logs Query)
- [ ] Regional endpoints identified
- [ ] `.env` file created and configured
- [ ] Dependencies installed (`npm install`)
- [ ] Configuration validated (`npm run validate-config`)
- [ ] Tests passing (`npm test`)

### Migration Steps

- [ ] Update authentication to use Coralogix credentials
- [ ] Replace ClickHouse query calls with Coralogix adapter functions
- [ ] Update time series queries to use `fetchTimeSeriesData()`
- [ ] Update breakdown queries to use `fetchBreakdownData()`
- [ ] Update logs queries to use `fetchLogsData()`
- [ ] Test all dashboard views
- [ ] Verify filters work correctly
- [ ] Test time range selection
- [ ] Verify chart rendering
- [ ] Test pagination in logs view

### Post-Migration

- [ ] Monitor query performance
- [ ] Check error logs
- [ ] Verify data accuracy
- [ ] Update documentation
- [ ] Train team on new system
- [ ] Set up monitoring and alerts
- [ ] Plan for ClickHouse deprecation

---

**End of Coralogix Migration Guide**

*Last updated: 2026-02-16*
