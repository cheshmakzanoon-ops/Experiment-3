import { defineConfig, chromium } from '@playwright/test';
import { browserBackend } from './scripts/browser-backend.ts';
const backend = browserBackend(process.env.APEX_BROWSER_BACKEND);
export default defineConfig({
  testDir: './e2e',
  globalSetup: './scripts/browser-backend-setup.ts',
  // Keep every original workload, deadline and assertion. Hosted full-race jobs
  // select verified Mesa; the independent SwiftShader GPU job remains required.
  timeout: 300000,
  expect: { timeout: 60000 },
  // Shard individual isolated cases, not whole files; each runner still uses one GPU.
  fullyParallel: true,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }], ['./scripts/browser-progress-reporter.mjs']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: backend.headless,
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ||
        (backend.name === 'mesa' ? chromium.executablePath() : undefined),
      args: backend.args,
    },
  },
  webServer: {
    command: 'npm run preview -- --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
