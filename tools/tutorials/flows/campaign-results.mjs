export default async ({
  page,
  tap,
  ready,
  step,
  evidence,
  api,
}) => {
  await step('Open your outreach results', 'Separate measured activity from assumed outcomes.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Marketing & Messages/,
    }));
    await tap(page.getByTestId('marketing-home-results'));
    await ready(page.getByTestId('marketing-results-outreach'));
  });
  await step('Review manual outreach', 'Opening a draft is different from marking a text sent.', async () => {
    await page.getByTestId('marketing-results-outreach').scrollIntoViewIfNeeded();
  }, 2400);
  await step('Check win-back results', 'A new salon shows an honest empty state.', async () => {
    await page.getByTestId('marketing-results-campaigns').scrollIntoViewIfNeeded();
  }, 2400);
  await step('Check automatic messages', 'Failed email attempts are visible for follow-up.', async () => {
    await page.getByTestId('marketing-results-automatic').scrollIntoViewIfNeeded();
  }, 2400);
  evidence.overview = await api('/api/admin/marketing?salonSlug=atelier-nail-demo');
  evidence.scope = 'Actual measured and empty results shown, including disabled-provider failures. No fabricated message delivery, attributed booking or campaign revenue.';
};
