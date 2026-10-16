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
  await step('Open your service menu', 'Keep your treatments, prices and timings together.', async () => {
    await tap(page.getByTestId('owner-nav-services'));
    await ready(page.getByRole('button', {
      name: 'New service',
      exact: true,
    }));
  });
  await step('Add a new service', 'Create a treatment your clients can recognize.', async () => {
    await tap(page.getByRole('button', {
      name: 'New service',
      exact: true,
    }));
    await ready(page.getByLabel('Name', {
      exact: true,
    }));
  });
  await step('Name the treatment', 'Use a clear name: Luster Gel Manicure.', async () => {
    await fill(page.getByLabel('Name', {
      exact: true,
    }), 'Luster Gel Manicure');
  });
  await step('Set the price and duration', 'Give clients the price and time they need to plan.', async () => {
    await fill(page.getByLabel('Price', {
      exact: true,
    }), '55');
    await fill(page.getByLabel('Duration', {
      exact: true,
    }), '60');
  });
  await step('Save the service', 'The treatment is now saved on your menu.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: 'Save Service',
      exact: true,
    })), '/api/salon/services');
    await ready(page.getByTestId('service-detail-edit'));
  }, 2200);
  await step('Edit the price when needed', 'Update the service without recreating your menu.', async () => {
    await tap(page.getByTestId('service-detail-edit'));
    await ready(page.getByLabel('Price', {
      exact: true,
    }));
    await fill(page.getByLabel('Price', {
      exact: true,
    }), '60');
  });
  await step('Save the updated service', 'Future bookings use the saved menu price.', async () => {
    const r = page.waitForResponse(x => new URL(x.url()).pathname.startsWith('/api/salon/services/') && x.request().method() === 'PATCH');
    await tap(page.getByRole('button', {
      name: 'Update Service',
      exact: true,
    }));
    if (!(await r).ok()) {
      throw new Error('Service update refused');
    }
    await ready(page.getByTestId('service-detail-edit'));
  }, 2300);
  const r = await api('/api/salon/services?salonSlug=atelier-nail-demo');
  const service = r.data.services.find(x => x.name === 'Luster Gel Manicure');
  if (!service || service.price !== 6000) {
    throw new Error('Updated service not persisted');
  }
  evidence.saved = {
    id: service.id,
    name: service.name,
    price: service.price,
    duration: service.durationMinutes,
  };
};
