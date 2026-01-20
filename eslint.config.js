import globals from 'globals';
import { recommended } from '@adobe/eslint-config-helix';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  {
    ...recommended,
    languageOptions: {
      ...recommended.languageOptions,
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    rules: {
      ...recommended.rules,
      // Disable license header requirement (not an Adobe project)
      'header/header': 'off',
      // Disable inclusive language check
      'id-match': 'off',
      // Allow console.error and console.warn for debugging
      'no-console': ['warn', { allow: ['error', 'warn', 'log'] }],
      // Enforce strict equality
      eqeqeq: ['error', 'always'],
      // Allow radix to be omitted for decimal
      radix: 'off',
      // Allow ++ and -- operators
      'no-plusplus': 'off',
      // Allow function and variable hoisting (common patterns in complex modules)
      'no-use-before-define': ['error', { functions: false, classes: true, variables: false }],
      // Increase max line length for this project
      'max-len': ['error', { code: 120, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true }],
      // Allow continue statements
      'no-continue': 'off',
      // Allow mixed operators (parens clarify precedence)
      'no-mixed-operators': 'off',
      // Allow underscore dangle for private-ish variables
      'no-underscore-dangle': 'off',
      // Allow nested ternaries (can be readable when formatted well)
      'no-nested-ternary': 'off',
      // Allow bitwise operators (used for hashing)
      'no-bitwise': 'off',
      // Allow await in loops (sometimes needed for sequential processing)
      'no-await-in-loop': 'off',
      // Allow param reassignment (common in reducers and middleware)
      'no-param-reassign': 'off',
      // Allow mutable exports (state management pattern)
      'import/no-mutable-exports': 'off',
      // Allow implicit arrow linebreak
      'implicit-arrow-linebreak': 'off',
      // Allow function loop closures (common pattern, safe when used correctly)
      'no-loop-func': 'off',
      // Allow variable shadowing (common for local scope clarity)
      'no-shadow': 'off',
      // Disable cycle detection (acceptable for this UI codebase)
      'import/no-cycle': 'off',
      // Allow devDependencies in scripts
      'import/no-extraneous-dependencies': ['error', { devDependencies: ['scripts/**/*.mjs', '**/*.test.js'] }],
      // Allow unused vars with underscore prefix and unused caught errors
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
      // Relax consistent-return for complex async functions
      'consistent-return': 'off',
    },
  },
  {
    // Source files
    files: ['js/**/*.js', 'sw.js'],
  },
  {
    // Test files
    files: ['**/*.test.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.node,
      },
    },
  },
  {
    // Scripts (Node.js)
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
  },
  {
    ignores: ['node_modules/**', 'coverage/**', 'dist/**', 'hars/**'],
  },
  // Disable all ESLint rules that conflict with Prettier
  eslintConfigPrettier,
];
