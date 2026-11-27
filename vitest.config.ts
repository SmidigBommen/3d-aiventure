import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['client/src/**/*.test.ts', 'holdout/**/*.test.ts'],
    environment: 'node',
  },
});
