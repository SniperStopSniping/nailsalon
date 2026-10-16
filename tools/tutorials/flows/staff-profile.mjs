export const salon = 'atelier-nail-demo-salon';
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
  const before = await api('/api/admin/technicians?salonSlug=atelier-nail-demo-salon');
  if (JSON.stringify(before).includes('Alex Rivera')) {
    throw new Error('Existing synthetic technician preserved; use saved evidence');
  }
  await step('Add a technician profile', 'Manage your team from your owner workspace.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Team/,
    }));
    await tap(page.getByRole('button', {
      name: /^Team Members/,
    }));
    await tap(page.getByRole('button', {
      name: 'Add',
      exact: true,
    }));
    await ready(page.getByRole('dialog', {
      name: 'Add Staff',
    }));
  });
  await step('Enter the technician’s details', 'Keep a clear name and contact details in one place.', async () => {
    await fill(page.locator('#add-staff-name'), 'Alex Rivera');
    await fill(page.locator('#add-staff-email'), 'alex.rivera@example.invalid');
    await fill(page.locator('#add-staff-phone'), '4165550187');
  });
  await step('Review role and commission', 'Choose settings that match your salon’s arrangements.', async () => {
    await page.getByRole('slider', {
      name: 'Commission rate percentage',
    }).scrollIntoViewIfNeeded();
  });
  await step('Save the team member', 'Set their schedule and services from this profile.', async () => {
    await post(() => tap(page.getByRole('dialog', {
      name: 'Add Staff',
    }).getByRole('button', {
      name: 'Add',
      exact: true,
    })), '/api/admin/technicians');
    await ready(page.getByRole('button', {
      name: 'Open Alex Rivera',
      exact: true,
    }));
  }, 2500);
  evidence.saved = await api('/api/admin/technicians?salonSlug=atelier-nail-demo-salon');
  if (!JSON.stringify(evidence.saved).includes('Alex Rivera')) {
    throw new Error('Technician was not saved');
  }
  evidence.scope = 'Actual owner-managed profile; no staff login, invitation, email or payment.';
};
