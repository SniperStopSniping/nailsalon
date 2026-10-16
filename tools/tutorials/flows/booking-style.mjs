export default async ({
  page,
  ctx,
  tap,
  ready,
  step,
  post,
  api,
  evidence,
}) => {
  await step('Open your page design', 'Make your booking page feel like your salon.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Booking Page/,
    }));
    await tap(page.getByRole('link', {
      name: /^Style, Colours/,
    }));
    await ready(page.getByRole('button', {
      name: /^Soft/,
    }));
  });
  await step('Choose your style', 'Change the shapes and feel of the page.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: /^Soft/,
    })), '/api/admin/booking-page');
  });
  await step('Pick your colour palette', 'Use colours that suit your salon’s branding.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: /^Blush & Cocoa/,
    })), '/api/admin/booking-page');
  });
  await step('Choose a heading font', 'Pair an elegant heading with readable details.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: /^Newsreader heading font/,
    })), '/api/admin/booking-page');
  });
  await step('Preview the saved draft', 'Check the design before clients can see it.', async () => {
    const link = page.getByRole('link', {
      name: 'Preview draft',
      exact: true,
    });
    const url = new URL(await link.getAttribute('href'), page.url()).href;
    const opened = ctx.waitForEvent('page');
    await tap(link);
    const popup = await opened;
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
    });
    await popup.close();
    await ready(page.getByText('Private preview of your booking page', {
      exact: true,
    }));
  }, 2400);
  await step('Your draft is saved', 'Publish separately when you are happy with it.', null, 2400);
  evidence.saved = await api('/api/admin/booking-page?salonSlug=atelier-nail-demo');
  evidence.scope = 'Actual saved private draft only; no public publication in this tutorial.';
};
