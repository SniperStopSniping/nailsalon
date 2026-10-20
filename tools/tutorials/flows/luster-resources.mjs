export default async ({
  page,
  tap,
  ready,
  step,
  evidence,
}) => {
  await step('Find Luster learning resources', 'Open practical education from your salon workspace.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Help & Resources/,
    }));
    await tap(page.getByRole('button', {
      name: /^Luster resources/,
    }));
    await ready(page.getByRole('heading', {
      name: 'Luster for Nail Artists',
    }));
  });
  await step('Browse products and education', 'Useful Luster Studio links are gathered in one place.', async () => {
    await page.getByRole('heading', {
      name: 'Shop',
      exact: true,
    }).scrollIntoViewIfNeeded();
  }, 2400);
  await step('Choose the guide you need', 'Find topics such as preparation, retention and removal.', async () => {
    await page.getByText('Nail Preparation and Retention', {
      exact: true,
    }).scrollIntoViewIfNeeded();
  }, 2400);
  await step('Review your email preference', 'Owner updates are separate from client consent.', async () => {
    await page.getByRole('checkbox').scrollIntoViewIfNeeded();
  }, 2400);
  evidence.scope = 'Read-only real resource index and owner-consent control. External guides, purchases and marketing email delivery not demonstrated.';
};
