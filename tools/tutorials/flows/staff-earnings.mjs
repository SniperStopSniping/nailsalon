export const salon = 'atelier-nail-demo-salon';
export default async ({
  page,
  tap,
  ready,
  step,
  evidence,
}) => {
  await step('Open team earnings', 'Review technician earnings from the owner workspace.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Team/,
    }));
    await tap(page.getByRole('button', {
      name: /^Earnings/,
    }));
    await ready(page.getByRole('button', {
      name: 'Open Daniela Rossi',
      exact: true,
    }));
  });
  await step('Choose the technician', 'Keep each person’s records separate.', async () => {
    await tap(page.getByRole('button', {
      name: 'Open Daniela Rossi',
      exact: true,
    }));
    await ready(page.getByRole('button', {
      name: 'Week',
      exact: true,
    }));
  });
  await step('Change the reporting period', 'Switch between daily, weekly and monthly totals.', async () => {
    await tap(page.getByRole('button', {
      name: 'Week',
      exact: true,
    }));
    await ready(page.getByText('Technician earned', {
      exact: true,
    }));
  }, 2300);
  await step('Check revenue and commission', 'A new salon shows zero until relevant work is recorded.', async () => {
    await page.getByText('Technician earned', {
      exact: true,
    }).scrollIntoViewIfNeeded();
  }, 2300);
  evidence.scope = 'Read-only real earnings UI with an honest zero-data example; payouts and nonzero commission calculations not demonstrated.';
};
