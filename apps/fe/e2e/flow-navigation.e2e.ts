import { test, expect } from '@playwright/test';

test.describe('workspace shell navigation', () => {
  test('redirects root to dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('shell chrome is present', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('blazewrit')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Board', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Canvas', exact: true })).toBeVisible();
  });

  test('switches between the three views', async ({ page }) => {
    await page.goto('/dashboard');

    await page.getByRole('link', { name: 'Board', exact: true }).click();
    await expect(page).toHaveURL(/\/board$/);

    await page.getByRole('link', { name: 'Canvas', exact: true }).click();
    await expect(page).toHaveURL(/\/canvas$/);

    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('unknown route falls back to dashboard', async ({ page }) => {
    await page.goto('/does-not-exist');
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
