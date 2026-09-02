import { defineConfig, devices } from '@playwright/test';

// CHROMIUM_PATH lets a sandbox with a pre-installed browser skip the download
// (`npx playwright install chromium` is the normal path, and what CI uses).
const executablePath = process.env.CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1100, height: 860 } } },
    // The portrait board is a different layout, so it gets its own run.
    { name: 'phone', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: false } },
  ],
  // Two servers: the game, and the match server the online tests talk to.
  // `VITE_ONLINE_URL` is what switches online play on — a build without it has
  // no online menu at all, which is the shape CI's other jobs build.
  webServer: [
    {
      command: 'npm run dev:server',
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'npm run build && npm run preview -- --port 4173 --host 127.0.0.1',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { VITE_ONLINE_URL: 'ws://127.0.0.1:8787' },
    },
  ],
});
