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
  await step('Open your calendar', 'Keep bookings and your availability together.', async () => {
    await tap(page.getByTestId('owner-nav-calendar'));
    await ready(page.getByRole('button', {
      name: 'Monthly',
      exact: true,
    }));
  });
  await step('Choose Block Time', 'Protect breaks without changing existing bookings.', async () => {
    await tap(page.getByTestId('calendar-availability-menu').locator('summary'));
    await tap(page.getByRole('button', {
      name: 'Block Time',
      exact: true,
    }));
    await ready(page.getByTestId('calendar-block-time'));
  });
  await step('Set your break', 'Choose the day, start time and end time.', async () => {
    await fill(page.getByLabel('Date', {
      exact: true,
    }), '2026-10-21');
    await fill(page.getByLabel('Start time', {
      exact: true,
    }), '12:00');
    await fill(page.getByLabel('End time', {
      exact: true,
    }), '13:00');
  });
  await step('Add a private label', 'Clients see unavailable time, not your reason.', async () => {
    await fill(page.getByLabel('Label (optional)'), 'Lunch break');
  });
  await step('Save your blocked time', 'Keep this hour out of online availability.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: 'Block time',
      exact: true,
    })), '/api/admin/calendar-blocks');
    await ready(page.getByText('Lunch break', {
      exact: true,
    }));
  }, 2500);
  evidence.blocks = await api('/api/admin/calendar-blocks?salonSlug=atelier-nail-demo&date=2026-10-21');
  if (!JSON.stringify(evidence.blocks).includes('Lunch break')) {
    throw new Error('Block did not persist');
  }
};
