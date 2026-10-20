import { readFile } from 'node:fs/promises';

export default async ({
  page,
  tap,
  ready,
  step,
  post,
  api,
  evidence,
}) => {
  const id = JSON.parse(await readFile('docs/tutorials/verification/online-booking-evidence.json', 'utf8')).saved.id;
  await step('Find the client’s booking', 'Keep the cancellation linked to the right visit.', async () => {
    await tap(page.getByTestId('owner-nav-clients'));
    await ready(page.getByTestId('clients-directory-scroll').getByText('Nora Evans', {
      exact: true,
    }));
    await tap(page.getByTestId('clients-directory-scroll').getByText('Nora Evans', {
      exact: true,
    }));
    await ready(page.getByRole('combobox', {
      name: 'Client profile section',
    }));
  });
  await step('Open the appointment', 'Review the booking before changing its status.', async () => {
    await tap(page.getByRole('combobox', {
      name: 'Client profile section',
    }));
    await page.getByRole('combobox', {
      name: 'Client profile section',
    }).selectOption('appointments');
    await tap(page.getByTestId(`client-appointment-change-${id}`));
    await ready(page.getByRole('button', {
      name: /Details.*Show/,
    }));
  });
  await step('Choose Cancel appointment', 'An ordinary cancellation is separate from a no-show.', async () => {
    await tap(page.getByTestId('appointment-sheet-cancel').first());
    await ready(page.getByRole('alertdialog'));
  });
  await step('Confirm the cancellation', 'The saved cancellation frees the appointment time.', async () => {
    evidence.result = await post(() => tap(page.getByRole('alertdialog').getByRole('button', {
      name: 'Cancel appointment',
      exact: true,
    })), `/api/appointments/${id}/cancel`);
    await ready(page.getByRole('combobox', {
      name: 'Client profile section',
    }));
  }, 2300);
  const d = await api(`/api/appointments/${id}/manage?salonSlug=atelier-nail-demo`);
  evidence.status = d.data.appointment.status;
  evidence.reason = d.data.appointment.cancelReason;
  if (evidence.status !== 'cancelled' || evidence.reason === 'no_show') {
    throw new Error('Ordinary cancellation was not preserved');
  }
};
