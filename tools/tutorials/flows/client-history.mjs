/* eslint-disable unicorn/prefer-dom-node-text-content -- UI recordings read rendered text, excluding hidden templates. */
export default async ({
  page,
  tap,
  ready,
  step,
  evidence,
}) => {
  await step('Open your clients', 'Keep your client relationships in one place.', async () => {
    await tap(page.getByTestId('owner-nav-clients'));
    await ready(page.getByTestId('clients-directory-scroll').getByText('Emma Taylor', {
      exact: true,
    }));
  });
  await step('Choose a client', 'Review their profile before their next appointment.', async () => {
    await tap(page.getByTestId('clients-directory-scroll').getByText('Emma Taylor', {
      exact: true,
    }));
    await ready(page.getByRole('combobox', {
      name: 'Client profile section',
    }));
  });
  await step('Review past visits', 'Choose Appointments to see the saved visit history.', async () => {
    await tap(page.getByRole('combobox', {
      name: 'Client profile section',
    }));
    await page.getByRole('combobox', {
      name: 'Client profile section',
    }).selectOption('appointments');
    await ready(page.getByTestId('client-appointment-card-video-library-checkout-emma-1'));
  });
  await step('Keep the full picture', 'See the treatment, date and recorded payment.', async () => {
    await page.getByTestId('client-appointment-card-video-library-checkout-emma-1').scrollIntoViewIfNeeded();
  }, 2400);
  evidence.history = await page.getByTestId('client-appointment-card-video-library-checkout-emma-1').innerText();
  if (!/completed/i.test(evidence.history)) {
    throw new Error('Completed visit not shown');
  }
};
