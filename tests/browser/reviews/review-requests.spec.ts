import { expect, test } from '@playwright/test';

type ReviewState = {
  status: 'eligible' | 'scheduled' | 'sent' | 'suppressed' | 'failed';
  reason: string | null;
  scheduledFor: string | null;
  sentAt: string | null;
  message: string | null;
  phone: string | null;
  clientId: string | null;
};

const reviewUrl = 'https://www.google.com/maps/place/Avery+Lee+Nail+Studio/review?utm_source=luster-mobile-preview';
const settings = {
  googleReviewUrl: reviewUrl,
  automaticEnabled: false,
  delayMinutes: 60,
  messageTemplate: 'Hi {{firstName}}! Thanks for visiting {{businessName}}. Please leave a Google review: {{reviewLink}}',
  businessName: 'Avery Lee Nail Studio',
};

function action(state: ReviewState['status'], overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    status: state,
    reason: null,
    scheduledFor: state === 'scheduled' ? '2026-09-12T20:30:00.000Z' : null,
    sentAt: state === 'sent' ? '2026-09-12T20:31:00.000Z' : null,
    message: 'Avery Lee Nail Studio via Luster: Hi Avery! Thanks for visiting Avery Lee Nail Studio. Please leave a Google review: https://www.google.com/maps/place/Avery+Lee+Nail+Studio/review?utm_source=luster-mobile-preview Reply STOP to opt out.',
    phone: '(416) 555-0199',
    clientId: 'review-client',
    ...overrides,
  };
}

// This uses the real production components and CSS in a Vite harness. Every
// endpoint is synthetic and asserted below; it cannot contact a Next server,
// Clerk, Postgres, or an SMS provider.
test('mobile owner can edit settings, queue Send now once, then see sent and suppression states', async ({ page }) => {
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const unexpected: string[] = [];
  const browserErrors: string[] = [];
  let savedSettings = { ...settings };
  let reviewState: ReviewState = action('scheduled');
  let suppressed = false;

  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(message.text());
    }
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3128') {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    const body = request.postData() ? request.postDataJSON() : null;
    requests.push({ method: request.method(), path: `${url.pathname}${url.search}`, body });
    if (url.pathname === '/api/admin/review-requests/settings' && request.method() === 'GET') {
      await route.fulfill({ json: { data: savedSettings } });
      return;
    }
    if (url.pathname === '/api/admin/review-requests/settings' && request.method() === 'PATCH') {
      savedSettings = { ...savedSettings, ...(body as Omit<typeof settings, 'businessName'>) };
      await route.fulfill({ json: { data: savedSettings } });
      return;
    }
    if (url.pathname === '/api/appointments/review-appointment/review-request' && request.method() === 'GET') {
      await route.fulfill({ json: { data: reviewState } });
      return;
    }
    if (url.pathname === '/api/appointments/review-appointment/review-request' && request.method() === 'POST') {
      reviewState = action('scheduled', { scheduledFor: '2026-09-12T19:32:00.000Z' });
      await route.fulfill({ status: 202, json: { data: reviewState } });
      return;
    }
    if (url.pathname === '/api/admin/clients/review-client/review-requests' && request.method() === 'GET') {
      await route.fulfill({ json: { data: { reviewRequestsSuppressed: suppressed } } });
      return;
    }
    if (url.pathname === '/api/admin/clients/review-client/review-requests' && request.method() === 'PATCH') {
      suppressed = Boolean((body as { reviewRequestsSuppressed: boolean }).reviewRequestsSuppressed);
      reviewState = action('suppressed', { reason: 'This client has review requests turned off.', message: null });
      await route.fulfill({ json: { data: { reviewRequestsSuppressed: suppressed } } });
      return;
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({ status: 404, json: { error: 'Unknown browser fixture endpoint' } });
  });

  await page.goto('/');

  await expect(page.getByTestId('review-request-settings')).toBeVisible();
  await expect(page.getByLabel('Google review link')).toHaveValue(reviewUrl);
  await expect(page.getByText(/Avery Lee Nail Studio via Luster: Hi Avery! Thanks for visiting Avery Lee Nail Studio/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Test link' })).toHaveAttribute('href', reviewUrl);

  await expect(page.getByRole('radio', { name: /manual only/i })).toBeChecked();

  await page.getByRole('radio', { name: /after the appointment ends/i }).check();

  await expect(page.getByText(/mark the appointment cancelled or no-show before this request sends/i)).toBeVisible();

  await expect(page.getByLabel('Send after')).toHaveValue('60');

  await page.getByLabel('Send after').selectOption('120');
  await page.getByRole('button', { name: 'Save review settings' }).tap();

  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();

  const scheduled = page.getByRole('button', { name: 'Review request scheduled' });

  await expect(scheduled).toBeEnabled();

  const scheduledBox = await scheduled.boundingBox();

  expect(scheduledBox?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await scheduled.tap();

  await expect(page.getByRole('dialog', { name: 'Send review request' })).toBeVisible();
  await expect(page.getByText('(416) 555-0199')).toBeVisible();
  await expect(page.getByText('Message preview')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send now' })).toHaveCount(1);

  await expect(page.getByRole('dialog', { name: 'Send review request' }).getByText('Reply STOP to opt out.', { exact: false })).toBeVisible();

  await page.screenshot({ path: test.info().outputPath('review-request-confirmation.png'), fullPage: true });

  await page.getByRole('button', { name: 'Send now' }).tap();

  await expect(page.getByRole('button', { name: 'Review request scheduled' })).toBeVisible();

  // This represents dispatcher/message-history confirmation after the queued
  // intent has delivered. Reload exercises the status endpoint afresh.
  reviewState = action('sent');
  await page.reload();

  await expect(page.getByRole('button', { name: 'Review requested' })).toBeDisabled();
  await expect(page.getByText(/Sent Sep 12/)).toBeVisible();

  await page.getByRole('checkbox', { name: 'Do not send review requests' }).click();

  await expect(page.getByText('Pending review requests are cancelled.')).toBeVisible();

  await page.reload();

  await expect(page.getByRole('button', { name: 'Review requests off' })).toBeDisabled();
  await expect(page.getByText('This client has review requests turned off.')).toBeVisible();

  await page.screenshot({ path: test.info().outputPath('review-requests-mobile-states.png'), fullPage: true });

  expect(requests.filter(request => request.method === 'POST' && request.path.startsWith('/api/appointments/'))).toHaveLength(1);
  expect(requests).toContainEqual(expect.objectContaining({ method: 'PATCH', path: '/api/admin/review-requests/settings?salonSlug=review-fixture', body: expect.objectContaining({ automationMode: 'scheduled_end', delayMinutes: 120, repeatCooldownDays: 'never' }) }));
  expect(requests).toContainEqual(expect.objectContaining({ method: 'PATCH', path: '/api/admin/clients/review-client/review-requests?salonSlug=review-fixture', body: { reviewRequestsSuppressed: true } }));
  expect(unexpected).toEqual([]);
  expect(browserErrors).toEqual([]);
});

test('mobile review action makes blocked-credit and failed delivery states explicit', async ({ page }) => {
  let state: ReviewState = action('scheduled', { reason: 'Add SMS credits to send this review request.' });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/review-requests/settings') {
      return route.fulfill({ json: { data: settings } });
    }
    if (url.pathname === '/api/appointments/review-appointment/review-request') {
      return route.fulfill({ json: { data: state } });
    }
    if (url.pathname === '/api/admin/clients/review-client/review-requests') {
      return route.fulfill({ json: { data: { reviewRequestsSuppressed: false } } });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto('/');

  await expect(page.getByText('Add SMS credits to send this review request.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review request scheduled' })).toBeEnabled();

  state = action('failed', { reason: 'The review request could not be sent. It will not be retried automatically.' });
  await page.reload();

  await expect(page.getByRole('button', { name: 'Review request failed' })).toBeDisabled();
  await expect(page.getByText('The review request could not be sent. It will not be retried automatically.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.screenshot({ path: test.info().outputPath('review-request-blocked-and-failed.png'), fullPage: true });
});
