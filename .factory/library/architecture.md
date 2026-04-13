# Architecture

## System Overview

The clickhouse-queries dashboard is a multi-page vanilla JavaScript application (no build step, no framework) that visualizes analytics data through:
- A custom Canvas-based stacked area time series chart
- Faceted breakdown cards with horizontal stacked bars
- URL-driven state for shareable views

## Data Source Abstraction

The system supports two data source types:

### ClickHouse Data Source (existing)
- SQL templates in `sql/queries/` with `{{param}}` interpolation
- Direct HTTP POST to ClickHouse with Basic Auth
- Used by: delivery, lambda, backend, admin dashboards
- Flow: `loadSql(template, params) → api.query(sql) → {data, totals}`

### Bundles Data Source (new — RUM pages)
- REST API at `bundles.aem.page` with domainkey auth
- Client-side processing via `@adobe/rum-distiller` (DataChunks)
- Loaded via import map from `esm.sh` CDN
- Flow: `fetch(bundlesURL) → addCalculatedProps → DataChunks.load → group/aggregate → transform to chart/breakdown format`

## Dashboard Initialization

`dashboard-init.js` orchestrates the full dashboard lifecycle:
1. `init()` → load state from URL → apply config → setup chart navigation → `loadDashboard()`
2. `loadDashboard()` → create request context → load time series + all breakdowns in parallel
3. Chart: `loadTimeSeries()` → data source fetch → `renderChart(data)`
4. Breakdowns: `loadAllBreakdowns()` → per-facet data source fetch → `renderBreakdownTable()`

The data loading functions must be pluggable to support both ClickHouse (SQL) and bundles (REST API) sources.

## Rendering Components (data-source-agnostic)

### Chart (`js/chart.js`)
- Custom Canvas rendering — no charting library
- Expects: `[{t, cnt_ok, cnt_4xx, cnt_5xx}]` — three numeric series
- Colors from CSS variables: `--status-ok` (green), `--status-client-error` (yellow), `--status-server-error` (red)
- Series labels: configurable via state (default "2xx/4xx/5xx", RUM uses "good/needs improvement/poor")
- Features: scrubber on hover, drag-select time range, anomaly detection, release markers

### Breakdowns (`js/breakdowns/`)
- Expects: `[{dim, cnt, cnt_ok, cnt_4xx, cnt_5xx}]` per facet
- Renders stacked horizontal bars with same 3-color scheme
- Facet definitions are data-driven objects with: id, col, facetName, filterCol, linkFn, etc.

## State Management

- Single mutable `state` object in `js/state.js`
- URL serialization via `js/url-state.js` (time range, filters, host, topN)
- Filters stored as `{col, value, exclude}` array
- For ClickHouse: filters compiled to SQL WHERE via `js/filter-sql.js`
- For Bundles: filters applied via DataChunks facet filtering

## Authentication

- ClickHouse dashboards: username/password → Basic Auth header → stored in localStorage
- RUM dashboards: domain + domainkey → URL parameter to bundles.aem.page → stored in localStorage
- Both share the login form UI with different field labels
- URL params (`?domain=...&domainkey=...`) bypass the login form

## RUM Data Processing Pipeline

1. **Fetch**: Multiple API calls per time range (hourly/daily/monthly chunks)
2. **Preprocess**: `addCalculatedProps(bundle)` extracts CWV values, marks visits
3. **Load**: `DataChunks.load(bundles)` ingests all data
4. **Series**: Define classification series per view:
   - Traffic: good=engaged visit, meh=non-visit, bad=bouncing visit
   - LCP/CLS/INP: good/ni/poor per CWV thresholds
5. **Facets**: Add facets via `DataChunks.addFacet()` (userAgent, url, checkpoint, etc.)
6. **Filter**: Apply user filters via DataChunks facet filtering
7. **Group**: Group by time bucket via `DataChunks.group(truncateFn)`
8. **Transform**: Convert grouped aggregates to chart/breakdown data format

## CWV Thresholds (from @adobe/rum-distiller)

| Metric | Good | Needs Improvement | Poor |
|--------|------|-------------------|------|
| LCP | <2500ms | 2500-4000ms | >=4000ms |
| CLS | <0.1 | 0.1-0.25 | >=0.25 |
| INP | <200ms | 200-500ms | >=500ms |

## File Organization

```
js/
├── dashboard-init.js    # Shared dashboard orchestration (refactored for pluggable data sources)
├── chart.js             # Canvas chart rendering (refactored for customizable labels)
├── chart-state.js       # Chart state management
├── state.js             # Global state
├── url-state.js         # URL serialization
├── auth.js              # Login/credential management
├── filters.js           # Filter UI
├── filter-sql.js        # Filter → SQL (ClickHouse only)
├── api.js               # ClickHouse HTTP query client
├── rum/                 # NEW: RUM-specific modules
│   ├── rum-adapter.js   # bundles.aem.page fetch + DataChunks processing
│   ├── rum-utils.js     # Shared utilities (truncate, interpolation)
│   └── ...
├── rum-traffic-main.js  # NEW: Traffic view entry point
├── rum-lcp-main.js      # NEW: LCP view entry point
├── rum-cls-main.js      # NEW: CLS view entry point
├── rum-inp-main.js      # NEW: INP view entry point
├── breakdowns/
│   ├── definitions.js        # CDN facet definitions
│   ├── definitions-lambda.js # Lambda facet definitions
│   ├── definitions-rum.js    # NEW: RUM facet definitions
│   ├── render.js             # Breakdown table rendering
│   └── index.js              # Breakdown orchestration
└── ...
```
