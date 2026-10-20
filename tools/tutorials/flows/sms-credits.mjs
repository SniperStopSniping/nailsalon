/* eslint-disable unicorn/prefer-dom-node-text-content -- UI recordings read rendered text, excluding hidden templates. */
export default async ({
  page,
  tap,
  ready,
  step,
  api,
  evidence,
}) => {
  await step('Open Usage & SMS', 'Keep optional texting costs easy to understand.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Usage & SMS/,
    }));
    await ready(page.getByRole('button', {
      name: /^SMS credits & top-ups/,
    }));
  });
  await step('Check your text balance', 'See remaining credits and message history.', async () => {
    await tap(page.getByRole('button', {
      name: /^SMS credits & top-ups/,
    }));
    await ready(page.getByText('100 SMS credits remaining', {
      exact: true,
    }));
  });
  await step('100 starter SMS credits', 'Eligible verified owners can claim the allowance once.', async () => {
    await page.getByText('100 SMS credits remaining', {
      exact: true,
    }).scrollIntoViewIfNeeded();
  }, 2400);
  await step('Core booking stays free', 'Extra SMS credits are optional one-time purchases.', async () => {
    await page.getByText('Core booking is free', {
      exact: true,
    }).scrollIntoViewIfNeeded();
  }, 2400);
  evidence.copy = await page.getByRole('dialog').last().innerText();
  if (!evidence.copy.includes('100 starter SMS credits') || !evidence.copy.includes('No mandatory monthly subscription')) {
    throw new Error('Incorrect billing model copy');
  }
  evidence.usage = await api('/api/admin/salon/communications/usage?salonSlug=atelier-nail-demo');
  evidence.scope = 'Actual 100-credit balance after the separately verified one-time starter grant; no purchase or message sent.';
};
