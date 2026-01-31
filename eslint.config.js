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

/**
 * Naming Convention Rules
 *
 * This project enforces consistent naming conventions:
 * - Variables and functions: camelCase (e.g., myFunction, userData)
 * - Constants: SCREAMING_SNAKE_CASE (e.g., MAX_SIZE, DEFAULT_TIMEOUT)
 * - Classes/Constructors: PascalCase (e.g., MyClass)
 * - File names: kebab-case (e.g., my-component.js)
 * - Private identifiers: prefix with underscore allowed after 'this'
 *
 * These conventions are enforced via ESLint rules:
 * - 'camelcase': Enforces camelCase for identifiers (with SCREAMING_SNAKE_CASE allowed)
 * - 'new-cap': Enforces PascalCase for constructors
 * - 'no-underscore-dangle': Controls underscore prefix usage
 */
const namingConventionRules = {
  // Enforce camelCase naming for variables and functions
  // Properties are excluded to allow object literals with external APIs
  // SCREAMING_SNAKE_CASE is allowed for constants (e.g., TIME_RANGES, DEFAULT_TOP_N)
  camelcase: ['error', {
    properties: 'never',
    ignoreDestructuring: false,
    ignoreImports: false,
    ignoreGlobals: false,
    allow: ['^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$'],
  }],

  // Enforce PascalCase for constructor functions and classes
  'new-cap': ['error', {
    newIsCap: true,
    capIsNew: false,
    newIsCapExceptions: [],
    capIsNewExceptions: ['Immutable.Map', 'Immutable.Set', 'Immutable.List'],
  }],

  // Control underscore usage - allow after 'this' for private-like members
  'no-underscore-dangle': ['error', {
    allowAfterThis: true,
    allowAfterSuper: false,
    enforceInMethodNames: true,
    allow: [
      '__ow_method',
      '__ow_headers',
      '__ow_path',
      '__ow_user',
      '__ow_body',
      '__ow_query',
    ],
  }],

  // Require function expressions to have names for better debugging
  'func-names': ['warn', 'as-needed'],

  // Ensure consistent function naming for exports
  'func-name-matching': ['error', 'always', {
    considerPropertyDescriptor: true,
    includeCommonJSModuleExports: false,
  }],
};

export default [
  {
    ignores: ['node_modules/**', 'coverage/**', 'dist/**'],
  },
  {
    ...recommended,
    files: ['js/**/*.js', 'scripts/**/*.mjs'],
    rules: {
      ...recommended.rules,
      ...namingConventionRules,
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
