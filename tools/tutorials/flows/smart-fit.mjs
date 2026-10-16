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
  await step('Open Smart Fit', 'Offer discounts on times that reduce schedule gaps.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Marketing & Messages/,
    }));
    await tap(page.getByTestId('marketing-home-offers'));
    await tap(page.getByRole('button', {
      name: /^Smart Fit/,
    }));
    await ready(page.getByTestId('smart-fit-enabled'));
  });
  await step('Turn on Smart Fit', 'Clients still choose and confirm their own time.', async () => {
    await tap(page.getByTestId('smart-fit-enabled'));
  });
  await step('Choose your discount', 'Set the offer and the gap it must improve.', async () => {
    await fill(page.getByTestId('smart-fit-value'), '12');
  });
  await step('Save your settings', 'Offers appear only when a slot meets your rules.', async () => {
    await post(() => tap(page.getByTestId('smart-fit-save')), '/api/admin/salon/settings');
    await ready(page.getByTestId('smart-fit-saved'));
  }, 2300);
  const r = await api('/api/admin/salon/settings?salonSlug=atelier-nail-demo');
  evidence.smartFit = r.smartFit;
  evidence.scope = 'Settings saved. No eligible discounted customer slot demonstrated.';
  if (!JSON.stringify(r).includes('"value":12')) {
    throw new Error('Smart Fit not saved');
  }
};
