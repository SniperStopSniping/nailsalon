export default async ({
  page,
  tap,
  ready,
  step,
  post,
  evidence,
}) => {
  const row = page.getByTestId('client-insights-attention-video-demo-solo-client-maya-singh');
  await step('Open Insights & Follow-ups', 'Find clients who may need a personal follow-up.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Marketing & Messages/,
    }));
    await tap(page.getByTestId('marketing-home-followups'));
    await ready(row);
  });
  await step('Review the client’s history', 'Use the recorded reason to choose your next step.', async () => {
    await row.scrollIntoViewIfNeeded();
  }, 2300);
  await step('Snooze a follow-up', 'Move a reminder out of today’s worklist.', async () => {
    evidence.result = await post(() => tap(row.getByRole('button', {
      name: 'Snooze 7 days',
      exact: true,
    })), '/api/admin/retention');
  });
  await step('Keep the worklist focused', 'Outreach is snoozed; payment warnings stay visible.', async () => {
    await row.getByRole('button', {
      name: 'Snooze 7 days',
      exact: true,
    }).waitFor({
      state: 'hidden',
    });
  }, 2300);
  evidence.scope = 'One synthetic follow-up snoozed for seven days. No customer message sent.';
};
