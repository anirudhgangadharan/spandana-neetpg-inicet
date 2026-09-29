import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const attemptId = '1de98e87-5a44-4d58-9a42-85ff6418c89b';

test('retains an answer through refresh and sends it only at final submission', async ({ page }) => {
  let answerWrites = 0;
  let submitted: unknown = null;
  await page.route(`**/api/module-attempts/${attemptId}/responses`, (route) => {
    answerWrites += 1;
    return route.abort();
  });
  await page.route(`**/api/module-attempts/${attemptId}/activity`, (route) => {
    answerWrites += 1;
    return route.abort();
  });
  await page.route(`**/api/module-attempts/${attemptId}/submit`, async (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      status: 'submitted', id: attemptId, title: 'Browser test module', attemptNumber: 1,
      submittedAt: '2030-01-01T10:02:00.000Z', score: 4, maxPoints: 4,
      correctCount: 1, wrongCount: 0, unansweredCount: 0, review: null,
    }) });
  });
  await page.goto('/e2e-harness/module-attempt');
  await page.getByLabel('Alpha', { exact: false }).check();
  expect(answerWrites).toBe(0);
  await page.reload();
  await expect(page.getByLabel('Alpha', { exact: false })).toBeChecked();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Submit attempt' }).click();
  await expect(page.getByRole('heading', { name: 'Submitted' })).toBeVisible();
  expect(answerWrites).toBe(0);
  expect(submitted).toEqual({ answers: [{ position: 1, selectedIndex: 0 }] });
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

test('automatically submits when the displayed deadline is reached', async ({ page }) => {
  await page.route(`**/api/module-attempts/${attemptId}/submit`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      status: 'submitted', id: attemptId, title: 'Browser test module', attemptNumber: 1,
      submittedAt: '2030-01-01T10:10:00.000Z', score: 0, maxPoints: 4,
      correctCount: 0, wrongCount: 0, unansweredCount: 1, review: null,
    }),
  }));
  await page.goto('/e2e-harness/module-attempt?expired=1');
  await expect(page.getByRole('heading', { name: 'Submitted' })).toBeVisible();
  await expect(page.getByText('0 / 4 points')).toBeVisible();
});

test('active exam has no automatically detectable WCAG A/AA violations', async ({ page }) => {
  await page.goto('/e2e-harness/module-attempt');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
});

test('guest entry requires all three identifiers and sends no Google sign-in request', async ({ page }) => {
  let submitted: unknown = null;
  await page.route('**/api/modules/*/guest', (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 201, contentType: 'application/json', body: '{"registered":true}' });
  });
  await page.goto('/e2e-harness/guest-entry');
  await expect(page.getByRole('heading', { name: 'Student details' })).toBeVisible();
  await expect(page.getByText('No Google sign-in is needed.')).toBeVisible();
  await page.getByRole('button', { name: 'Continue to test' }).click();
  expect(submitted).toBeNull();
  await expect(page.getByText('Enter your name.')).toBeVisible();
  await expect(page.getByText('Enter your registration number.')).toBeVisible();
  await expect(page.getByText('Enter your roll number.')).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill(' Ada Rao ');
  await page.getByLabel('Registration number').fill(' 0012 ');
  await page.getByLabel('Roll number').fill(' 07 ');
  await page.getByRole('button', { name: 'Continue to test' }).click();
  await expect.poll(() => submitted).toEqual({ name: 'Ada Rao', registrationNumber: '0012', rollNumber: '07' });
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
});
