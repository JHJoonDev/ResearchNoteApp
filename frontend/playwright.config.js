import process from 'node:process';
import { defineConfig } from '@playwright/test';
const built = process.env.E2E_BUILT === '1';
export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  workers: 1,
  retries: 0,
  use: {
    baseURL: built ? 'http://127.0.0.1:5000' : 'http://127.0.0.1:5173',
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node test/e2e-server.js',
      cwd: '../backend',
      url: 'http://127.0.0.1:5000/api/health',
      reuseExistingServer: false,
      timeout: 60000,
    },
    ...(!built
      ? [
          {
            command: 'npm.cmd run dev -- --port 5173 --strictPort',
            url: 'http://127.0.0.1:5173',
            env: { VITE_API_BASE_URL: '/api' },
            reuseExistingServer: false,
            timeout: 30000,
          },
        ]
      : []),
  ],
});
