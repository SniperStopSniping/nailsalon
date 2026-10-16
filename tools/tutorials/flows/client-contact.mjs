export default async ({
  page,
  tap,
  fill,
  ready,
  step,
  evidence,
}) => {
  await step('Open the client profile', 'Keep the right contact details with each client.', async () => {
    await tap(page.getByTestId('owner-nav-clients'));
    await tap(page.getByTestId('clients-directory-scroll').getByText('Emma Taylor', {
      exact: true,
    }));
    await ready(page.getByTestId('client-text-action'));
  });
  await step('Prepare a client text', 'Review the recipient before writing the message.', async () => {
    await tap(page.getByTestId('client-text-action'));
    await ready(page.getByRole('textbox', {
      name: 'Message',
      exact: true,
    }));
  });
  await step('Write the message', 'Keep it personal, clear and easy to act on.', async () => {
    await fill(page.getByRole('textbox', {
      name: 'Message',
      exact: true,
    }), 'Hi Emma, please contact the salon when you are ready to arrange your next visit.');
  });
  await step('Review before sending', 'This guide stops before sending a message.', async () => {
    await page.getByRole('button', {
      name: 'Send text',
      exact: true,
    }).scrollIntoViewIfNeeded();
  }, 2500);
  evidence.scope = 'Draft prepared only. Luster send is unavailable in this runtime; no text or native Messages app opened.';
  evidence.draft = await page.getByRole('textbox', {
    name: 'Message',
    exact: true,
  }).inputValue();
};
