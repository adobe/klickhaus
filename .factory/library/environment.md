# Environment

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## External APIs

### bundles.aem.page (RUM data)
- Endpoint: `https://bundles.aem.page`
- Auth: `domainkey` query parameter
- Test credentials: domain=`www.aem.live`, domainkey=`53A02890-F91F-428B-A870-A809B82D953E`
- URL pattern: `/bundles/{domain}/{YYYY}/{MM}/{DD}?domainkey={key}` (daily)
- Also supports hourly (`/{HH}` suffix) and monthly (no day) granularity
- Response: `{ rumBundles: [...] }`

### ClickHouse (existing CDN dashboards)
- Host: `s2p5b8wmt5.eastus2.azure.clickhouse.cloud`
- Database: `helix_logs_production`
- Credentials: see `README.local.md` (use `david_query` for read-only testing)
- Auth: HTTP Basic Auth

## Dependencies

### @adobe/rum-distiller
- Version: 1.23.0
- Loaded via import map from CDN: `https://esm.sh/@adobe/rum-distiller@1.23.0`
- No npm install needed — browser loads it directly
- Key exports: `DataChunks`, `utils` (scoreCWV, scoreBundle, toHumanReadable), `series` (pageViews, visits, bounces, lcp, cls, inp, engagement), `facets` (userAgent, vitals, lcpSource, lcpTarget, checkpoint, url)

## Platform Notes

- No build step — vanilla ES modules served directly by live-server
- Import maps used in HTML for CDN dependencies
- Dev server port is deterministic: 5561 (based on cwd hash)
