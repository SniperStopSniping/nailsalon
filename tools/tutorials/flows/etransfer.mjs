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
  await step('Open payment methods', 'Give clients clear manual payment instructions.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Payments/,
    }));
    await tap(page.getByRole('button', {
      name: /^Payment Methods/,
    }));
    await ready(page.getByTestId('payments-etransfer-enabled'));
  });
  await step('Choose e-Transfer', 'You confirm the payment when it reaches your bank.', async () => {
    await tap(page.getByTestId('payments-etransfer-enabled'));
    await ready(page.getByTestId('payments-etransfer-recipient'));
  });
  await step('Add the recipient details', 'Use the address clients should send payment to.', async () => {
    await fill(page.getByTestId('payments-etransfer-recipient'), 'payments@atelier-demo.example.invalid');
  });
  await step('Save the instructions', 'Luster never asks for your banking password.', async () => {
    await post(() => tap(page.getByTestId('payments-save')), '/api/admin/salon/settings');
    await ready(page.getByText('Tax and e-Transfer saved.', {
      exact: true,
    }));
  }, 2400);
  evidence.settings = await api('/api/admin/salon/settings?salonSlug=atelier-nail-demo');
  evidence.scope = 'Synthetic recipient; no bank transfer created or verified.';
};
