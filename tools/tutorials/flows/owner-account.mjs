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
  await step('Open your owner account', 'Keep your name clear in the salon workspace.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Settings/,
    }));
    await tap(page.getByRole('button', {
      name: /^Account/,
    }));
    await ready(page.getByRole('textbox', {
      name: 'Name',
      exact: true,
    }));
  });
  await step('Update your display name', 'Use a name your salon team can recognize.', async () => {
    await fill(page.getByRole('textbox', {
      name: 'Name',
      exact: true,
    }), 'Atelier Demo Owner');
  });
  await step('Save your owner profile', 'Your sign-in email stays protected.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: 'Save profile',
      exact: true,
    })), '/api/admin/profile');
    await ready(page.getByText('Profile saved.', {
      exact: true,
    }));
  }, 2300);
  await step('Review your saved details', 'Keep account details separate from public salon details.', async () => {
    await page.getByRole('textbox', {
      name: 'Name',
      exact: true,
    }).scrollIntoViewIfNeeded();
  }, 2400);
  evidence.saved = await api('/api/admin/profile');
  if (!JSON.stringify(evidence.saved).includes('Atelier Demo Owner')) {
    throw new Error('Owner name not saved');
  }
  evidence.scope = 'Actual synthetic owner display-name update; no authentication or email change.';
};
