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
    throw new Error('Synthetic client missing');
  }
  await step('Open your client’s controls', 'Respect an individual client’s review preferences.', async () => {
    await tap(page.getByTestId('owner-nav-clients'));
    await tap(page.getByTestId('clients-directory-scroll').getByText('Emma Taylor', {
      exact: true,
    }));
    await tap(page.getByRole('button', {
      name: 'Client controls',
      exact: true,
    }));
    await ready(page.getByRole('checkbox', {
      name: 'Do not send review requests',
    }));
  });
  await step('Pause review requests', 'Skip future review requests for this client.', async () => {
    const box = page.getByRole('checkbox', {
      name: 'Do not send review requests',
    });
    if (await box.isChecked()) {
      throw new Error('Already suppressed; preserve previous choice');
    }
    await post(() => tap(box), `/api/admin/clients/${id}/review-requests`);
  });
  await step('Check the saved preference', 'A request already sending may still arrive.', async () => {
    await ready(page.getByText('Future requests are skipped. A request already sending may still arrive.', {
      exact: true,
    }));
  }, 2400);
  await step('Keep their history intact', 'This choice does not remove appointments or payments.', null, 2300);
  evidence.saved = await api(`/api/admin/clients/${id}/review-requests?salonSlug=atelier-nail-demo`);
  if (evidence.saved.data.reviewRequestsSuppressed !== true) {
    throw new Error('Suppression not saved');
  }
  evidence.scope = 'Actual per-client suppression saved; no review request sent.';
};
