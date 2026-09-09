import { expect, test } from '@playwright/test';

const readySms = {
  providerReady: true,
  senderMode: 'shared_luster',
  senderLabel: 'Luster shared texting number',
  phoneNumber: null,
  blockingReason: null,
  detail: 'Texting is available.',
  smsEnabled: true,
  automaticEnabled: true,
  manualAvailable: true,
  remindersEnabled: true,
  quietHours: { enabled: true, start: '21:00', end: '09:00' },
  availableCredits: 100,
  workerConfigured: true,
};

const makeMessage = (status: string, canRetry = false) => ({
  id: 'intent-fixture',
  eventType: 'manual_text',
  status,
  message: 'See you tomorrow.',
  recipient: '•••• 0199',
  createdAt: '2026-09-08T14:00:00Z',
  updatedAt: '2026-09-08T14:00:00Z',
  scheduledFor: '2026-09-08T14:05:00Z',
  failureReason: canRetry ? 'This message could not be delivered.' : null,
  canRetry,
});

// Real component and production CSS; all messages APIs are intercepted. Business
// transactions/provider behavior are covered by the separate PGlite route suites.
test('phone composer queues one text under repeated taps and exposes delivery history', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  let history: ReturnType<typeof makeMessage>[] = [];
  let releaseSend: (() => void) | undefined;
  const sendGate = new Promise<void>((resolve) => {
    releaseSend = resolve;
  });
  await page.route('**/api/admin/clients/test-client/messages**', async (route) => {
    if (route.request().method() === 'POST') {
      requests.push(route.request().postDataJSON());
      await sendGate;
      history = [makeMessage('queued')];
      await route.fulfill({ json: { data: { message: history[0] } } });
    } else {
      await route.fulfill({ json: { data: { sms: readySms, history } } });
    }
  });
  await page.goto('/');
  const draft = page.getByRole('textbox', { name: 'Message' });
  await draft.fill('See you tomorrow.');

  await expect(draft).toBeFocused();

  const send = page.getByRole('button', { name: 'Send text', exact: true });
  const box = await send.boundingBox();

  expect(box?.height).toBeGreaterThanOrEqual(44);
  expect(box?.width).toBeGreaterThanOrEqual(44);

  await send.tap();

  await expect(page.getByRole('button', { name: 'Sending…' })).toBeDisabled();

  await page.getByRole('button', { name: 'Sending…' }).dispatchEvent('click');

  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ message: 'See you tomorrow.', appointmentId: 'test-appointment' });

  releaseSend!();

  await expect(page.getByRole('status').filter({ hasText: /^Queued$/ })).toBeVisible();
  await expect(draft).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.screenshot({ path: test.info().outputPath('queued-mobile.png'), fullPage: true });
});

test('phone history retries a proven failure using the original intent and shows delivered', async ({ page }) => {
  let history = [makeMessage('failed', true)];
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/admin/clients/test-client/messages**', async (route) => {
    if (route.request().method() === 'PATCH') {
      requests.push(route.request().postDataJSON());
      history = [makeMessage('delivered')];
      await route.fulfill({ json: { data: { message: history[0] } } });
    } else {
      await route.fulfill({ json: { data: { sms: readySms, history } } });
    }
  });
  await page.goto('/');

  await expect(page.getByText('This message could not be delivered.')).toBeVisible();

  const retry = page.getByRole('button', { name: 'Retry text', exact: true });

  expect((await retry.boundingBox())?.height).toBeGreaterThanOrEqual(44);

  await retry.tap();

  await expect(page.getByRole('status').filter({ hasText: /^Delivered$/ })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ intentId: 'intent-fixture' });
  await expect(page.getByRole('button', { name: 'Retry text', exact: true })).toHaveCount(0);
});

test('phone composer explains unavailable configuration and keeps send disabled', async ({ page }) => {
  await page.route('**/api/admin/clients/test-client/messages**', route => route.fulfill({ json: {
    data: { sms: { ...readySms, manualAvailable: false, detail: 'Text delivery tracking is not configured. Contact support.' }, history: [] },
  } }));
  await page.goto('/');

  await expect(page.getByText('Text delivery tracking is not configured. Contact support.')).toBeVisible();

  await page.getByRole('textbox', { name: 'Message' }).fill('This must not send.');

  await expect(page.getByRole('button', { name: 'Send text', exact: true })).toBeDisabled();

  await page.getByRole('button', { name: 'Close', exact: true }).tap();

  await expect(page.getByRole('region', { name: 'Text client through Luster' })).toHaveCount(0);
  await expect(page.getByText('SMS history', { exact: true })).toBeVisible();
});
