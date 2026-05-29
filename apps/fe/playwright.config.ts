import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e config. Unit/integration tests use Vitest (`*.spec.ts`);
 * e2e specs live in `e2e/` as `*.e2e.ts` so the Vitest glob never picks them up.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4300',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // ng serve must run under Node (Bun fs.watch crashes watchpack) — `bun run start` delegates via shebang.
    command: 'bun run start -- --port 4300',
    url: 'http://localhost:4300',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
