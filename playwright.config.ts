import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  // GitHub-hosted SwiftShader can drop below 1 FPS on the full fidelity scene.
  // Keep the assertions intact, but budget for real GPU-backed frames to arrive.
  timeout: 300000,
  expect: { timeout: 60000 },
  // Shard individual isolated cases, not whole files; each runner still uses one GPU.
  fullyParallel: true,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'npm run preview -- --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
