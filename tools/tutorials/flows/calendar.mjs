/* eslint-disable unicorn/prefer-dom-node-text-content -- UI recordings read rendered text, excluding hidden templates. */
import { readFile } from 'node:fs/promises';

export default async ({
  page,
  tap,
  ready,
  step,
  evidence,
}) => {
  const saved = JSON.parse(await readFile('docs/tutorials/verification/manual-appointment-evidence.json', 'utf8')).saved;
  await step('Open your calendar', 'See your salon’s bookings in one place.', async () => {
    await tap(page.getByTestId('owner-nav-calendar'));
    await ready(page.getByRole('button', {
      name: 'Monthly',
      exact: true,
    }));
  });
  await step('Choose your view', 'Use Monthly to move between booking dates.', async () => {
    await tap(page.getByRole('button', {
      name: 'Monthly',
      exact: true,
    }));
    await ready(page.getByTestId('calendar-day-2026-10-20'));
  });
  await step('Open the appointment day', 'Check the client, service and appointment time.', async () => {
    await tap(page.getByTestId('calendar-day-2026-10-20'));
    await ready(page.getByTestId(`day-detail-appointment-${saved.id}`));
  });
  await step('See the visit details', 'Open the booking to manage the appointment.', async () => {
    await tap(page.getByTestId(`day-detail-appointment-${saved.id}`));
    await ready(page.getByRole('button', {
      name: /Details.*Show/,
    }));
  }, 2200);
  evidence.visible = (await page.locator('body').innerText()).includes('Sarah Morgan');
  if (!evidence.visible) {
    throw new Error('Expected client not shown');
  }
};
