export default async ({
  page,
  tap,
  ready,
  step,
  post,
  api,
  evidence,
}) => {
  await step('Open your service menu', 'Start with useful treatments, then make them yours.', async () => {
    await tap(page.getByTestId('owner-nav-services'));
    await ready(page.getByTestId('library-intro-open'));
  });
  await step('Browse the service library', 'Choose a treatment your salon actually offers.', async () => {
    await tap(page.getByTestId('library-intro-open'));
    await ready(page.getByTestId('library-add-luster_manicure'));
  });
  await step('Review the treatment', 'Check the suggested name, price and duration.', async () => {
    await tap(page.getByTestId('library-add-luster_manicure'));
    await ready(page.getByLabel('Price', {
      exact: true,
    }));
  });
  await step('Save it to your menu', 'Your price and timing remain editable.', async () => {
    evidence.result = await post(() => tap(page.getByRole('button', {
      name: 'Save Service',
      exact: true,
    })), '/api/salon/services');
    await ready(page.getByTestId('service-detail-edit'));
  }, 2300);
  const r = await api('/api/salon/services?salonSlug=atelier-nail-demo');
  evidence.saved = JSON.stringify(r).includes('Luster Manicure');
  if (!evidence.saved) {
    throw new Error('Library service not persisted');
  }
};
