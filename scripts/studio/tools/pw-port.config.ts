// Playwright config wrapper: run the repo's e2e specs from a git worktree on a
// private preview port, so parallel agents never share (or silently REUSE) port 4173.
// Usage (cd into the worktree first; `npm run build` must already have produced dist/ there):
//   APEX_WT=$PWD APEX_PORT=43xx npx playwright test -c <scratchpad>/tools/pw-port.config.ts e2e/49-hud-footprint.spec.ts
// Traces/results go to <worktree>/../pw-results-<port>, not into the worktree.
// NOTE: scripts/browser-progress-reporter.mjs writes browser-progress.json into the CWD
// (worktree root) and that file is NOT gitignored: delete it, never `git add -A`.
import base from '../../../playwright.config.ts';

const wt = process.env.APEX_WT;
const port = Number(process.env.APEX_PORT);
if (!wt || !Number.isInteger(port))
  throw new Error('Set APEX_WT=<worktree abs path> and APEX_PORT=<port>');
const url = `http://127.0.0.1:${port}`;
export default {
  ...base,
  testDir: `${wt}/e2e`,
  globalSetup: `${wt}/scripts/browser-backend-setup.ts`,
  outputDir: `${wt}/../pw-results-${port}`,
  reporter: [['list'], [`${wt}/scripts/browser-progress-reporter.mjs`]],
  use: { ...base.use, baseURL: url },
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: wt,
    url,
    reuseExistingServer: false,
    timeout: 30000,
  },
};
