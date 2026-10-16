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
  await step('Open Next Visit Offer', 'Give returning clients a clear reason to rebook.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Marketing & Messages/,
    }));
    await tap(page.getByTestId('marketing-home-offers'));
    await tap(page.getByRole('button', {
      name: /^Next Visit Offer/,
    }));
    await ready(page.getByRole('switch', {
      name: 'Turn on Next Visit Offer',
    }));
  });
  await step('Turn on the offer', 'Eligible completed visits can receive one offer.', async () => {
    await tap(page.getByRole('switch', {
      name: 'Turn on Next Visit Offer',
    }));
    await tap(page.getByRole('button', {
      name: '21 days',
      exact: true,
    }));
  });
  await step('Set the discount', 'Choose a discount that fits your salon’s margin.', async () => {
    await fill(page.getByLabel('Discount percentage', {
      exact: true,
    }), '10');
  });
  await step('Save the offer settings', 'The next visit must take place by the deadline.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: 'Save Next Visit Offer',
      exact: true,
    })), '/api/admin/next-visit-offer');
    await ready(page.getByText('Next Visit Offer saved.', {
      exact: true,
    }));
  }, 2300);
  evidence.settings = await api('/api/admin/next-visit-offer?salonSlug=atelier-nail-demo');
  evidence.scope = 'Settings saved only; no promotional message or redeemed offer demonstrated.';
};
