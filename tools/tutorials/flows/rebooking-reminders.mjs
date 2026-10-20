/* eslint-disable unicorn/prefer-dom-node-text-content -- UI recordings read rendered text, excluding hidden templates. */
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
  await step('Open Marketing & Messages', 'Set up timely invitations for clients to return.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Marketing & Messages/,
    }));
    await ready(page.getByTestId('marketing-home-rebooking-reminders'));
  });
  await step('Choose rebooking reminders', 'Plan follow-ups after the last completed visit.', async () => {
    await tap(page.getByTestId('marketing-home-rebooking-reminders'));
    await ready(page.getByLabel('SMS wording'));
  });
  await step('Choose your interval', 'Match the reminder to your service’s care cycle.', async () => {
    await fill(page.getByLabel('Send after the last completed appointment'), '4');
    await tap(page.getByRole('switch', {
      name: 'Enable rebooking reminders',
    }));
  });
  await step('Check the message cost', 'Try shorter wording and review the SMS preview.', async () => {
    evidence.before = await page.locator('body').innerText();
    await tap(page.getByRole('button', {
      name: 'Try shorter wording',
      exact: true,
    }));
    evidence.after = await page.locator('body').innerText();
  });
  await step('Save your reminders', 'Eligible clients follow your saved timing and text.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: 'Save reminders',
      exact: true,
    })), '/api/admin/rebooking-reminders');
    await ready(page.getByText('Rebooking Reminders saved.', {
      exact: true,
    }));
  }, 2300);
  const d = await api('/api/admin/rebooking-reminders?salonSlug=atelier-nail-demo');
  evidence.persisted = JSON.stringify(d).includes('"enabled":true');
  if (!evidence.persisted) {
    throw new Error('Rebooking setting did not persist');
  }
  evidence.providerDelivery = 'Not demonstrated; local communications remain disabled';
};
