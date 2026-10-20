/* eslint-disable unicorn/prefer-dom-node-text-content -- UI recordings read rendered text, excluding hidden templates. */
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
  await step('Open Services & Skills', 'Choose which treatments each technician performs.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Team/,
    }));
    await tap(page.getByRole('button', {
      name: /^Services & Skills/,
    }));
    await ready(page.getByRole('button', {
      name: 'Open Marie Dupont',
      exact: true,
    }));
  });
  await step('Choose the technician', 'Their service list controls booking choices.', async () => {
    await tap(page.getByRole('button', {
      name: 'Open Marie Dupont',
      exact: true,
    }));
    await ready(page.getByRole('button', {
      name: /^Gel-X Full Set/,
    }));
  });
  await step('Update their treatments', 'Only tick services this technician can perform.', async () => {
    await tap(page.getByRole('button', {
      name: /^Gel-X Full Set/,
    }));
  });
  await step('Save the service list', 'Clients see the technician’s enabled treatments.', async () => {
    evidence.result = await post(() => tap(page.getByRole('button', {
      name: 'Save Changes',
      exact: true,
    })), '/api/admin/technicians/video-demo-team-tech-marie-dupont/services');
    await ready(page.getByTestId('staff-services-feedback'));
  }, 2500);
  evidence.feedback = await page.getByTestId('staff-services-feedback').innerText();
  if (!evidence.feedback.includes('Service list saved')) {
    throw new Error('Assignments not saved');
  }
  const r = await api('/api/admin/technicians/video-demo-team-tech-marie-dupont/services?salonSlug=atelier-nail-demo-salon');
  evidence.enabledServiceIds = r.data.services.filter(x => x.enabled).map(x => x.serviceId);
};
