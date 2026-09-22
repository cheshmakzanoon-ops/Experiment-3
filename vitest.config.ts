import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { maxWorkers: 1, include: ['tests/**/*.test.ts'], testTimeout: 120000 },
});
