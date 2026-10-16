export default async ({
  page,
  tap,
  ready,
  step,
  post,
  api,
  evidence,
}) => {
  const directory = await api('/api/admin/clients?salonSlug=atelier-nail-demo&search=Emma');
  const id = directory.data.clients.find(c => c.fullName === 'Emma Taylor' && c.phone === '4165550191')?.id;
  if (!id) {
    throw new Error('Synthetic Emma identity not found');
  }
  await step('Open the client profile', 'Keep personal preferences ready for the next visit.', async () => {
    await tap(page.getByTestId('owner-nav-clients'));
    await tap(page.getByTestId('clients-directory-scroll').getByText('Emma Taylor', {
      exact: true,
    }));
    await ready(page.getByRole('combobox', {
      name: 'Client profile section',
    }));
  });
  await step('Choose Preferences', 'Record the details that help personalize the visit.', async () => {
    await tap(page.getByRole('combobox', {
      name: 'Client profile section',
    }));
    await page.getByRole('combobox', {
      name: 'Client profile section',
    }).selectOption('preferences');
    await ready(page.getByLabel('Preferred artist'));
  });
  const previous = await page.getByLabel('Preferred artist').inputValue();
  const chosen = previous ? '' : 'video-demo-solo-tech-marie-dupont';
  await step('Update their preferred artist', chosen ? 'Remember who your client likes to book with.' : 'Choose No preference when any artist is fine.', async () => {
    await tap(page.getByLabel('Preferred artist'));
    await page.getByLabel('Preferred artist').selectOption(chosen);
  });
  await step('Save the client details', 'Keep the saved preference with their profile.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: 'Save details',
      exact: true,
    })), `/api/admin/clients/${id}`);
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Save details' && b.disabled));
  }, 2300);
  await step('Review the saved preference', 'Keep this choice handy before the next visit.', async () => {
    await page.getByLabel('Preferred artist').scrollIntoViewIfNeeded();
  }, 2300);
  const d = await api(`/api/admin/clients/${id}?salonSlug=atelier-nail-demo`);
  evidence.artist = d.data.client.preferredTechnician?.id;
  if ((evidence.artist ?? '') !== chosen) {
    throw new Error('Artist preference did not persist');
  }
};
