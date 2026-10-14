import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./test/setup-dns.ts'],
    root: './',
    include: ['**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.spec.ts'],
  },
});
