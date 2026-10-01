import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
const id = '7399edc6-4c3e-4186-af4c-1bfd3e51c5bc';
test('owner generates, copies, replaces and disables sharing through accessible controls', async ({ page }) => {
  let enabled = false;
  let generations = 0;
  await page.route(`**/api/faculty/modules/${id}/analytics-share`, (route) => {
    const method = route.request().method();
    if (method === 'POST') { enabled = true; generations++; }
    if (method === 'DELETE') enabled = false;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      status: { enabled, createdAt: enabled ? '2026-10-01T00:00:00Z' : null },
      path: method === 'POST' ? `/shared/module-analytics/synthetic-${generations}` : null,
    }) });
  });
  await page.goto('/e2e-harness/release?view=analytics');
  await page.getByRole('button', { name: 'Share analytics', exact: true }).click();
  await expect(page.getByText(/They can forward the link/)).toBeVisible();
  expect(generations).toBe(0);
  await page.getByRole('button', { name: 'Generate link' }).click();
  await expect(page.getByRole('textbox', { name: 'Analytics link', exact: true })).toHaveValue(/synthetic-1$/);
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByRole('status')).toContainText(/Link copied|Could not copy/);
  await page.getByRole('button', { name: 'Replace link' }).click();
  await expect(page.getByRole('textbox', { name: 'Analytics link', exact: true })).toHaveValue(/synthetic-2$/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Share analytics', exact: true }).click();
  await page.getByRole('button', { name: 'Share analytics', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Analytics link', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Disable sharing' })).toBeEnabled();
  await page.getByRole('button', { name: 'Disable sharing' }).click();
  await expect(page.getByRole('textbox', { name: 'Analytics link', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Generate link' })).toBeVisible();
});
test('anonymous shared rendering is read-only and accessible on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/e2e-harness/release?view=shared-analytics');
  await expect(page.getByText('Shared analytics · Read-only')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Student attempts' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share analytics' })).toHaveCount(0);
  await expect(page.locator('a[href^="/faculty/"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Refresh analytics' })).toHaveAttribute('href', /shared\/module-analytics/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('real public routes bypass login, fail closed, and prohibit token substitution', async ({ page, request }) => {
  const response = await page.goto('/shared/module-analytics/invalid');
  await expect(page.getByText('This analytics link is unavailable. Ask the module creator for a new link.')).toBeVisible();
  expect(page.url()).not.toContain('/login');
  expect(response!.headers()['referrer-policy']).toBe('no-referrer');
  expect(response!.headers()['cache-control']).toContain('no-store');
  expect(response!.headers()['x-robots-tag']).toBe('noindex, nofollow');
  expect((await request.get('/api/shared/module-analytics/invalid')).status()).toBe(404);
  expect((await request.get(`/api/modules/${'a'.repeat(43)}`)).status()).toBe(404);
  expect((await request.get(`/api/faculty/modules/${id}/analytics-share`)).status()).toBe(404);
});
