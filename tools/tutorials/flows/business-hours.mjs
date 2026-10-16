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
  await step('Open Hours & Availability', 'Keep your public hours easy for clients to find.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Hours & Availability/,
    }));
    await ready(page.getByTestId('information-hours-monday-close'));
  });
  await step('Set your opening hours', 'Choose the days and times your salon is open.', async () => {
    await fill(page.getByTestId('information-hours-monday-close'), '18:30');
  });
  await step('Check the salon timezone', 'Hours and available times follow this timezone.', async () => {
    await page.getByTestId('information-timezone').scrollIntoViewIfNeeded();
  }, 2200);
  await step('Save your public hours', 'Staff schedules still control bookable times.', async () => {
    await post(() => tap(page.getByTestId('information-save-hours')), '/api/admin/salon/information');
    await ready(page.getByText('Hours saved. Bookable times still follow each staff member’s schedule.', {
      exact: true,
    }));
  }, 2200);
  const r = await api('/api/admin/salon/information?salonSlug=atelier-nail-demo');
  evidence.persisted = JSON.stringify(r).includes('18:30');
  if (!evidence.persisted) {
    throw new Error('Hours not persisted');
  }
};
