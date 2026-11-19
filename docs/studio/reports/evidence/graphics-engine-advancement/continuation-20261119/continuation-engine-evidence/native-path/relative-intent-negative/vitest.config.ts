import { defineConfig } from 'vitest/config';
export default defineConfig({
  // Unit tests keep exercising the owner-only supplied-player code paths (loader,
  // look-dev, rig) and the review tooling; only app builds leave them out (src/build-flags.d.ts).
  define: { __SUPPLIED_PLAYER__: true, __REVIEW_TOOLS__: true },
  test: { maxWorkers: 1, include: ['tests/**/*.test.ts'], testTimeout: 120000 },
});
