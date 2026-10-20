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
  await step('Open your service menu', 'Manage treatments and optional extras together.', async () => {
    await tap(page.getByTestId('owner-nav-services'));
    await ready(page.getByTestId('services-tab-addons'));
  });
  await step('Create a new add-on', 'Give clients another way to personalize a visit.', async () => {
    await tap(page.getByTestId('services-tab-addons'));
    await tap(page.getByRole('button', {
      name: 'New add-on',
      exact: true,
    }));
    await ready(page.getByTestId('addon-create-dialog'));
  });
  await step('Set the extra price & time', 'Keep extra work visible in the appointment total.', async () => {
    await fill(page.getByTestId('addon-create-name'), 'Chrome Finish');
    await fill(page.getByTestId('addon-create-price'), '15');
    await fill(page.getByTestId('addon-create-duration'), '10');
  });
  await step('Choose its services', 'Offer chrome only with compatible treatments.', async () => {
    await tap(page.getByTestId('addon-create-service-video-demo-solo-service-biab-overlay'));
  });
  await step('Save the add-on', 'The extra is saved with its service assignment.', async () => {
    await post(() => tap(page.getByTestId('addon-create-submit')), '/api/salon/add-ons');
    await ready(page.getByText('Chrome Finish', {
      exact: true,
    }).first());
  }, 2500);
  const d = await api('/api/salon/add-ons?salonSlug=atelier-nail-demo');
  evidence.persisted = JSON.stringify(d).includes('Chrome Finish');
  if (!evidence.persisted) {
    throw new Error('Add-on not saved');
  }
};
