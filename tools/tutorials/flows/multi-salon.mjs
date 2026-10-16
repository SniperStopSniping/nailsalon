export default async ({
  page,
  tap,
  ready,
  step,
  evidence,
}) => {
  await step('Open your salon switcher', 'Keep each salon’s workspace separate.', async () => {
    await tap(page.getByRole('button', {
      name: 'Switch salon',
      exact: true,
    }));
    await ready(page.getByText('Your Luster salons', {
      exact: true,
    }));
  });
  await step('Choose your other salon', 'Open the dashboard for the salon you want to manage.', async () => {
    const card = page.locator('section.luster-entry-card').filter({
      has: page.locator('a[href*="/atelier-nail-demo-salon"]'),
    });
    await tap(card.getByRole('button', {
      name: 'Open dashboard',
      exact: true,
    }));
    await ready(page.getByTestId('owner-nav-more'));
  });
  await step('Check the active workspace', 'The selected salon determines the tools and records.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await ready(page.getByRole('button', {
      name: /^Team/,
    }));
  });
  await step('Manage the right salon', 'Here the team workspace includes technician tools.', null, 2400);
  evidence.url = page.url();
  if (!page.url().includes('atelier-nail-demo-salon')) {
    throw new Error('Expected synthetic team salon not selected');
  }
  evidence.scope = 'Same development owner authorized at both synthetic salons; names deliberately match, so the exact listed salon URL identifies the selection.';
};
