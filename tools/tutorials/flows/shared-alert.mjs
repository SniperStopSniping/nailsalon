/* eslint-disable unicorn/prefer-dom-node-text-content -- UI recordings read rendered text, excluding hidden templates. */
export const salon = 'atelier-nail-demo-salon';
export default async ({
  page,
  tap,
  ready,
  step,
  evidence,
}) => {
  await step('Open your client list', 'Review recorded history before the next booking.', async () => {
    await tap(page.getByTestId('owner-nav-clients'));
    await ready(page.getByTestId('clients-directory-scroll').getByText('Maya Singh', {
      exact: true,
    }));
  });
  await step('Open the client profile', 'Participating salons see a limited history count.', async () => {
    await tap(page.getByTestId('clients-directory-scroll').getByText('Maya Singh', {
      exact: true,
    }));
    await ready(page.getByTestId('booking-risk-warning'));
  });
  await step('Review recorded history', 'Reports cover eligible visits in the last 12 months.', async () => {
    await page.getByTestId('booking-risk-warning').scrollIntoViewIfNeeded();
  }, 2300);
  await step('You choose how to proceed', 'This warning does not automatically block a client.', null, 2200);
  evidence.warning = await page.getByTestId('booking-risk-warning').innerText();
  if (!evidence.warning.includes('1 eligible no-show')) {
    throw new Error('Shared contribution not visible');
  }
  if (evidence.warning.includes('video-demo-salon-solo')) {
    throw new Error('Reporter identity exposed');
  }
  evidence.actor = 'Same development owner, authorized at a second synthetic salon';
};
