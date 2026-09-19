import { expect, test } from '@playwright/test';

const settings = {
  googleReviewUrl: 'https://g.page/avery-nails/review',
  delayMinutes: 60,
  messageTemplate: 'Hi {{firstName}}! {{reviewLink}}',
  businessName: 'Avery Nail Studio',
  policy: { mode: 'manual', delayMinutes: 60, repeatCooldownDays: 90 },
  readiness: { status: 'manual', reasons: [] },
};

test('mobile owner can choose the recommendation and save an exact review-automation payload', async ({ page }) => {
  const requests: Array<{ method: string; body: unknown }> = [];
  const unexpected: string[] = [];
  let saved = structuredClone(settings);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3142') {
      unexpected.push(url.toString());
      await route.abort();
      return;
    }
    if (url.pathname !== '/api/admin/review-requests/settings') {
      await route.continue();
      return;
    }
    const body = request.postData() ? request.postDataJSON() : null;
    requests.push({ method: request.method(), body });
    if (request.method() === 'GET') {
      return route.fulfill({ json: { data: saved } });
    }
    saved = { ...saved, ...(body as object), policy: { mode: (body as { automationMode: string }).automationMode, delayMinutes: (body as { delayMinutes: number }).delayMinutes, repeatCooldownDays: (body as { repeatCooldownDays: 90 | 180 | 365 | 'never' }).repeatCooldownDays }, readiness: { status: 'configured', reasons: [] } };
    return route.fulfill({ json: { data: saved } });
  });
  await page.goto('/');

  await expect(page.getByRole('radio', { name: /manual only/i })).toBeChecked();

  await page.getByRole('button', { name: 'Use recommended automation' }).tap();

  await expect(page.getByRole('radio', { name: /after the appointment ends/i })).toBeChecked();
  await expect(page.getByText(/mark the appointment cancelled or no-show before this request sends/i)).toBeVisible();
  await expect(page.getByLabel('Send after')).toHaveValue('60');

  await page.getByRole('button', { name: 'Save review settings' }).tap();

  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();

  await page.getByText('Advanced').tap();

  await expect(page.getByLabel('Repeat-review cooldown')).toHaveValue('90');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const save = page.getByRole('button', { name: 'Saved' });

  expect((await save.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(requests).toContainEqual(expect.objectContaining({ method: 'PATCH', body: expect.objectContaining({ automationMode: 'scheduled_end', delayMinutes: 60, repeatCooldownDays: 90 }) }));
  expect((requests.find(request => request.method === 'PATCH')?.body as object)).not.toHaveProperty('automaticEnabled');
  expect(unexpected).toEqual([]);
});
