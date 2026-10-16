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
  const d = await api('/api/admin/clients?salonSlug=atelier-nail-demo&search=Emma');
  const id = d.data.clients.find(c => c.fullName === 'Emma Taylor' && c.phone === '4165550191')?.id;
  if (!id) {
    throw new Error('Synthetic client missing');
  }
  await step('Open client controls', 'Keep useful private context with the client’s history.', async () => {
    await tap(page.getByTestId('owner-nav-clients'));
    await tap(page.getByTestId('clients-directory-scroll').getByText('Emma Taylor', {
      exact: true,
    }));
    await tap(page.getByRole('button', {
      name: 'Client controls',
      exact: true,
    }));
    await ready(page.getByRole('checkbox', {
      name: 'Important client flag',
    }));
  });
  await step('Add an important client flag', 'Only your salon can see this private flag.', async () => {
    const box = page.getByRole('checkbox', {
      name: 'Important client flag',
    });
    if (!(await box.isChecked())) {
      await tap(box);
    }
    await ready(page.getByRole('textbox', {
      name: 'Private flag note',
    }));
  });
  await step('Keep the note clear and fair', 'Record useful facts rather than assumptions.', async () => {
    await fill(page.getByRole('textbox', {
      name: 'Private flag note',
    }), 'Confirm treatment details and preferred finish before booking.');
  });
  await step('Save the private flag', 'The client can still book unless you choose otherwise.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: 'Save status',
      exact: true,
    })), `/api/admin/clients/${id}/flag`);
    await page.getByRole('button', {
      name: 'Save status',
      exact: true,
    }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Save status' && b.disabled), {}, {
      timeout: 15000,
    });
  }, 2400);
  evidence.saved = await api(`/api/admin/clients/${id}/flag?salonSlug=atelier-nail-demo`);
  const value = JSON.stringify(evidence.saved);
  if (!value.includes('Confirm treatment details and preferred finish')) {
    throw new Error('Flag note did not persist');
  }
  if (evidence.saved.data.client.isBlocked) {
    throw new Error('Flag accidentally blocked client');
  }
  evidence.scope = 'Actual local private flag. No shared report and no booking block.';
};
