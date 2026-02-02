#!/usr/bin/env bash
set -euo pipefail

node --test --experimental-test-coverage 2>&1 | tee /tmp/test.log

awk '
  /# all files \|/ {
    # after splitting, field 5 is the line % value
    lp = $5 + 0;
    if (lp < 88.40) {
      printf "Coverage too low: %.2f%% lines (min 88.40%%)\n", lp;
      exit 1;
    }
  }
' /tmp/test.log
