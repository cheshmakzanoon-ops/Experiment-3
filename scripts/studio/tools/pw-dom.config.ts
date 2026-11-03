// Playwright config for DOM-only component specs (e2e/60-launch-board, 44-motocross-interface...):
// they build their own fixture with vite and call page.setContent, so they need no preview
// server and no WebGL backend check. Usage (from the worktree root):
//   CHROMIUM_PATH=/opt/pw-browsers/chromium APEX_WT=$PWD npx playwright test -c scripts/studio/tools/pw-dom.config.ts e2e/60-launch-board.spec.ts
import base from '../../../playwright.config.ts';

const wt = process.env.APEX_WT;
if (!wt) throw new Error('Set APEX_WT=<worktree abs path>');
export default {
  ...base,
  testDir: `${wt}/e2e`,
  globalSetup: undefined,
  webServer: undefined,
  outputDir: process.env.APEX_OUT ?? `${wt}/../pw-results-dom`,
  reporter: [['list']],
};
