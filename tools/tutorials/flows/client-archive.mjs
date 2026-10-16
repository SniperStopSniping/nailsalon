/* eslint-disable unicorn/prefer-dom-node-text-content -- UI recordings read rendered text, excluding hidden templates. */
export default async ({
  page,
  tap,
  ready,
  step,
  api,
  evidence,
}) => {
  const d = await api('/api/admin/clients?salonSlug=atelier-nail-demo&search=Emma');
  const id = d.data.clients.find(c => c.fullName === 'Emma Taylor' && c.phone === '4165550191')?.id;
  if (!id) {
    throw new Error('Active synthetic Emma record missing');
  }
  await step('Open the client’s controls', 'Keep your active client list tidy without deleting history.', async () => {
    await tap(page.getByTestId('owner-nav-clients'));
    await tap(page.getByTestId('clients-directory-scroll').getByText('Emma Taylor', {
      exact: true,
    }));
    await tap(page.getByRole('button', {
      name: 'Client controls',
      exact: true,
    }));
    await ready(page.getByTestId('client-more-actions-toggle'));
  });
  await step('Choose Archive client', 'Use archive for a client you no longer manage actively.', async () => {
    await tap(page.getByTestId('client-more-actions-toggle'));
    await tap(page.getByTestId('client-archive-action'));
    await ready(page.getByTestId('client-archive-dialog'));
  });
  await step('Review before archiving', 'Read what will change and what history stays saved.', async () => {
    await page.getByTestId('client-archive-dialog').scrollIntoViewIfNeeded();
  }, 2400);
  await step('Confirm the archive', 'Appointments and payment records remain preserved.', async () => {
    await tap(page.getByTestId('client-archive-confirm'));
    await ready(page.getByTestId('client-lifecycle-success'));
  }, 2500);
  evidence.notice = await page.getByTestId('client-lifecycle-success').innerText();
  const checkout = await api('/api/appointments/video-library-checkout-emma-1/checkout?salonSlug=atelier-nail-demo');
  if (checkout.data.appointment.status !== 'completed' || checkout.data.balance.balanceCents !== 0) {
    throw new Error('Historical invoice changed');
  }
  evidence.preservedInvoice = {
    status: checkout.data.appointment.status,
    balanceCents: checkout.data.balance.balanceCents,
  };
  evidence.scope = 'Actual synthetic client archive. Completed cash invoice and historical appointment preserved, not deleted.';
};
