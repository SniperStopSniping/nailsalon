export default async ({
  page,
  tap,
  ready,
  step,
  post,
  api,
  evidence,
}) => {
  await step('Open booking approval', 'Choose how new online appointments are confirmed.', async () => {
    await tap(page.getByTestId('owner-nav-services'));
    await tap(page.getByTestId('services-tab-approval'));
    await tap(page.getByRole('button', {
      name: /^Booking rules/,
    }));
    await ready(page.getByLabel('Booking confirmation'));
  });
  await step('Choose to review each request', 'New requests reserve a time while they await approval.', async () => {
    await tap(page.getByLabel('Booking confirmation'));
    await page.getByLabel('Booking confirmation').selectOption('request_approval');
  });
  await step('Review what will change', 'Existing appointments keep their current status.', async () => {
    await page.getByLabel('Booking confirmation').scrollIntoViewIfNeeded();
  }, 2400);
  await step('Save the approval setting', 'New online bookings now wait for your review.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: 'Save booking rules',
      exact: true,
    })), '/api/admin/salon/settings');
    await ready(page.getByText('Booking rules saved.', {
      exact: true,
    }));
  }, 2500);
  evidence.settings = await api('/api/admin/salon/settings?salonSlug=atelier-nail-demo');
  if (evidence.settings.bookingConfig.confirmationMode !== 'request_approval') {
    throw new Error('Global approval not saved');
  }
  evidence.scope = 'Actual supported salon-wide approval setting saved. Inactive per-service catalog modes are hidden and preserved.';
};
