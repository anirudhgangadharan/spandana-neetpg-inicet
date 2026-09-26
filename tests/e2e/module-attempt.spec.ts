import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const attemptId = '1de98e87-5a44-4d58-9a42-85ff6418c89b';

test('retains an unsent answer through refresh and retries it', async ({ page }) => {
  let saves = 0;
  await page.route(`**/api/module-attempts/${attemptId}/responses`, async (route) => {
    saves += 1;
    if (saves === 1) return route.abort('internetdisconnected');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      position: 1, selectedIndex: 0, revision: 1, activeTimeMs: null,
      savedAt: '2030-01-01T10:01:02.000Z',
    }) });
  });
  await page.goto('/e2e-harness/module-attempt');
  await page.getByLabel('Alpha', { exact: false }).check();
  await expect(page.getByText('1 unsaved answer. Reconnect to retry.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Alpha', { exact: false })).toBeChecked();
  await expect(page.getByText('All answers saved.')).toBeVisible();
  expect(saves).toBe(2);
});

test('submits once and exposes score-only result without an answer key', async ({ page }) => {
  await page.route(`**/api/module-attempts/${attemptId}/submit`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      status: 'submitted', id: attemptId, title: 'Browser test module', attemptNumber: 1,
      submittedAt: '2030-01-01T10:02:00.000Z', score: 0, maxPoints: 4,
      correctCount: 0, wrongCount: 0, unansweredCount: 1, review: null,
    }),
  }));
  await page.goto('/e2e-harness/module-attempt');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Submit attempt' }).click();
  await expect(page.getByRole('heading', { name: 'Submitted' })).toBeVisible();
  await expect(page.getByText('0 / 4 points')).toBeVisible();
  await expect(page.getByText('Answer review is disabled')).toBeVisible();
  await expect(page.getByText('correct answer')).toHaveCount(0);
});

test('asks the server to finalize when the displayed deadline is reached', async ({ page }) => {
  await page.route(`**/api/module-attempts/${attemptId}`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      status: 'expired', id: attemptId, title: 'Browser test module', attemptNumber: 1,
      submittedAt: '2030-01-01T10:10:00.000Z', score: 0, maxPoints: 4,
      correctCount: 0, wrongCount: 0, unansweredCount: 1, review: null,
    }),
  }));
  await page.goto('/e2e-harness/module-attempt?expired=1');
  await expect(page.getByRole('heading', { name: 'Time ended' })).toBeVisible();
  await expect(page.getByText('0 / 4 points')).toBeVisible();
});

test('active exam has no automatically detectable WCAG A/AA violations', async ({ page }) => {
  await page.goto('/e2e-harness/module-attempt');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
});
