export const salon = 'atelier-nail-demo-salon';
export default async ({
  page,
  tap,
  ready,
  step,
  post,
  api,
  evidence,
}) => {
  await step('Open your team', 'Manage technician hours from your owner account.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Team/,
    }));
    await ready(page.getByRole('button', {
      name: /^Working Hours/,
    }));
  });
  await step('Choose a technician', 'Keep each person’s regular schedule separate.', async () => {
    await tap(page.getByRole('button', {
      name: /^Working Hours/,
    }));
    await ready(page.getByLabel('Whose schedule?'));
    await tap(page.getByLabel('Whose schedule?'));
    await page.getByLabel('Whose schedule?').selectOption('video-demo-team-tech-daniela-rossi');
  });
  await step('Adjust the weekly shift', 'Available booking times follow this schedule.', async () => {
    await tap(page.getByLabel('Monday end time'));
    await page.getByLabel('Monday end time').selectOption('17:00');
  });
  await step('Save the schedule', 'Your technician’s working hours are now saved.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: 'Save Schedule',
      exact: true,
    })), '/api/admin/technicians/video-demo-team-tech-daniela-rossi');
    await ready(page.getByRole('button', {
      name: 'Saved',
      exact: true,
    }));
  }, 1600);
  evidence.result = await api('/api/admin/technicians/video-demo-team-tech-daniela-rossi?salonSlug=atelier-nail-demo-salon');
  if (!JSON.stringify(evidence.result).includes('17:00')) {
    throw new Error('Staff schedule not persisted');
  }
};
