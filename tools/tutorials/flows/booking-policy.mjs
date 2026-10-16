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
  await step('Open your booking policy', 'Keep your appointment terms in one place.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Booking Rules & Policies/,
    }));
    await tap(page.getByRole('button', {
      name: /^Client policies/,
    }));
    await ready(page.getByLabel('Full policy text'));
  });
  await step('Write clear appointment terms', 'Help clients know what to expect before booking.', async () => {
    await fill(page.getByLabel('Full policy text'), 'Please arrive on time. If your plans change, use your secure booking link or contact the salon as soon as possible.');
  });
  await step('Review the acknowledgement', 'Ask clients to confirm the policy before booking.', async () => {
    await page.getByLabel('Acknowledgment wording').scrollIntoViewIfNeeded();
  }, 2200);
  await step('Save the policy', 'The saved policy appears in your selected places.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: 'Save booking policy',
      exact: true,
    })), '/api/admin/salon/settings');
    await ready(page.getByText('Booking policy saved.', {
      exact: true,
    }));
  }, 2200);
  evidence.settings = await api('/api/admin/salon/settings?salonSlug=atelier-nail-demo');
};
