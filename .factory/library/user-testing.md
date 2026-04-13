# User Testing

## Validation Surface

**Primary surface:** Browser UI (agent-browser)
- All 4 RUM pages: rum-traffic.html, rum-lcp.html, rum-cls.html, rum-inp.html
- Existing dashboards for regression: dashboard.html, lambda.html
- Dev server: http://localhost:5561/

**Secondary surface:** Shell commands
- `npm test` — unit tests
- `npm run lint` — ESLint
- `npm run dead-code` — knip
- `npm run cpd:ci` — copy-paste detection

**Test credentials:**
- RUM pages: `?domain=www.aem.live&domainkey=53A02890-F91F-428B-A870-A809B82D953E`
- ClickHouse dashboards: user=`david_query`, password in README.local.md

## Validation Concurrency

**agent-browser:** Max concurrent validators: **5**
- Each instance: ~300MB RAM
- Dev server: ~67MB RAM
- Machine: 24GB total, 8 CPUs, ~6GB baseline
- Headroom: 18GB * 0.7 = 12.6GB usable
- 5 instances = ~1.5GB + 67MB server = well within budget

**shell commands:** Max concurrent: **3**
- Test runner uses Playwright Chromium
- Each instance: ~500MB with browser

## Testing Tools

- `agent-browser` skill for browser-based validation
- `curl` for direct API testing
- Shell commands for unit tests, lint, dead-code, cpd
