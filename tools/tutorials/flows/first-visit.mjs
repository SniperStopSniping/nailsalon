export default async ({
  page,
  tap,
  ready,
  step,
  post,
  api,
  evidence,
}) => {
  await step('Open your service settings', 'Keep introductory offers beside your menu.', async () => {
    await tap(page.getByTestId('owner-nav-services'));
    await tap(page.getByRole('button', {
      name: 'Advanced Settings',
      exact: true,
    }));
    await tap(page.getByTestId('services-tab-catalog'));
    await ready(page.getByRole('checkbox', {
      name: /^First-visit offer/,
    }));
  });
  await step('Choose the first-visit offer', 'The current offer is 25% for first-time clients.', async () => {
    await tap(page.getByRole('checkbox', {
      name: /^First-visit offer/,
    }));
  });
  await step('Review the menu choices', 'Check your offer before making it available.', async () => {
    await page.getByRole('button', {
      name: 'Save menu display',
      exact: true,
    }).scrollIntoViewIfNeeded();
  }, 2200);
  await step('Save the first-visit offer', 'Eligibility is checked when the client books.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: 'Save menu display',
      exact: true,
    })), '/api/admin/salon/settings');
    await ready(page.getByText('Saved', {
      exact: true,
    }));
  }, 2300);
  const r = await api('/api/admin/salon/settings?salonSlug=atelier-nail-demo');
  evidence.enabled = r.bookingConfig?.firstVisitDiscountEnabled;
  if (!evidence.enabled) {
    throw new Error('First visit offer not enabled');
  }
};
