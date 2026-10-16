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
  await step('Open Business Information', 'Keep the details clients use accurate.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Booking Page/,
    }));
    await tap(page.getByRole('link', {
      name: /^Business Information/,
    }));
    await ready(page.getByTestId('information-contact'));
  });
  await step('Open your contact details', 'Choose how clients can reach your salon.', async () => {
    await tap(page.getByTestId('information-contact').locator('summary'));
    await ready(page.getByTestId('information-phone'));
  });
  await step('Update the salon phone', 'Give clients a clear way to contact you.', async () => {
    await fill(page.getByTestId('information-phone'), '4165550199');
  });
  await step('Save your contact details', 'Business contact changes take effect immediately.', async () => {
    await post(() => tap(page.getByTestId('information-save-contact')), '/api/admin/salon/information');
    await ready(page.getByText('Contact saved. Bookings use it immediately.', {
      exact: true,
    }));
  }, 2300);
  const r = await api('/api/admin/salon/information?salonSlug=atelier-nail-demo');
  evidence.saved = JSON.stringify(r).includes('4165550199');
  if (!evidence.saved) {
    throw new Error('Contact not persisted');
  }
};
