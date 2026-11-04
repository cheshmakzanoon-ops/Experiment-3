// Playwright config for the E2E regression sweep (scripts/studio/tools/e2e-sweep.mjs).
// One config for both kinds of spec, selected by environment so nothing in the repo's own
// playwright.config.ts has to change:
//   APEX_WT=<worktree abs path>   required
//   APEX_OUT=<results dir>        traces and failure screenshots (default: <wt>/../pw-results-sweep)
//   APEX_PORT=<port>              real-game mode: starts `vite preview` of <wt>/dist on this port
//                                 and keeps the backend identity check (globalSetup)
//   (no APEX_PORT)                fixture mode: no preview server, no global setup (specs that
//                                 build their own bundle and call page.setContent)
// The test and expect deadlines of playwright.config.ts are kept unless APEX_TIMEOUT_MS /
// APEX_EXPECT_TIMEOUT_MS are set, which only lengthen them (a measurement aid for software GL,
// used to time a wait that overran, never a change to what a spec asserts). Reporter output is
// chosen on the command line.
import base from '../../../playwright.config.ts';

const wt = process.env.APEX_WT;
if (!wt) throw new Error('Set APEX_WT=<worktree abs path>');
const port = process.env.APEX_PORT ? Number(process.env.APEX_PORT) : undefined;
if (process.env.APEX_PORT && !Number.isInteger(port)) throw new Error('APEX_PORT must be an integer');
const url = port ? `http://127.0.0.1:${port}` : undefined;
// Deadlines are only ever lengthened (a measurement aid for software GL); a spec's own
// test.setTimeout(...) still wins over the per-test value.
const baseTimeout = base.timeout ?? 300000;
const baseExpect = base.expect?.timeout ?? 60000;
const timeout = Math.max(baseTimeout, Number(process.env.APEX_TIMEOUT_MS ?? 0));
const expectTimeout = Math.max(baseExpect, Number(process.env.APEX_EXPECT_TIMEOUT_MS ?? 0));
export default {
  ...base,
  testDir: `${wt}/e2e`,
  timeout,
  expect: { ...base.expect, timeout: expectTimeout },
  globalSetup: port ? `${wt}/scripts/browser-backend-setup.ts` : undefined,
  outputDir: process.env.APEX_OUT ?? `${wt}/../pw-results-sweep`,
  reporter: [['list']],
  use: { ...base.use, ...(url ? { baseURL: url } : {}) },
  webServer: port
    ? {
        command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
        cwd: wt,
        url,
        reuseExistingServer: false,
        timeout: 30000,
      }
    : undefined,
};
