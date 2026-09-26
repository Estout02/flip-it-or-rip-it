// End-to-end + accessibility matrix (T036). Runs against a production build under
// `vite preview`, with every /api/** request answered by page.route mocks (e2e/fixtures.ts):
// no request ever reaches the real API or eBay.
//
// All three projects are Chromium (the only engine in the pinned Playwright image we need
// for axe + CDP accessibility-tree checks). Light and dark are a parameterised describe in
// each spec, so every project × theme combination runs.
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // A registered service worker would fetch /api/** itself, outside page.route. Specs that
    // exercise the offline shell opt back in (offline.spec.ts) and mock at the context level.
    serviceWorkers: 'block',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-320',
      use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 640 }, hasTouch: true },
    },
    {
      name: 'mobile-390',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 3,
      },
    },
    {
      name: 'desktop-1280',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --host`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
