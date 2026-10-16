export default async ({
  page,
  tap,
  ready,
  step,
  post,
  api,
  evidence,
}) => {
  await step('Open What Clients See', 'Choose how much location detail to show publicly.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Booking Page/,
    }));
    await tap(page.getByRole('link', {
      name: /^What Clients See/,
    }));
    await ready(page.getByTestId('information-location'));
  });
  await step('Open your location display', 'Your exact address stays saved for appointments.', async () => {
    await tap(page.getByTestId('information-location').locator('summary'));
    await ready(page.getByTestId('address-privacy-after_booking'));
  });
  await step('Reveal it after booking', 'Browsing clients see the city; confirmed clients get details.', async () => {
    await post(() => tap(page.getByTestId('address-privacy-after_booking')), '/api/admin/booking-page');
  });
  await step('Review the saved draft', 'Publish separately to apply this display choice.', async () => {
    await page.getByTestId('address-privacy-after_booking').scrollIntoViewIfNeeded();
  }, 2500);
  evidence.settings = await api('/api/admin/booking-page?salonSlug=atelier-nail-demo');
  if (!JSON.stringify(evidence.settings).includes('after_booking')) {
    throw new Error('Address privacy not saved');
  }
  evidence.scope = 'Draft only; no address or customer record deleted.';
};
