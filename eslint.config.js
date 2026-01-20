/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import globals from 'globals';
import { recommended } from '@adobe/eslint-config-helix';

export default [
  {
    ignores: ['node_modules/**', 'coverage/**', 'dist/**'],
  },
  {
    ...recommended,
    files: ['js/**/*.js', 'scripts/**/*.mjs'],
    rules: {
      ...recommended.rules,
      'max-lines': ['error', { max: 1000 }],
    },
  },
  {
    // Browser source files
    files: ['js/**/*.js'],
    languageOptions: {
      ...recommended.languageOptions,
      globals: {
        ...recommended.languageOptions.globals,
        ...globals.browser,
      },
    },
  },
  {
    // Test files
    files: ['js/**/*.test.js'],
    languageOptions: {
      ...recommended.languageOptions,
      globals: {
        ...recommended.languageOptions.globals,
        ...globals.browser,
        ...globals.mocha,
      },
    },
  },
  {
    // CLI scripts - allow console statements and devDependencies
    files: ['scripts/**/*.mjs'],
    rules: {
      'no-console': 'off',
      'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
    },
  },
];
