/* eslint-disable unicorn/prefer-dom-node-text-content -- UI recordings read rendered text, excluding hidden templates. */
export default async ({
  page,
  tap,
  fill,
  ready,
  step,
  post,
  evidence,
}) => {
  await step('Add an appointment', 'Keep phone and in-person bookings together.', async () => {
    await tap(page.getByRole('button', {
      name: 'New Appointment',
      exact: true,
    }));
    await ready(page.getByLabel('Date', {
      exact: true,
    }));
  });
  await step('Choose a day & time', 'Reserve the right time for your client.', async () => {
    await fill(page.getByLabel('Date', {
      exact: true,
    }), '2026-10-20');
    await tap(page.getByRole('button', {
      name: 'Appointment time',
      exact: true,
    }));
    await tap(page.getByRole('button', {
      name: '14:00',
      exact: true,
    }));
  });
  await step('Find your client', 'Reuse their details instead of typing again.', async () => {
    await tap(page.getByRole('button', {
      name: 'Find existing client',
      exact: true,
    }));
    await fill(page.getByLabel('Find an existing client'), 'Sarah');
    await ready(page.getByRole('button', {
      name: /Sarah Morgan/,
    }), false);
    await tap(page.getByRole('button', {
      name: /Sarah Morgan/,
    }));
  });
  await step('Choose the treatment', 'The price and appointment length update together.', async () => {
    await tap(page.getByRole('button', {
      name: /^BIAB Overlay/,
    }));
  });
  await step('Save the appointment', 'Check the summary, then create the booking.', async () => {
    const saved = await post(() => tap(page.getByRole('button', {
      name: 'Create Appointment',
      exact: true,
    })), '/api/appointments', true);
    evidence.saved = {
      id: saved.data.appointmentId,
      startTime: saved.data.appointment.startTime,
      status: saved.data.appointment.status,
    };
    await page.getByLabel('Date', {
      exact: true,
    }).waitFor({
      state: 'hidden',
    });
    await ready(page.getByTestId('appointment-saved-notice'));
  });
  await step('Review the saved booking', 'Find the appointment in your calendar.', async () => {
    await tap(page.getByRole('button', {
      name: 'View calendar',
      exact: true,
    }));
    await ready(page.getByRole('button', {
      name: 'Monthly',
      exact: true,
    }));
    await tap(page.getByRole('button', {
      name: 'Monthly',
      exact: true,
    }));
    await ready(page.getByTestId('calendar-day-2026-10-20'));
    await tap(page.getByTestId('calendar-day-2026-10-20'));
    await ready(page.getByText('Sarah Morgan', {
      exact: true,
    }).last());
  }, 2500);
  evidence.calendar = await page.locator('body').innerText();
  if (!evidence.calendar.includes('Sarah Morgan')) {
    throw new Error('Saved appointment not visible');
  }
};
