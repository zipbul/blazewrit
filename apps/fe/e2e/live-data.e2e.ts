import { test, expect } from '@playwright/test';

/**
 * Verifies the views render live data from the backend (the apps/mock stand-in on :4500).
 * Requires the mock server to be running.
 */
test.describe('live data rendering', () => {
  test('dashboard shows the focused work item and an active flow step', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('.focus h1')).toHaveText('결제 모듈 분기 버그');
    // active step node present (test, currently running)
    await expect(page.locator('.metro .n.ac')).toHaveCount(1);
    // connections rendered for the three projects
    await expect(page.locator('.conns .x')).toHaveCount(3);
  });

  test('dashboard streams live agent events over SSE', async ({ page }) => {
    await page.goto('/dashboard');
    // mock replays 6 agent events ~900ms apart; at least one tool line should appear
    await expect(page.locator('.live .lv .c').first()).toBeVisible({ timeout: 8000 });
  });

  test('board groups tasks into flow-step lanes', async ({ page }) => {
    await page.goto('/board');
    // #142 (bugfix) is at the test step
    const testLane = page.locator('.lane').filter({ has: page.locator('.lane-h:has-text("test")') });
    await expect(testLane.locator('.tc .t')).toHaveText('결제 모듈 분기 버그');
  });

  test('canvas renders a node per work item plus the project', async ({ page }) => {
    await page.goto('/canvas');
    await expect(page.locator('.node.task')).toHaveCount(3);
    await expect(page.locator('.node.proj .nm')).toHaveText('api');
  });
});
