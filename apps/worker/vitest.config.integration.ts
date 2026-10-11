import { defineConfig } from 'vitest/config';

// Runs against the real database in apps/worker/.env.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['**/*.integration.spec.ts'],
  },
});
