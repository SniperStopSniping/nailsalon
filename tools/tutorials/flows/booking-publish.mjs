export default async ({
  page,
  tap,
  ready,
  step,
  post,
  api,
  evidence,
}) => {
  await step('Open Preview & Publish', 'Review the saved draft before it goes live.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Booking Page/,
    }));
    await tap(page.getByRole('link', {
      name: /^Preview & Publish/,
    }));
    await ready(page.getByTestId('booking-page-draft-review'));
  });
  await step('Review your saved changes', 'Check exactly which page settings will be published.', async () => {
    await page.getByTestId('booking-page-draft-review').scrollIntoViewIfNeeded();
  }, 2400);
  await step('Publish the reviewed draft', 'This demo publishes only the isolated local test page.', async () => {
    await post(() => tap(page.getByTestId('booking-page-publish')), '/api/admin/booking-page');
    await ready(page.getByText('No unpublished page changes', {
      exact: true,
    }));
  });
  await step('Check the published result', 'The live page settings now match your saved draft.', async () => {
    const r = await api('/api/admin/booking-page?salonSlug=atelier-nail-demo');
    evidence.state = r;
    if (r.config?.hasDraftChanges || r.content?.hasDraftChanges) {
      throw new Error('Draft still has unpublished changes');
    }
  }, 2500);
  evidence.scope = 'Actual local fixture draft publication only. No hosted or production booking page published.';
};
