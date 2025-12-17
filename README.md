# Klickhaus - CDN Analytics Dashboard

A real-time analytics dashboard for CDN log analysis, built with ClickHouse and vanilla JavaScript.

![CDN Analytics Dashboard](screenshot.png)

## Features

- **Real-time request monitoring** - Stacked area chart showing requests over time, color-coded by status (2xx/3xx green, 4xx yellow, 5xx red)
- **Multi-dimensional breakdowns** - Analyze traffic by:
  - Status codes and ranges
  - Hosts and forwarded hosts
  - Content types
  - Cache status (HIT, MISS, etc.)
  - Paths and referers
  - User agents and IP addresses
  - Request types and backend types
  - HTTP methods and datacenters
  - ASN (Autonomous System Numbers)
- **Interactive filtering** - Click to filter or exclude any dimension value
- **Flexible time ranges** - Last hour, 12 hours, 24 hours, or 7 days
- **Dark mode support** - Automatic theme based on system preference
- **Query caching** - Intelligent cache TTLs based on time range

## Architecture

The dashboard queries a ClickHouse database containing unified CDN logs from Cloudflare and Fastly:

```
Cloudflare Logpush ──► cloudflare_http_requests (1-day TTL)
                              │
                    cloudflare_http_ingestion (MV)
                              │
                              ▼
                     cdn_requests_combined (2-week TTL)
                              ▲
                    fastly_ingestion (MV)
                              │
S3 ClickPipes ──────► fastly_logs_incoming2 (1-day TTL)
```

## Usage

1. Open `dashboard.html` in a browser (or visit [trieloff.github.io/klickhaus](https://trieloff.github.io/klickhaus/dashboard.html))
2. Log in with your ClickHouse credentials
3. Use the time range selector and host filter to narrow down results
4. Click on any breakdown value to filter, or use the "Exclude" button to exclude it

## User Management

Scripts in `scripts/` manage dashboard access (require admin credentials):

```bash
# Add a new read-only user
node scripts/add-user.mjs <admin-user> <admin-password> <new-username> [password]

# Rotate a user's password
node scripts/roll-user.mjs <admin-user> <admin-password> <username>

# Remove a user
node scripts/drop-user.mjs <admin-user> <admin-password> <username>
```

New users receive read-only access (`SELECT` on `cdn_requests_combined`).

## Local Development

```bash
npm install
npm start
```

This starts a development server with auto-reload at http://localhost:8000/dashboard.html.

For ClickHouse CLI access:

```bash
clickhouse client --host ogadftwx3q.us-east1.gcp.clickhouse.cloud \
  --user default --password '<password>' --secure
```

## Data Schema

The primary table `cdn_requests_combined` includes:

| Column Group | Examples |
|-------------|----------|
| Core | `timestamp`, `source`, `request.host` |
| CDN | `cdn.cache_status`, `cdn.datacenter`, `cdn.time_elapsed_msec` |
| Client | `client.ip`, `client.country_name`, `client.asn` |
| Request | `request.url`, `request.method`, `request.headers.*` |
| Response | `response.status`, `response.body_size`, `response.headers.*` |
| Helix | `helix.request_type`, `helix.backend_type` |

## License

MIT
