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
  await step('Open the client’s visit', 'Keep checkout linked to the right appointment.', async () => {
    await tap(page.getByTestId('owner-nav-clients'));
    await ready(page.getByTestId('clients-directory-scroll').getByText('Emma Taylor', {
      exact: true,
    }));
    await tap(page.getByTestId('clients-directory-scroll').getByText('Emma Taylor', {
      exact: true,
    }));
    await ready(page.getByRole('combobox', {
      name: 'Client profile section',
    }));
    await tap(page.getByRole('combobox', {
      name: 'Client profile section',
    }));
    await page.getByRole('combobox', {
      name: 'Client profile section',
    }).selectOption('appointments');
  });
  await step('Complete the appointment', 'Review what was performed before finalizing.', async () => {
    await tap(page.getByTestId('client-appointment-change-video-library-checkout-emma-1'));
    await ready(page.getByTestId('appointment-sheet-mark-completed'));
    await tap(page.getByTestId('appointment-sheet-mark-completed'));
    await ready(page.getByTestId('checkout-review-button'));
  });
  await step('Record how they paid', 'Choose Cash for this demonstration payment.', async () => {
    await tap(page.getByTestId('checkout-method-cash'));
    await fill(page.getByTestId('checkout-amount-received'), '65');
  });
  await step('Review the final total', 'Review the items, payment and final balance.', async () => {
    await tap(page.getByTestId('checkout-review-button'));
    await ready(page.getByTestId('checkout-complete-button'));
  });
  await step('Confirm completion', 'Save the invoice and the recorded payment.', async () => {
    await tap(page.getByTestId('checkout-complete-button'));
    const without = page.getByRole('button', {
      name: 'Complete without photo',
      exact: true,
    });
    await ready(without, false);
    await post(() => tap(without), '/api/appointments/video-library-checkout-emma-1/complete');
    await ready(page.getByTestId('checkout-success'));
  }, 2300);
  await step('Keep the finished record', 'The saved visit shows its payment and balance.', null, 2500);
  const d = await api('/api/appointments/video-library-checkout-emma-1/checkout?salonSlug=atelier-nail-demo');
  evidence.completedInvoice = d.data?.appointment?.status === 'completed';
  evidence.paymentStatus = d.data?.appointment?.paymentStatus;
  evidence.balanceCents = d.data?.balance?.balanceCents;
  evidence.recordedPayments = d.data?.payments?.map(p => ({
    method: p.method,
    amountCents: p.amountCents,
  }));
  if (!evidence.completedInvoice) {
    throw new Error('Checkout not persisted');
  }
};
