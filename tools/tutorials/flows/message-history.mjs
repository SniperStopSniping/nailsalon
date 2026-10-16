export default async ({
  page,
  tap,
  ready,
  step,
  evidence,
}) => {
  await step('Open your message history', 'Review text activity beside your credit balance.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Usage & SMS/,
    }));
    await tap(page.getByRole('button', {
      name: /^SMS credits & top-ups/,
    }));
    await ready(page.getByLabel('Filter message history'));
  });
  await step('Choose the message type', 'Filter confirmations, reminders and cancellations.', async () => {
    await tap(page.getByLabel('Filter message history'));
    await page.getByLabel('Filter message history').selectOption('confirmations');
  });
  await step('Review the recorded activity', 'A new salon starts with an empty message history.', async () => {
    await ready(page.getByText('No messages yet.', {
      exact: true,
    }));
  }, 2400);
  await step('Check history as you grow', 'Delivery records can be reviewed when messages exist.', null, 2400);
  evidence.scope = 'Real empty state and filter verified. No message delivery or credit debit demonstrated.';
};
