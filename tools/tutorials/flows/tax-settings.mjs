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
  await step('Open your tax settings', 'Keep checkout calculations consistent.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Payments/,
    }));
    await tap(page.getByRole('button', {
      name: /^Taxes/,
    }));
    await ready(page.getByTestId('payments-tax-enabled'));
  });
  await step('Turn on tax for checkout', 'Use the settings that apply to your business.', async () => {
    if (!(await page.getByTestId('payments-tax-enabled').isChecked())) {
      await tap(page.getByTestId('payments-tax-enabled'));
    }
    await ready(page.getByTestId('payments-tax-name'));
  });
  await step('Enter your tax name and rate', 'Use your own applicable rate; this is sample data.', async () => {
    await fill(page.getByTestId('payments-tax-name'), 'Sample Checkout Tax');
    await fill(page.getByTestId('payments-tax-rate'), '10');
  });
  await step('Save your checkout settings', 'Completed appointments keep their original tax record.', async () => {
    await post(() => tap(page.getByTestId('payments-save')), '/api/admin/salon/settings');
    await ready(page.getByText('Tax and e-Transfer saved.', {
      exact: true,
    }));
  }, 2400);
  evidence.settings = await api('/api/admin/salon/settings?salonSlug=atelier-nail-demo');
  evidence.scope = 'Synthetic example rate only; no tax advice, charge or historical recalculation.';
};
