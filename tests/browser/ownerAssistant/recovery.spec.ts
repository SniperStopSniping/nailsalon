import { expect, test } from '@playwright/test';

const question = 'Where do I change my hours?';
const answer = 'Open Hours & Availability to change your working hours.';

test('failed request survives reload with explicit Retry, one question and one answer', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/admin/owner-assistant/chat', async (route) => {
    requests += 1;
    if (requests === 1) {
      await route.abort('internetdisconnected');
    } else {
      await route.continue();
    }
  });
  await page.goto('/');
  await page.getByTestId('owner-assistant-launcher').click();
  await page.getByRole('button', { name: question }).click();

  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();

  await page.reload();
  await page.getByTestId('owner-assistant-launcher').click();

  await expect(page.getByTestId('owner-assistant-banner')).toContainText('Your last question wasn\'t answered.');
  expect(requests).toBe(1);

  const retry = page.getByRole('button', { name: 'Retry', exact: true });

  await expect(retry).toBeVisible();
  await expect.poll(async () => (await retry.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await retry.click();

  await expect(page.getByText(answer, { exact: true })).toBeVisible();
  await expect(page.getByTestId('owner-assistant-thread').getByText(question, { exact: true })).toHaveCount(1);
  await expect(page.getByTestId('owner-assistant-unanswered')).toHaveCount(0);
  expect(requests).toBe(2);

  await expect(page.getByLabel('Message the assistant')).toBeFocused();
});

test('an interrupted question without an error marker remains recoverable', async ({ page }) => {
  await page.addInitScript((message) => {
    sessionStorage.setItem('owner-assistant:v1:synthetic-assistant-salon', JSON.stringify({
      ownerRef: 'synthetic-owner',
      conversation: null,
      messages: [{ id: 'interrupted', role: 'owner', text: message }],
    }));
  }, question);
  await page.goto('/');
  await page.getByTestId('owner-assistant-launcher').click();

  await expect(page.getByTestId('owner-assistant-unanswered')).toBeVisible();

  await page.getByRole('button', { name: 'Retry', exact: true }).click();

  await expect(page.getByText(answer, { exact: true })).toBeVisible();
  await expect(page.getByTestId('owner-assistant-thread').getByText(question, { exact: true })).toHaveCount(1);
});

test('another owner cannot recover the stored question', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('owner-assistant:v1:synthetic-assistant-salon', JSON.stringify({
      ownerRef: 'different-owner',
      conversation: 'private-token',
      messages: [{ id: 'private', role: 'owner', text: 'Another owner private question.', unanswered: true }],
    }));
  });
  await page.goto('/');
  await page.getByTestId('owner-assistant-launcher').click();

  await expect(page.getByText('Another owner private question.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('owner-assistant-empty-state')).toBeVisible();
});
