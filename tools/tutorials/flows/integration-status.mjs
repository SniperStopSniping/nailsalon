export default async ({
  page,
  tap,
  ready,
  step,
  api,
  evidence,
}) => {
  await step('Check your connections', 'See which tools are ready before relying on them.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Integrations/,
    }));
    await ready(page.getByText('Calendar sync is not switched on for your Luster account yet.', {
      exact: true,
    }));
  });
  await step('Review calendar and texting', 'This isolated demo has calendar off and texting paused.', async () => {
    await page.getByText('Google Calendar', {
      exact: true,
    }).scrollIntoViewIfNeeded();
  }, 2400);
  await step('Check email and payments', 'A status label does not mean a message or payment succeeded.', async () => {
    await page.getByText('Payments & Payouts', {
      exact: true,
    }).scrollIntoViewIfNeeded();
  }, 2400);
  await step('Open message settings', 'Keep message preferences in their dedicated workspace.', async () => {
    await tap(page.getByRole('button', {
      name: 'Open Appointment Messages & Reminders',
      exact: true,
    }));
    await ready(page.getByLabel('Reminder 1 timing'));
  }, 2400);
  evidence.health = await api('/api/integrations/health?salonSlug=atelier-nail-demo');
  evidence.scope = 'Real readiness dashboard and navigation. No Google authorization, SMS/email delivery or Stripe connection demonstrated.';
};
