#!/bin/bash
set -e

cd /Users/trieloff/Developer/clickhouse-queries

# Install dependencies (idempotent)
npm install

# Ensure Playwright browsers are installed for test runner
npx playwright install chromium 2>/dev/null || true
