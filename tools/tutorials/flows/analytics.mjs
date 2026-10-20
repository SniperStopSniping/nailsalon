/* eslint-disable unicorn/prefer-dom-node-text-content -- UI recordings read rendered text, excluding hidden templates. */
export default async ({
  page,
  tap,
  ready,
  step,
  evidence,
}) => {
  await step('Open Analytics', 'See bookings and completed service revenue together.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Analytics/,
    }));
    await ready(page.getByRole('button', {
      name: 'Monthly',
      exact: true,
    }));
  });
  await step('Choose your reporting period', 'Switch to Monthly for a wider view.', async () => {
    await tap(page.getByRole('button', {
      name: 'Monthly',
      exact: true,
    }));
    await ready(page.getByText('Top services', {
      exact: true,
    }));
  });
  await step('Review your service mix', 'See which completed treatments contributed.', async () => {
    await page.getByText('Top services', {
      exact: true,
    }).scrollIntoViewIfNeeded();
  }, 2300);
  await step('Keep decisions grounded', 'Compare revenue, utilization and your team’s totals.', async () => {
    await page.getByText('Top performers', {
      exact: true,
    }).scrollIntoViewIfNeeded();
  }, 2300);
  evidence.report = await page.locator('body').innerText();
  if (!evidence.report.includes('$65.00')) {
    throw new Error('Completed synthetic revenue not shown');
  }
  evidence.scope = 'One $65 synthetic cash checkout; no revenue growth claim.';
};
