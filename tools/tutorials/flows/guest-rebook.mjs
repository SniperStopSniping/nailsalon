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
  await step('Encourage the next booking', 'Add a rebooking prompt to the confirmation page.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Marketing & Messages/,
    }));
    await tap(page.getByTestId('marketing-home-rebooking-prompt'));
    await ready(page.getByRole('switch', {
      name: 'Turn on Rebooking Prompt',
    }));
  });
  await step('Choose the return interval', 'Suggest a visit when your client is likely to need it.', async () => {
    const s = page.getByRole('switch', {
      name: 'Turn on Rebooking Prompt',
    });
    if ((await s.getAttribute('aria-checked')) !== 'true') {
      await tap(s);
    }
    await fill(page.locator('#rebooking-interval'), '3');
  });
  await step('Write your invitation', 'Keep the next step friendly and easy to understand.', async () => {
    await fill(page.locator('#rebooking-message'), 'Ready for your next set? Choose your next visit in three weeks.');
  });
  await step('Save the rebooking prompt', 'Your confirmation page can now invite the next visit.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: 'Save Rebooking Prompt',
      exact: true,
    })), '/api/admin/rebooking-prompt');
    await ready(page.getByText('Rebooking Prompt saved.', {
      exact: true,
    }));
  }, 2400);
  evidence.saved = await api('/api/admin/rebooking-prompt?salonSlug=atelier-nail-demo');
  if (evidence.saved.data.settings.intervalWeeks !== 3 || !evidence.saved.data.settings.enabled) {
    throw new Error('Prompt not saved');
  }
  evidence.scope = 'Actual saved confirmation-page prompt settings. Customer rebooking and message delivery are not demonstrated.';
};
