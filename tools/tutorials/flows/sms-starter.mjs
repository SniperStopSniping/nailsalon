export default async ({
  page,
  origin,
  tap,
  ready,
  step,
  post,
  api,
  evidence,
}) => {
  const card = page.getByTestId('sms-balance-card');
  await step('Open your SMS balance', 'Eligible verified owners can claim 100 starter texts.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await ready(card);
    await ready(card.getByRole('button', {
      name: 'Claim 100 free texts',
      exact: true,
    }));
  });
  await step('Check your verification', 'Both your primary email and phone must be verified.', async () => {
    await card.getByLabel('Free text verification').scrollIntoViewIfNeeded();
  }, 2400);
  await step('Claim your 100 starter texts', 'No payment is needed for this one-time allowance.', async () => {
    await post(() => tap(card.getByRole('button', {
      name: 'Claim 100 free texts',
      exact: true,
    })), '/api/admin/salon/communications/starter-credits');
    await ready(card.getByText('100 free SMS credits have been added.', {
      exact: true,
    }));
  }, 2300);
  await step('Check the updated balance', 'Core booking stays free; SMS top-ups are optional.', async () => {
    await card.scrollIntoViewIfNeeded();
    await ready(card.getByText('100', {
      exact: true,
    }));
  }, 2500);
  evidence.usage = await api('/api/admin/salon/communications/usage?salonSlug=atelier-nail-demo');
  const again = await page.request.post(`${origin}/api/admin/salon/communications/starter-credits`, {
    headers: {
      origin,
    },
    data: {
      salonId: 'video-demo-salon-solo',
    },
  });
  if (!again.ok()) {
    throw new Error('Duplicate safety check refused');
  }
  const duplicate = await again.json();
  evidence.duplicate = {
    granted: duplicate.data?.granted,
    status: duplicate.data?.status,
  };
  if (evidence.duplicate.granted !== false || evidence.duplicate.status !== 'already_claimed') {
    throw new Error('Duplicate claim was not safely rejected');
  }
  evidence.scope = 'Actual isolated 100-credit grant and duplicate no-op. Development owner verification was prepared as a fixture, not delivered by SMS.';
};
