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
  await step('Open your clients', 'Keep contact details in your own salon directory.', async () => {
    await tap(page.getByTestId('owner-nav-clients'));
    await ready(page.getByTestId('clients-add-action'));
  });
  await step('Add a new client', 'Create their profile before their first visit.', async () => {
    await tap(page.getByTestId('clients-add-action'));
    await ready(page.getByTestId('add-client-dialog'));
  });
  await step('Enter their details', 'Reuse contact details for future appointments.', async () => {
    await fill(page.getByRole('textbox', {
      name: 'First name',
      exact: true,
    }), 'Emma');
    await fill(page.getByRole('textbox', {
      name: 'Last name',
      exact: true,
    }), 'Taylor');
    await fill(page.getByRole('textbox', {
      name: 'Phone',
      exact: true,
    }), '4165550191');
  });
  await step('Save the client', 'Keep their details ready for their next appointment.', async () => {
    const saved = await post(() => tap(page.getByTestId('add-client-save')), '/api/admin/clients');
    evidence.saved = JSON.parse(JSON.stringify(saved, (k, v) => /token|manageUrl/i.test(k) ? undefined : v));
    await ready(page.getByText('Emma Taylor', {
      exact: true,
    }).first());
  }, 2500);
  evidence.directory = await api('/api/admin/clients?salonSlug=atelier-nail-demo&search=Emma&limit=8&page=1');
  if (!JSON.stringify(evidence.directory).includes('Emma Taylor')) {
    throw new Error('New client did not persist');
  }
};
