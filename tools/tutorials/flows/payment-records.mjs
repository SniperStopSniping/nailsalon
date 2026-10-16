export default async ({
  page,
  tap,
  ready,
  step,
  evidence,
}) => {
  await step('Open the client profile', 'Keep payments linked to the visit they belong to.', async () => {
    await tap(page.getByTestId('owner-nav-clients'));
    await tap(page.getByTestId('clients-directory-scroll').getByText('Emma Taylor', {
      exact: true,
    }));
    await ready(page.getByRole('combobox', {
      name: 'Client profile section',
    }));
  });
  await step('Choose Payments', 'Review deposits, payments and remaining balances.', async () => {
    await tap(page.getByRole('combobox', {
      name: 'Client profile section',
    }));
    await page.getByRole('combobox', {
      name: 'Client profile section',
    }).selectOption('payments');
    await ready(page.getByTestId('client-payment-appointment-video-library-checkout-emma-1'));
  });
  await step('Review the saved payment', 'This completed visit has a recorded $65 payment.', async () => {
    await page.getByTestId('client-payment-appointment-video-library-checkout-emma-1').scrollIntoViewIfNeeded();
  }, 2300);
  await step('Open the related appointment', 'Keep the payment and treatment history together.', async () => {
    await tap(page.getByTestId('client-payment-appointment-video-library-checkout-emma-1'));
    await ready(page.getByRole('button', {
      name: /Details.*Show/,
    }));
  }, 2300);
  evidence.scope = 'Existing synthetic cash payment viewed; no new charge or refund.';
};
