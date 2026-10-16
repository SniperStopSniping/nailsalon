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
  await step('Open Review Requests', 'Ask for honest feedback after an appointment.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Marketing & Messages/,
    }));
    await tap(page.getByTestId('marketing-home-reviews'));
    await ready(page.getByLabel('Google review link'));
  });
  await step('Choose when to ask', 'Request reviews after you complete the visit.', async () => {
    await tap(page.getByRole('radio', {
      name: /After marked completed/,
    }));
  });
  await step('Add your Google review link', 'Use your own salon’s review link here.', async () => {
    await fill(page.getByLabel('Google review link'), 'https://g.page/r/luster-demo/review');
  });
  await step('Keep the request honest', 'Reviews are never tied to rewards or discounts.', async () => {
    await fill(page.getByLabel('Message', {
      exact: true,
    }), 'Thanks for visiting {{businessName}}. Share your honest review: {{reviewLink}}');
  });
  await step('Save your review settings', 'Sending needs consent, access and SMS credits.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: 'Save review settings',
      exact: true,
    })), '/api/admin/review-requests/settings');
    await ready(page.getByRole('button', {
      name: 'Saved',
      exact: true,
    }));
  }, 1800);
  evidence.persisted = await api('/api/admin/review-requests/settings?salonSlug=atelier-nail-demo');
  evidence.scope = 'Setup only. Synthetic review URL is not verified. No request sent.';
};
