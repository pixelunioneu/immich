import { defineConfig, devices } from '@playwright/test';

// PixelUnion fork e2e (web). Runs only the fork's specs, against the nginx web image
// from the stack that `mise run //e2e:pu-up` starts. No retries.
export default defineConfig({
  testDir: './src/specs/pu/web',
  testMatch: /pu-.*\.e2e-spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/pu' }]] : 'list',
  use: {
    baseURL: process.env.PU_E2E_WEB_URL ?? 'http://127.0.0.1:2287',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'pu-web', use: { ...devices['Desktop Chrome'] } }],
});
