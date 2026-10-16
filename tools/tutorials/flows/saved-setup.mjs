export default async ({
  page,
  ctx,
  tap,
  ready,
  step,
  evidence,
}) => {
  await step('Review your saved setup', 'Revisit your booking-page choices without starting over.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Booking Page/,
    }));
    await tap(page.getByRole('link', {
      name: /^Review setup in the editors/,
    }));
    await ready(page.getByText('Guided review · Step 1 of 7 · Your current saved setup', {
      exact: true,
    }));
  });
  await step('Check what clients will see', 'Your saved business details stay together here.', async () => {
    await page.getByText('Business identity', {
      exact: true,
    }).scrollIntoViewIfNeeded();
  }, 2300);
  await step('Review location visibility', 'Choose how much of your address clients can see.', async () => {
    await tap(page.locator('summary').filter({
      hasText: 'Location',
    }));
    await ready(page.getByText('Address privacy', {
      exact: true,
    }));
  }, 2300);
  await step('Open your private preview', 'Review the draft before making a public change.', async () => {
    const link = page.getByRole('link', {
      name: 'Preview',
      exact: true,
    });
    const href = new URL(await link.getAttribute('href'), page.url()).href;
    if (new URL(href).origin !== 'http://localhost:3149') {
      throw new Error('Preview must stay local');
    }
    const opened = ctx.waitForEvent('page');
    await tap(link);
    const popup = await opened;
    await page.goto(href, {
      waitUntil: 'domcontentloaded',
    });
    await popup.close();
    await ready(page.getByText('Private preview of your booking page', {
      exact: true,
    }));
  }, 2400);
  evidence.scope = 'Actual saved-setup guided editor review and private preview. No setup reset, new AI generation or hosted publication.';
};
