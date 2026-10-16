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
  await step('Plan your win-back offers', 'Set up offers for clients who have not returned.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Marketing & Messages/,
    }));
    await tap(page.getByTestId('marketing-home-campaigns'));
    await ready(page.getByLabel('Rebook clients after'));
  });
  await step('Set your return timing', 'Choose when a client becomes due for follow-up.', async () => {
    await fill(page.getByLabel('Rebook clients after'), '24');
  });
  await step('Review the offer stages', 'Six- and eight-week offers have separate controls.', async () => {
    await page.getByRole('checkbox', {
      name: 'Enable Six-week win-back',
    }).locator('..').scrollIntoViewIfNeeded();
  }, 2400);
  await step('Save your follow-up settings', 'Review due clients and prepare outreach yourself.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: 'Save marketing settings',
      exact: true,
    })), '/api/admin/retention/settings');
    await ready(page.getByText('Marketing settings saved.', {
      exact: true,
    }));
  }, 2400);
  evidence.saved = await api('/api/admin/retention/settings?salonSlug=atelier-nail-demo');
  evidence.scope = 'Actual saved follow-up timing; offer stages reviewed, no automatic campaign or message sent.';
};
