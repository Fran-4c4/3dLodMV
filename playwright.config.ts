import { defineConfig } from '@playwright/test';

const browserTestPort = 8014;

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60_000,
  use: { baseURL: `http://127.0.0.1:${browserTestPort}`, viewport: { width: 1440, height: 900 } },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${browserTestPort} --strictPort`,
    url: `http://127.0.0.1:${browserTestPort}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
