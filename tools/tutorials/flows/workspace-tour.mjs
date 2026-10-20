export default async ({
  page,
  tap,
  ready,
  step,
  evidence,
}) => {
  await step('Replay your workspace tour', 'A quick guide helps you find the everyday tools.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Help & Resources/,
    }));
    await tap(page.getByRole('button', {
      name: /^Workspace tour/,
    }));
    await ready(page.getByRole('dialog', {
      name: 'Your day at a glance',
    }));
  });
  await step('Find your calendar', 'See the tour point out the booking calendar.', async () => {
    await tap(page.getByRole('dialog').getByRole('button', {
      name: 'Next',
      exact: true,
    }));
  });
  await step('Keep client history handy', 'Use Clients for profiles, visits and follow-ups.', async () => {
    await tap(page.getByRole('dialog').getByRole('button', {
      name: 'Next',
      exact: true,
    }));
  });
  await step('Manage your service menu', 'Keep treatments, prices and optional extras together.', async () => {
    await tap(page.getByRole('dialog').getByRole('button', {
      name: 'Next',
      exact: true,
    }));
  });
  await step('Find the rest in More', 'Open business, messaging and website tools here.', async () => {
    await tap(page.getByRole('dialog').getByRole('button', {
      name: 'Next',
      exact: true,
    }));
  });
  await step('Finish and get started', 'Replay the tour whenever you need a refresher.', async () => {
    await tap(page.getByRole('dialog').getByRole('button', {
      name: /Done|Finish|Got it/,
    }));
    await page.getByRole('dialog', {
      name: /More/,
    }).waitFor({
      state: 'hidden',
    });
  }, 2400);
  evidence.scope = 'Actual five-step owner tour replayed; no onboarding data reset.';
};
