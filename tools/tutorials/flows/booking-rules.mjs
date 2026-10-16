export default async ({
  page,
  tap,
  fill,
  ready,
  step,
  post,
  api,
  evidence,
}) => {
  await step('Open booking rules', 'Set practical limits for new online bookings.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Booking Rules & Policies/,
    }));
    await tap(page.getByRole('button', {
      name: /^Booking rules/,
    }));
    await ready(page.getByTestId('minimum-notice-select'));
  });
  await step('Leave time between visits', 'Reserve a buffer for a smoother working day.', async () => {
    await fill(page.locator('input[type=number]:visible').first(), '10');
  });
  await step('Choose minimum notice', 'Give yourself time to prepare for new bookings.', async () => {
    await tap(page.getByTestId('minimum-notice-select'));
    await page.getByTestId('minimum-notice-select').selectOption('120');
  });
  await step('Save your booking rules', 'New available times follow your saved rules.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: 'Save booking rules',
      exact: true,
    })), '/api/admin/salon/settings');
    await ready(page.getByText('Booking rules saved.', {
      exact: true,
    }));
  }, 1700);
  const r = await api('/api/admin/salon/settings?salonSlug=atelier-nail-demo');
  evidence.buffer = r.bookingConfig?.bufferMinutes;
  evidence.notice = r.bookingConfig?.minimumNoticeMinutes;
  if (evidence.buffer !== 10 || evidence.notice !== 120) {
    throw new Error('Booking rules not persisted');
  }
};
