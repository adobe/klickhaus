---
name: playwright-cli
description: Automates browser interactions for web testing, form filling, screenshots, and data extraction. Use when the user needs to navigate websites, interact with web pages, fill forms, take screenshots, test web applications, or extract information from web pages.
allowed-tools: Bash(npx playwright-cli:*)
---

# Browser Automation with playwright-cli

`playwright-cli` is invoked via `npx playwright-cli <command>`. Do NOT try to install it — it is already available via npx.

## Logging into the dashboard

The dashboard stores credentials in `localStorage` under the key `clickhouse_credentials`. To log in programmatically (look up the password in `README.local.md`):

```bash
npx playwright-cli open http://localhost:5391/dashboard.html
npx playwright-cli eval 'localStorage.setItem("clickhouse_credentials", JSON.stringify({user: "<username>", password: "<password>"}))'
npx playwright-cli reload
```

## Quick start

```bash
npx playwright-cli open https://playwright.dev
npx playwright-cli click e15
npx playwright-cli type "page.click"
npx playwright-cli press Enter
```

## Core workflow

1. Navigate: `npx playwright-cli open https://example.com`
2. Interact using refs from the snapshot
3. Re-snapshot after significant changes

## Commands

### Core

```bash
npx playwright-cli open https://example.com/
npx playwright-cli close
npx playwright-cli type "search query"
npx playwright-cli click e3
npx playwright-cli dblclick e7
npx playwright-cli fill e5 "user@example.com"
npx playwright-cli drag e2 e8
npx playwright-cli hover e4
npx playwright-cli select e9 "option-value"
npx playwright-cli upload ./document.pdf
npx playwright-cli check e12
npx playwright-cli uncheck e12
npx playwright-cli snapshot
npx playwright-cli eval "document.title"
npx playwright-cli eval "el => el.textContent" e5
npx playwright-cli dialog-accept
npx playwright-cli dialog-accept "confirmation text"
npx playwright-cli dialog-dismiss
npx playwright-cli resize 1920 1080
```

### Navigation

```bash
npx playwright-cli go-back
npx playwright-cli go-forward
npx playwright-cli reload
```

### Keyboard

```bash
npx playwright-cli press Enter
npx playwright-cli press ArrowDown
npx playwright-cli keydown Shift
npx playwright-cli keyup Shift
```

### Mouse

```bash
npx playwright-cli mousemove 150 300
npx playwright-cli mousedown
npx playwright-cli mousedown right
npx playwright-cli mouseup
npx playwright-cli mouseup right
npx playwright-cli mousewheel 0 100
```

### Save as

```bash
npx playwright-cli screenshot
npx playwright-cli screenshot e5
npx playwright-cli pdf
```

### Tabs

```bash
npx playwright-cli tab-list
npx playwright-cli tab-new
npx playwright-cli tab-new https://example.com/page
npx playwright-cli tab-close
npx playwright-cli tab-close 2
npx playwright-cli tab-select 0
```

### DevTools

```bash
npx playwright-cli console
npx playwright-cli console warning
npx playwright-cli network
npx playwright-cli run-code "async page => await page.context().grantPermissions(['geolocation'])"
npx playwright-cli tracing-start
npx playwright-cli tracing-stop
npx playwright-cli video-start
npx playwright-cli video-stop video.webm
```

### Configuration
```bash
# Configure the session
npx playwright-cli config --config my-config.json
npx playwright-cli config --headed --isolated --browser=firefox
# Configure named session
npx playwright-cli --session=mysession config my-config.json
# Start with configured session
npx playwright-cli open --config=my-config.json
```

### Sessions

```bash
npx playwright-cli --session=mysession open example.com
npx playwright-cli --session=mysession click e6
npx playwright-cli session-list
npx playwright-cli session-stop mysession
npx playwright-cli session-stop-all
npx playwright-cli session-delete
npx playwright-cli session-delete mysession
```

## Example: Form submission

```bash
npx playwright-cli open https://example.com/form
npx playwright-cli snapshot

npx playwright-cli fill e1 "user@example.com"
npx playwright-cli fill e2 "password123"
npx playwright-cli click e3
npx playwright-cli snapshot
```

## Example: Multi-tab workflow

```bash
npx playwright-cli open https://example.com
npx playwright-cli tab-new https://example.com/other
npx playwright-cli tab-list
npx playwright-cli tab-select 0
npx playwright-cli snapshot
```

## Example: Debugging with DevTools

```bash
npx playwright-cli open https://example.com
npx playwright-cli click e4
npx playwright-cli fill e7 "test"
npx playwright-cli console
npx playwright-cli network
```

```bash
npx playwright-cli open https://example.com
npx playwright-cli tracing-start
npx playwright-cli click e4
npx playwright-cli fill e7 "test"
npx playwright-cli tracing-stop
```

## Specific tasks

* **Request mocking** [references/request-mocking.md](references/request-mocking.md)
* **Running Playwright code** [references/running-code.md](references/running-code.md)
* **Session management** [references/session-management.md](references/session-management.md)
* **Storage state (cookies, localStorage)** [references/storage-state.md](references/storage-state.md)
* **Test generation** [references/test-generation.md](references/test-generation.md)
* **Tracing** [references/tracing.md](references/tracing.md)
* **Video recording** [references/video-recording.md](references/video-recording.md)
