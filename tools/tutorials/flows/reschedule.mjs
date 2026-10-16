import { readFile } from 'node:fs/promises';

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
  const saved = JSON.parse(await readFile('docs/tutorials/versions/manual-rehearsal/evidence.json', 'utf8')).saved;
  await step('Find the appointment', 'Open the client whose booking needs to move.', async () => {
    await tap(page.getByTestId('owner-nav-clients'));
    await ready(page.getByText('Sarah Morgan', {
      exact: true,
    }).first());
    await tap(page.getByText('Sarah Morgan', {
      exact: true,
    }).first());
    await ready(page.getByRole('combobox', {
      name: 'Client profile section',
      exact: true,
    }));
  });
  await step('Open their bookings', 'Keep past and upcoming appointments together.', async () => {
    await tap(page.getByRole('combobox', {
      name: 'Client profile section',
      exact: true,
    }));
    await page.getByRole('combobox', {
      name: 'Client profile section',
      exact: true,
    }).selectOption('appointments');
    await ready(page.getByTestId(`client-appointment-change-${saved.id}`));
    await tap(page.getByTestId(`client-appointment-change-${saved.id}`));
    await ready(page.getByTestId('appointment-sheet-edit-reschedule'));
  });
  await step('Choose a new time', 'Adjust the booking without creating a duplicate.', async () => {
    await tap(page.getByTestId('appointment-sheet-edit-reschedule'));
    await ready(page.getByTestId('appointment-sheet-start-time'));
    await fill(page.getByTestId('appointment-sheet-start-time'), '2026-10-19T16:00');
  });
  await step('Save the new time', 'Luster checks availability before saving the move.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: 'Save changes',
      exact: true,
    })), `/api/appointments/${saved.id}/manage`);
    await ready(page.getByTestId('appointment-sheet-edit-reschedule'));
  }, 2300);
  const data = await api(`/api/appointments/${saved.id}/manage?salonSlug=atelier-nail-demo`);
  evidence.updatedStart = JSON.stringify(data).includes('2026-10-19T20:00:00');
  if (!evidence.updatedStart) {
    throw new Error('The new time did not persist');
  }
};
