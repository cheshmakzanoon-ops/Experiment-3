// Playwright config for DOM-only component specs run the way the CI browser job runs them: a
// HEADED Chromium (under xvfb-run) instead of the headless shell. The difference matters for layout:
// headless Playwright passes --hide-scrollbars, a headed browser draws real, space-taking scrollbars,
// which is what every Windows and Linux desktop player has. A panel that only fits when its scrollbar
// is invisible fails in CI (run 41915850034: 28-race-hud-layout x4 and 44-motocross-interface all
// overflowed by exactly 10 px) and passes in pw-dom.config.ts.
//
// Usage (from the worktree root):
//   CHROMIUM_PATH=/opt/pw-browsers/chromium APEX_WT=$PWD APEX_OUT=<unique dir> \
//     xvfb-run -a -s '-screen 0 1920x1080x24' \
//     npx playwright test -c scripts/studio/tools/pw-headed.config.ts e2e/28-race-hud-layout.spec.ts
import base from '../../../playwright.config.ts';

const wt = process.env.APEX_WT;
if (!wt) throw new Error('Set APEX_WT=<worktree abs path>');
export default {
  ...base,
  testDir: `${wt}/e2e`,
  globalSetup: undefined,
  webServer: undefined,
  outputDir: process.env.APEX_OUT ?? `${wt}/../pw-results-headed`,
  reporter: [['list']],
  use: { ...base.use, headless: false },
};
