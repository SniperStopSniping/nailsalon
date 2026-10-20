export default async ({
  page,
  tap,
  ready,
  step,
  evidence,
  api,
}) => {
  await step('Review no-show protection', 'Choose how recorded history informs booking deposits.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Payments/,
    }));
    await tap(page.getByRole('button', {
      name: /^Deposits/,
    }));
    await ready(page.getByTestId('no-show-protection-warn_only'));
  });
  await step('Start with warning only', 'View eligible history without a risk-based deposit.', async () => {
    await page.getByTestId('no-show-protection-warn_only').scrollIntoViewIfNeeded();
  }, 2400);
  await step('Review the deposit thresholds', 'You can require a deposit after one or two reports.', async () => {
    await page.getByTestId('no-show-protection-deposit_1').scrollIntoViewIfNeeded();
  }, 2400);
  await step('Complete payment setup first', 'Deposit choices unlock when payment setup is ready.', async () => {
    await page.getByTestId('no-show-protection-deposit_2').scrollIntoViewIfNeeded();
  }, 2400);
  if (!(await page.getByTestId('no-show-protection-deposit_1').isDisabled()) || !(await page.getByTestId('no-show-protection-deposit_2').isDisabled())) {
    throw new Error('Unexpected charge-ready state');
  }
  evidence.settings = await api('/api/admin/salon/settings?salonSlug=atelier-nail-demo');
  evidence.scope = 'Read-only warning/threshold readiness guide. Threshold activation and collection blocked by absent connected Stripe account. No blacklist or automatic charge demonstrated.';
};
