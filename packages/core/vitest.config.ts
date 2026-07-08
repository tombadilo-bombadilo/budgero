import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['node-tests/test-setup.ts'],
    include: ['node-tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
      exclude: ['dist/**', 'node-tests/test-setup.ts'],
    },
  },
});
