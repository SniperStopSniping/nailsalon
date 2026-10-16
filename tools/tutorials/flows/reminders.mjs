export default async ({
  page,
  tap,
  ready,
  step,
  post,
  api,
  evidence,
}) => {
  await step('Open appointment messages', 'Choose when clients receive a visit reminder.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Marketing & Messages/,
    }));
    await tap(page.getByTestId('marketing-home-appointment-messages'));
    await ready(page.getByLabel('Reminder 1 timing'));
  });
  await step('Choose the reminder time', 'Match the timing to your salon’s routine.', async () => {
    await tap(page.getByLabel('Reminder 1 timing'));
    await page.getByLabel('Reminder 1 timing').selectOption('240');
  });
  await step('Choose the channel', 'Text delivery requires access, consent and credits.', async () => {
    await tap(page.getByLabel('Reminder 1 channel'));
    await page.getByLabel('Reminder 1 channel').selectOption('email');
  });
  await step('Save the reminder rules', 'Preferences can be saved while delivery is paused.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: 'Save communication settings',
      exact: true,
    })), '/api/admin/salon/settings');
    await ready(page.getByText('Saved', {
      exact: true,
    }));
  }, 2300);
  evidence.settings = await api('/api/admin/salon/settings?salonSlug=atelier-nail-demo');
  evidence.scope = 'Setup only; communications kill switch retained and providers absent. No delivery demonstrated.';
};
