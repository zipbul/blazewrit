import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Mechanical accessibility gate: every route must pass axe-core with zero violations
 * for WCAG 2.0/2.1 A + AA (official best-practice: "MUST pass all AXE checks").
 */
const ROUTES = ['/dashboard', '/board', '/canvas', '/decisions', '/connections'];

for (const route of ROUTES) {
  test(`a11y: ${route} has no WCAG A/AA violations`, async ({ page }) => {
    await page.goto(route);
    // let the live store data render
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
}
