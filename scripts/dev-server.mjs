#!/usr/bin/env node

/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { spawn } from 'node:child_process';

const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';
const PATH_SEP = process.platform === 'win32' ? ';' : ':';

const PORT_MIN = 5000;
const PORT_RANGE = 1000;

/**
 * djb2 string hash — deterministic hash of a string to an unsigned 32-bit int.
 */
function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0; // eslint-disable-line no-bitwise
  }
  return hash;
}

function getPort() {
  const cwd = process.cwd();
  const hash = hashString(cwd);
  return PORT_MIN + (hash % PORT_RANGE);
}

const port = getPort();
const noReload = process.argv.includes('--no-reload') || process.env.NO_RELOAD === '1';

if (process.argv.includes('--dry-run')) {
  console.log(port);
  process.exit(0);
}

console.log(`Starting dev server on port ${port}...`);

const args = [
  `--port=${port}`,
  '--ignore=scripts,.github,.claude,hars,node_modules',
  '--ignorePattern=\\.md$|package.*\\.json$|screenshot\\.png$|\\.playwright-cli',
];

if (noReload) {
  args.push('--no-browser', `--watch=${NULL_DEVICE}`);
} else {
  args.push('--open=/');
}

const child = spawn('live-server', args, {
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, PATH: `./node_modules/.bin${PATH_SEP}${process.env.PATH}` },
});

child.on('error', (err) => {
  console.error('Failed to start dev server:', err.message);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
