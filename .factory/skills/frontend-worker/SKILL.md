---
name: frontend-worker
description: Implements dashboard features — refactoring shared modules, creating RUM data adapters, HTML pages, and entry points
---

# Frontend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for all implementation features in this mission:
- Refactoring shared modules (dashboard-init.js, chart.js, filters)
- Creating the RUM data adapter (bundles.aem.page + rum-distiller)
- Creating HTML pages and entry point JS files
- Defining RUM-specific breakdown facets
- Building auth system for domain+domainkey
- Key metrics overlay
- Cross-page navigation

## Required Skills

- `agent-browser` — For manual verification of rendered pages. Invoke after implementation to visually confirm the feature works in a real browser. Required for any feature that modifies rendering, UI, or page behavior.

## Work Procedure

### 1. Understand the Feature

Read the feature description, preconditions, expectedBehavior, and verificationSteps carefully. Then:
- Read `.factory/library/architecture.md` for system overview
- Read `AGENTS.md` for coding conventions and boundaries
- Read any referenced existing files to understand current patterns
- Check `CLAUDE.md` for project-specific naming and linting rules

### 2. Write Tests First (TDD)

Before any implementation:
- Create or update test files in `js/**/*.test.js`
- Write failing tests that verify the expected behavior
- Run `npm test` to confirm tests fail (red phase)
- Tests should cover: main functionality, edge cases, error handling
- For data transformation: test input/output shapes match the data format contracts in AGENTS.md
- For UI components: test DOM structure, event handling, state management

### 3. Implement

- Follow existing patterns in the codebase
- Use vanilla ES modules — no build step, no framework
- Import `@adobe/rum-distiller` via import map in HTML (NOT via npm)
- Keep modules focused — one responsibility per file
- For refactoring: ensure backward compatibility with existing dashboards
- Match the data format contracts: `{t, cnt_ok, cnt_4xx, cnt_5xx}` for chart, `{dim, cnt, cnt_ok, cnt_4xx, cnt_5xx}` for breakdowns

### 4. Run All Quality Gates

After implementation, run ALL of these and fix any issues:
```
npm test          # All tests pass, 95% coverage maintained
npm run lint      # Zero errors
npm run dead-code # No unused exports (may need knip.json update for new entry points)
```

If `dead-code` fails because new entry points aren't registered, update `knip.json` to include them.

### 5. Manual Verification with agent-browser

Start the dev server and verify the feature works in a real browser:
1. Invoke the `agent-browser` skill
2. Navigate to the relevant page(s)
3. For RUM pages: use `?domain=www.aem.live&domainkey=53A02890-F91F-428B-A870-A809B82D953E`
4. For existing dashboards: use credentials from README.local.md (david_query)
5. Take screenshots, check console for errors, verify interactions
6. Each manual check becomes an entry in `verification.interactiveChecks`

### 6. Verify Backward Compatibility (for refactoring features)

When modifying shared modules (dashboard-init.js, chart.js, etc.):
1. Run the full test suite — all 793+ existing tests must pass
2. Use agent-browser to verify at least one existing dashboard (e.g., dashboard.html) still works
3. Check that existing entry points (main.js, lambda-main.js, etc.) still function

## Example Handoff

```json
{
  "salientSummary": "Refactored chart.js to support configurable series labels via state.seriesLabels. Added 'good/needs improvement/poor' labels for RUM pages while keeping '2xx/4xx/5xx' as default. All 793 existing tests pass plus 12 new tests. Verified delivery dashboard still shows 2xx/4xx/5xx via agent-browser.",
  "whatWasImplemented": "Added state.seriesLabels config to chart.js. The buildValueBadges() function now reads labels from state instead of hardcoding '2xx/4xx/5xx'. Default remains backward-compatible. New test file js/chart-labels.test.js covers both default and custom label scenarios.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "npm test", "exitCode": 0, "observation": "805 tests passing, 95.4% coverage" },
      { "command": "npm run lint", "exitCode": 0, "observation": "No errors" },
      { "command": "npm run dead-code", "exitCode": 0, "observation": "No unused exports" }
    ],
    "interactiveChecks": [
      { "action": "Opened dashboard.html with ClickHouse credentials, hovered chart scrubber", "observed": "Scrubber shows '2xx: 1,234 | 4xx: 56 | 5xx: 12' — existing labels preserved" },
      { "action": "Created test page with state.seriesLabels = {ok: 'good', client: 'needs improvement', server: 'poor'}, hovered chart", "observed": "Scrubber shows 'good: 1,234 | needs improvement: 56 | poor: 12'" }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "js/chart-labels.test.js",
        "cases": [
          { "name": "uses default 2xx/4xx/5xx labels when no custom labels set", "verifies": "Backward compatibility" },
          { "name": "uses custom labels from state.seriesLabels", "verifies": "Custom label rendering" },
          { "name": "buildValueBadges applies correct CSS classes with custom labels", "verifies": "Styling consistency" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature depends on a shared module refactoring that hasn't been completed yet
- Existing tests break in a way that suggests the feature's preconditions aren't met
- The bundles.aem.page API returns unexpected data format
- Coverage drops below 95% and can't be recovered without architectural changes
- knip or jscpd failures that require cross-feature coordination
