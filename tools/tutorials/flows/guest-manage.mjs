import { readFile } from 'node:fs/promises';

const appointmentId = 'appt_2d1ca743-7fa3-4db6-939c-b4a73339be2c';
export default async ({
  page,
  ctx,
  origin,
  tap,
  ready,
  step,
  post,
  navigate,
  api,
  evidence,
}) => {
  let manageUrl;
  await step('Find the booked visit', 'Clients can manage a visit through a secure link.', async () => {
    await tap(page.getByTestId('owner-nav-clients'));
    await tap(page.getByTestId('clients-directory-scroll').getByText('Sarah Morgan', {
      exact: true,
    }));
    await tap(page.getByRole('combobox', {
      name: 'Client profile section',
    }));
    await page.getByRole('combobox', {
      name: 'Client profile section',
    }).selectOption('appointments');
    await tap(page.getByTestId(`client-appointment-change-${appointmentId}`));
    await ready(page.getByRole('button', {
      name: /Details.*Show/,
    }));
  });
  await step('Prepare their secure link', 'Luster prepares the details; this demo sends no message.', async () => {
    await tap(page.getByRole('button', {
      name: /Details.*Show/,
    }));
    const result = await post(() => tap(page.getByRole('button', {
      name: 'Send details',
      exact: true,
    })), `/api/appointments/${appointmentId}/manage-link`, true);
    manageUrl = result.data?.manageUrl;
    if (!manageUrl || new URL(manageUrl).origin !== origin) {
      throw new Error('Local secure manage link missing');
    }
    await ready(page.getByText('Did you send the appointment details?', {
      exact: true,
    }));
    await tap(page.getByRole('button', {
      name: 'Not sent',
      exact: true,
    }));
  });
  await step('Client chooses a new time', 'Now showing the customer’s secure appointment link.', async () => {
    await ctx.clearCookies();
    await navigate(manageUrl, page.getByRole('link', {
      name: 'Choose a new time',
      exact: true,
    }));
    await tap(page.getByRole('link', {
      name: 'Choose a new time',
      exact: true,
    }));
    await ready(page.getByRole('button', {
      name: '22',
      exact: true,
    }));
  });
  await step('Choose a date and time', 'The existing service and technician stay together.', async () => {
    await tap(page.getByRole('button', {
      name: '22',
      exact: true,
    }));
    await ready(page.getByRole('button', {
      name: '9:00 AM',
      exact: true,
    }));
    await tap(page.getByRole('button', {
      name: '9:00 AM',
      exact: true,
    }));
  });
  await step('Confirm the new time', 'The saved visit moves without creating another booking.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: 'Confirm new time',
      exact: true,
    })), `/api/public/appointments/manage/${new URL(manageUrl).pathname.split('/').at(-1)}`);
    await ready(page.getByRole('heading', {
      name: 'Your appointment has been moved',
      exact: true,
    }));
  }, 2500);
  await step('Check the saved appointment', 'The secure link now shows the saved time.', async () => {
    await tap(page.getByRole('link', {
      name: 'Back to my appointment',
      exact: true,
    }));
    await ready(page.getByRole('link', {
      name: 'Choose a new time',
      exact: true,
    }));
  }, 2400);
  const state = JSON.parse(await readFile('local/video-runtime/owner-state.json', 'utf8'));
  await ctx.addCookies(state.cookies);
  await page.goto(`${origin}/en/admin?salon=atelier-nail-demo`, {
    waitUntil: 'domcontentloaded',
  });
  await ready(page.getByRole('button', {
    name: 'New Appointment',
    exact: true,
  }));
  const detail = await api(`/api/appointments/${appointmentId}/manage?salonSlug=atelier-nail-demo`);
  evidence.saved = {
    id: detail.data.appointment.id,
    status: detail.data.appointment.status,
    startTime: detail.data.appointment.startTime,
  };
  if (evidence.saved.startTime !== '2026-10-22T13:00:00.000Z') {
    throw new Error('Reschedule did not persist');
  }
  evidence.scope = 'Actual owner-prepared secure link and guest reschedule of an existing synthetic visit. No message sent; token intentionally omitted.';
};
