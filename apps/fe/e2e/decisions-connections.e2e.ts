import { test, expect } from '@playwright/test';

/** Decision inbox (HITL) + connection monitor against the apps/mock stand-in. */
// Serial: the answering tests mutate shared mock state, so they run last,
// after the count-based assertions, on a freshly-started mock.
test.describe.serial('decision inbox', () => {
  test('lists open decisions with risk and options', async ({ page }) => {
    await page.goto('/decisions');
    await expect(page.locator('.inbox .card')).toHaveCount(4);
    // recommended options appear on the single-choice and multi-choice decisions
    await expect(page.locator('.opt.recommended')).toHaveCount(1);
    // a free-text decision renders a reactive textarea
    await expect(page.locator('.ta')).toHaveCount(1);
  });

  test('shell shows the pending-decision badge', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('.views .badge')).toHaveText('4');
  });

  test('multi-choice lets several options be selected then submitted', async ({ page }) => {
    await page.goto('/decisions');
    const multi = page.locator('.card', { has: page.locator('.opt .check') });
    await multi.getByRole('button', { name: /제목/ }).click();
    await multi.getByRole('button', { name: /본문/ }).click();
    // submit button reflects the selected count and is enabled
    await expect(multi.getByRole('button', { name: /제출 \(2\)/ })).toBeEnabled();
    await multi.getByRole('button', { name: /제출 \(2\)/ }).click();
    await expect(page.locator('.inbox .card')).toHaveCount(3);
  });

  test('answering an approval decision removes it from the open list', async ({ page }) => {
    await page.goto('/decisions');
    const before = await page.locator('.inbox .card').count();
    await page.getByRole('button', { name: '승인' }).first().click();
    await expect(page.locator('.inbox .card')).toHaveCount(before - 1);
  });
});

test.describe('connection monitor', () => {
  test('shows a health row per project with the dead one flagged', async ({ page }) => {
    await page.goto('/connections');
    await expect(page.locator('.monitor .row')).toHaveCount(3);
    await expect(page.locator('.row.down .state.unreachable')).toHaveCount(1);
    await expect(page.locator('.row .dot.ok')).toHaveCount(2);
  });
});
