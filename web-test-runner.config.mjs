import { playwrightLauncher } from '@web/test-runner-playwright';

export default {
  files: 'js/**/*.test.js',
  nodeResolve: true,
  browsers: [
    playwrightLauncher({ product: 'chromium' }),
  ],
  coverage: true,
  coverageConfig: {
    include: ['js/**/*.js'],
    exclude: ['js/**/*.test.js'],
    threshold: {
      statements: 0,
      branches: 0,
      functions: 0,
      lines: 95,
    },
  },
};
