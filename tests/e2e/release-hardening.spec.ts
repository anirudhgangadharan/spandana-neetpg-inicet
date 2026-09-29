import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const moduleId = '7399edc6-4c3e-4186-af4c-1bfd3e51c5bc';
const shareToken = '49e6856c-5cc8-44d3-a055-736794c03711';
const question = {
  id: 'question-1', source: 'medmcqa', split: 'train', stem: 'A release-test clinical question?',
  options: ['Alpha', 'Beta', 'Gamma', 'Delta'], subject: 'Medicine', topic: 'Cardiology',
  flags: [], eligible: true, usedElsewhere: false,
};
const baseModule = {
  id: moduleId, title: 'Browser faculty module', status: 'draft', createdAt: '2030-01-01T09:00:00.000Z',
  questionCount: 0, openedCount: 0, startedCount: 0, submittedCount: 0, expiredCount: 0,
  description: 'Release-test draft', instructions: 'Answer independently.', opensAt: '2030-01-01T10:00:00.000Z',
  closesAt: '2030-01-01T12:00:00.000Z', durationSeconds: 600, maxAttempts: 1,
  correctPoints: 4, wrongPoints: -1, blankPoints: 0, allowReview: false, shareToken, revision: 0,
  publishedAt: null, selectedQuestions: [],
};
const selected = { id: question.id, position: 1, source: question.source, stem: question.stem,
  options: question.options, subject: question.subject, topic: question.topic, flags: [], usedElsewhere: false };

async function expectA11y(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations).toEqual([]);
}

test('faculty builds and publishes a frozen module through the browser UI', async ({ page }) => {
  let publishedBody: unknown;
  await page.route('**/api/faculty/questions?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [question], nextCursor: null }) }));
  await page.route(`**/api/faculty/modules/${moduleId}/questions`, async (route) => {
    const body = route.request().postDataJSON() as { ids: string[] };
    expect(body.ids).toEqual([question.id]);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ module: {
      ...baseModule, questionCount: 1, revision: 1, selectedQuestions: [selected],
    } }) });
  });
  await page.route(`**/api/faculty/modules/${moduleId}/status`, async (route) => {
    publishedBody = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ module: {
      ...baseModule, status: 'published', questionCount: 1, revision: 2,
      publishedAt: '2030-01-01T09:30:00.000Z', selectedQuestions: [selected],
    } }) });
  });
  await page.goto('/e2e-harness/release?view=builder');
  await expect(page.getByLabel(/Only questions not used/)).toBeChecked();
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('heading', { name: 'Selected questions (1/200)' })).toBeVisible();
  await page.getByRole('button', { name: 'Publish module' }).click();
  await expect(page.getByText('Module published. Its question set and scoring policy are now frozen.')).toBeVisible();
  await expect(page.getByText(`/modules/${shareToken}`)).toBeVisible();
  expect(publishedBody).toEqual({ revision: 1, action: 'publish', acceptReuse: false });
});

test('faculty can compare and save a corrected draft question with a reason', async ({ page }) => {
  let correction: unknown = null;
  await page.route(`**/api/faculty/modules/${moduleId}/questions/question-1/correction`, (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ source: { stem: 'Original clinical question?', options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
        correctOption: 1, explanation: null }, current: null, history: [] }) });
    correction = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ module: {
      ...baseModule, revision: 2, questionCount: 1, selectedQuestions: [{ ...selected,
        stem: 'Corrected clinical question?', correctOption: 2, correctionVersion: 1 }],
    } }) });
  });
  await page.goto('/e2e-harness/release?view=correction');
  await page.getByRole('button', { name: 'Correct question' }).click();
  await expect(page.getByRole('complementary', { name: 'Original source version' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Question text', exact: true }).fill('Corrected clinical question?');
  await page.getByRole('combobox', { name: 'Correct option' }).selectOption('2');
  await page.getByRole('textbox', { name: 'Correction reason (required)' }).fill('Source answer key is incorrect.');
  await page.getByRole('button', { name: 'Save global correction' }).click();
  await expect(page.getByText('Correction saved to the question pool and current draft.')).toBeVisible();
  expect(correction).toMatchObject({ revision: 1, expectedVersion: 0, stem: 'Corrected clinical question?',
    correctOption: 2, reason: 'Source answer key is incorrect.' });
  await expectA11y(page);
});

test('unauthenticated privileged and attempt APIs fail closed', async ({ request }) => {
  expect((await request.get('/api/faculty/analytics')).status()).toBe(403);
  expect((await request.get('/api/module-attempts/1de98e87-5a44-4d58-9a42-85ff6418c89b')).status()).toBe(404);
  expect((await request.delete('/api/me/account', { data: { email: 'x@example.org' } })).status()).toBe(401);
});

test('account-deletion failure remains understandable and accessible', async ({ page }) => {
  await page.route('**/api/me/account', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Account deletion failed. Try again.' }) }));
  await page.goto('/e2e-harness/release?view=account');
  await page.getByLabel(/Type faculty@example.org/).fill('faculty@example.org');
  await page.getByRole('button', { name: 'Permanently delete account' }).click();
  await expect(page.getByText('Account deletion failed. Try again.', { exact: true })).toBeVisible();
  await expectA11y(page);
});

test('successful account deletion clears browser data and signs out', async ({ page }) => {
  await page.route('**/api/me/account', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ deleted: true }),
  }));
  await page.goto('/e2e-harness/release?view=account');
  await page.evaluate(() => {
    localStorage.setItem('release-local', 'private');
    sessionStorage.setItem('release-session', 'private');
  });
  await page.getByLabel(/Type faculty@example.org/).fill('faculty@example.org');
  await page.getByRole('button', { name: 'Permanently delete account' }).click();
  await page.waitForURL('**/login?deleted=1');
  expect(await page.evaluate(() => ({ local: localStorage.getItem('release-local'), session: sessionStorage.getItem('release-session') })))
    .toEqual({ local: null, session: null });
});

test('student landing blocks another attempt after the configured limit', async ({ page }) => {
  await page.goto('/e2e-harness/release?view=attempt-limit');
  await expect(page.getByText('1 of 1 used')).toBeVisible();
  await expect(page.getByText('You have used all permitted attempts.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start timed attempt' })).toHaveCount(0);
});

for (const entry of [
  { name: 'authentication', path: '/login' },
  { name: 'faculty builder', path: '/e2e-harness/release?view=builder' },
  { name: 'module analytics', path: '/e2e-harness/release?view=analytics' },
  { name: 'overall analytics', path: '/e2e-harness/release?view=overview' },
  { name: 'account deletion', path: '/e2e-harness/release?view=account' },
  { name: 'attempt-limit state', path: '/e2e-harness/release?view=attempt-limit' },
  { name: 'privacy notice', path: '/privacy' },
  { name: 'public deletion guidance', path: '/delete-account' },
] as const) {
  test(`${entry.name} page has no automatically detectable WCAG A/AA violations`, async ({ page }) => {
    if (entry.name === 'faculty builder') {
      await page.route('**/api/faculty/questions?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [question], nextCursor: null }) }));
    }
    await page.goto(entry.path);
    await expectA11y(page);
  });
}

test('key faculty and student pages remain usable at a 360px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const path of ['/e2e-harness/module-attempt', '/e2e-harness/release?view=analytics', '/e2e-harness/release?view=attempt-limit', '/login', '/privacy', '/delete-account']) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expectA11y(page);
  }
});
