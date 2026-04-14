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

## Flow Validator Guidance: agent-browser

- Use dedicated sessions only; never use a shared/default session.
- Stay on `http://localhost:5561/` for app pages and `https://bundles.aem.page/` for API-bound behavior checks.
- Keep validation read-only: do not modify app source files, local config, or mission artifacts except your assigned flow report/evidence.
- Isolation boundary: only test the assertions assigned in your prompt. Avoid changing global browser state beyond that scope.
- If login state impacts assertions, include explicit reload/navigation steps and capture before/after evidence.
- Always collect both screenshot evidence and DOM/eval evidence when assertions require numeric/shape checks.
- Capture console and network output whenever assertions mention errors, requests, or “no JS exceptions”.
- Close every agent-browser session you open before finishing.

## Flow Validator Guidance: shell

- Run only the commands needed for assigned assertions.
- Execute commands from `/Users/trieloff/Developer/clickhouse-queries`.
- Do not edit source code or install new runtime dependencies during validation.
- Record exact exit codes and key output excerpts for each command.
- If command failures are caused by known mission constraints (e.g., expected credential issues), mark clearly with evidence.

## Flow Validator Guidance: curl

- Use `curl` only against endpoints required by assigned assertions.
- Prefer explicit status capture (`-w "%{http_code}"`) and response body snippets for evidence.
- Do not send mutating requests; validation should remain read-only.

## Operational Notes (foundation run)

- `agent-browser network requests` can occasionally return no captured entries even when requests are happening. Use `performance.getEntriesByType('resource')` and/or temporary in-page `fetch` interception as fallback evidence.
- ClickHouse-backed browser regression checks may be blocked by credential rotation (403). Treat as blocked with explicit login/console/network evidence rather than misclassifying as product regressions.
- For `VAL-NAV-006`/checkpoint-subfacet flows, the `click` checkpoint might not appear in Top 5 immediately. Expand the Checkpoint facet with `other` (Top 10/Top 20) before selecting `click`.
