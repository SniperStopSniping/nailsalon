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
  await step('Open Owner & Staff Alerts', 'Choose which booking updates reach your team.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Settings/,
    }));
    await tap(page.getByRole('button', {
      name: /^Owner & Staff Alerts/,
    }));
    await ready(page.getByLabel('Salon notification email address'));
  });
  await step('Set your notification address', 'Keep booking updates in the right inbox.', async () => {
    await fill(page.getByLabel('Salon notification email address'), 'owner@atelier-demo.example.invalid');
  });
  await step('Review the email events', 'Choose the updates your salon needs to receive.', async () => {
    await page.getByLabel('New booking emails').scrollIntoViewIfNeeded();
  }, 2300);
  await step('Save the notification settings', 'Delivery still needs a connected email service.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: 'Save notifications',
      exact: true,
    })), '/api/admin/salon/settings');
    await ready(page.getByText('Appointment notifications saved.', {
      exact: true,
    }));
  }, 2300);
  evidence.settings = await api('/api/admin/salon/settings?salonSlug=atelier-nail-demo');
  evidence.scope = 'Synthetic notification recipient saved; no email or SMS sent.';
};
