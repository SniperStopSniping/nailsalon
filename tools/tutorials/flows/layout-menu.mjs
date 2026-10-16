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
  await step('Choose your page layout', 'Arrange your booking page around your salon’s style.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Booking Page/,
    }));
    await tap(page.getByRole('link', {
      name: /^Layout & Menu/,
    }));
    await ready(page.getByRole('button', {
      name: /^Quiet Center/,
    }));
  });
  await step('Pick a booking-page design', 'Your services stay intact when the layout changes.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: /^Quiet Center/,
    })), '/api/admin/booking-page');
  });
  await step('Choose the service menu style', 'A clear service list helps clients find their treatment.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: /^Clean List/,
    })), '/api/admin/booking-page');
  });
  await step('Preview the saved layout', 'Check the private draft before publishing it.', async () => {
    const link = page.getByRole('link', {
      name: 'Preview draft',
      exact: true,
    });
    const url = new URL(await link.getAttribute('href'), page.url()).href;
    if (new URL(url).origin !== 'http://localhost:3149') {
      throw new Error('Preview must remain local');
    }
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
  evidence.saved = await api('/api/admin/booking-page?salonSlug=atelier-nail-demo');
  evidence.scope = 'Actual layout and menu draft saved and privately previewed. No hosted publication.';
};
