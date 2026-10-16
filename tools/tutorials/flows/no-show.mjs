export default async ({
  page,
  tap,
  ready,
  step,
  post,
  api,
  evidence,
}) => {
  await step('Open the appointment', 'The client has confirmed they cannot attend.', async () => {
    await tap(page.getByTestId('owner-current-next-appointment').getByRole('button', {
      name: /BIAB Overlay/,
    }));
    await ready(page.getByRole('button', {
      name: /Details.*Show/,
    }));
  });
  await step('Choose Mark No-Show', 'Reporting opens 24 hours before the visit.', async () => {
    await tap(page.getByRole('button', {
      name: /Details.*Show/,
    }));
    await ready(page.getByRole('button', {
      name: 'Mark no-show',
      exact: true,
    }));
    await tap(page.getByRole('button', {
      name: 'Mark no-show',
      exact: true,
    }));
    await ready(page.getByRole('alertdialog'));
  });
  await step('Select the correct reason', 'Use confirmed nonattendance before the visit.', async () => {
    await tap(page.getByRole('radio', {
      name: /Customer confirmed/,
    }));
  });
  await step('Confirm the report', 'Eligible reports update the shared history.', async () => {
    const result = await post(() => tap(page.getByRole('button', {
      name: 'Confirm no-show',
      exact: true,
    })), '/api/appointments/video-library-confirmed-nonattendance-1/cancel', true);
    evidence.sharing = result.data?.noShowSharing;
    if (evidence.sharing !== 'shared') {
      throw new Error('Expected eligible report was not shared');
    }
    await ready(page.getByText('No-show saved', {
      exact: true,
    }));
    await ready(page.getByText(/now shared with participating/));
  }, 2500);
  await step('Recorded, with safeguards', 'Private notes stay local; reports can be corrected.', null, 2500);
  const d = await api('/api/appointments/video-library-confirmed-nonattendance-1/manage?salonSlug=atelier-nail-demo');
  evidence.status = d.data?.appointment?.status;
  if (evidence.status !== 'no_show') {
    throw new Error('No-show not saved');
  }
};
