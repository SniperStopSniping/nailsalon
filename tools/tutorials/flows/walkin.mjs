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
  await step('Open Quick Walk-in', 'Keep walk-in visits in the same appointment calendar.', async () => {
    await tap(page.getByTestId('quick-action-walk-in'));
    await ready(page.getByRole('button', {
      name: /^Classic Manicure/,
    }));
  });
  await step('Choose the treatment', 'Luster uses its duration to find available times.', async () => {
    await tap(page.getByRole('button', {
      name: /^Classic Manicure/,
    }));
    await tap(page.getByRole('button', {
      name: 'Choose a time',
      exact: true,
    }));
    await ready(page.getByRole('button', {
      name: '9:30 AM',
      exact: true,
    }));
  });
  await step('Pick an available time', 'Reserve a time that fits today’s working hours.', async () => {
    await tap(page.getByRole('button', {
      name: '9:30 AM',
      exact: true,
    }));
    await ready(page.getByLabel('Phone Number *'));
  });
  await step('Add the client details', 'Use a clear name and the right contact number.', async () => {
    await fill(page.getByLabel('Phone Number *'), '4165550188');
    await fill(page.getByLabel('Client Name (optional)'), 'Ava Baker');
  });
  await step('Save the walk-in booking', 'The visit appears in your salon’s Today view.', async () => {
    const r = await post(() => tap(page.getByRole('button', {
      name: 'Book Walk-in Now',
      exact: true,
    })), '/api/appointments', true);
    evidence.saved = {
      id: r.data.appointmentId,
      status: r.data.appointment.status,
      startTime: r.data.appointment.startTime,
    };
    await ready(page.getByTestId('owner-current-next-appointment').getByText('Ava Baker', {
      exact: true,
    }));
  }, 2500);
  const r = await api(`/api/appointments/${evidence.saved.id}/manage?salonSlug=atelier-nail-demo`);
  if (r.data.appointment.clientName !== 'Ava Baker') {
    throw new Error('Walk-in not saved');
  }
};
