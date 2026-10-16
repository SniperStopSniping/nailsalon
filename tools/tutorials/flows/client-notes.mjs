export default async ({
  page,
  tap,
  fill,
  ready,
  step,
  api,
  evidence,
}) => {
  await step('Find your client', 'Keep preferences close to their appointment history.', async () => {
    await tap(page.getByTestId('owner-nav-clients'));
    await ready(page.getByText('Sarah Morgan', {
      exact: true,
    }).first());
    await tap(page.getByText('Sarah Morgan', {
      exact: true,
    }).first());
    await ready(page.getByRole('combobox', {
      name: 'Client profile section',
      exact: true,
    }));
  });
  await step('Open Notes & Photos', 'Record care preferences privately for your salon.', async () => {
    await tap(page.getByRole('combobox', {
      name: 'Client profile section',
      exact: true,
    }));
    await page.getByRole('combobox', {
      name: 'Client profile section',
      exact: true,
    }).selectOption('notes');
    await ready(page.getByRole('textbox', {
      name: 'Private notes',
      exact: true,
    }));
  });
  await step('Remember the little details', 'Keep their preferred shape and finish handy.', async () => {
    await fill(page.getByRole('textbox', {
      name: 'Private notes',
      exact: true,
    }), 'Prefers short almond nails and a sheer pink finish.');
  });
  await step('Save the note', 'Use the saved preference at their next visit.', async () => {
    await tap(page.getByRole('button', {
      name: 'Save note',
      exact: true,
    }));
    await page.getByRole('button', {
      name: 'Save note',
      exact: true,
    }).waitFor();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Save note' && b.disabled));
  }, 2300);
  const d = await api('/api/admin/clients/video-demo-solo-client-sarah-morgan?salonSlug=atelier-nail-demo');
  evidence.notes = JSON.stringify(d).includes('Prefers short almond');
  if (!evidence.notes) {
    throw new Error('Note did not persist');
  }
};
