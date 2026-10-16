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
  await step('Open deposit settings', 'Prepare your salon’s fixed booking deposit.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Payments/,
    }));
    await tap(page.getByRole('button', {
      name: /^Deposits/,
    }));
    await ready(page.getByTestId('deposits-amount'));
  });
  await step('Choose the deposit amount', 'Set the amount clients will see when setup is ready.', async () => {
    await fill(page.getByTestId('deposits-amount'), '20');
  });
  await step('Review the setup requirements', 'Connect a ready payment account before enabling deposits.', async () => {
    await page.getByTestId('deposits-prerequisites').scrollIntoViewIfNeeded();
  }, 2300);
  await step('Save your deposit setup', 'Collection waits until your payment account is ready.', async () => {
    await post(() => tap(page.getByTestId('deposits-save')), '/api/admin/salon/settings');
    await ready(page.getByText('Deposits saved.', {
      exact: true,
    }));
  }, 2400);
  evidence.settings = await api('/api/admin/salon/settings?salonSlug=atelier-nail-demo');
  evidence.scope = 'Saved setup only; Stripe is not connected and no deposit was collected.';
};
