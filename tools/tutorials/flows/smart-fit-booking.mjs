/* eslint-disable unicorn/prefer-dom-node-text-content -- UI recordings read rendered text, excluding hidden templates. */
export async function prepare({
  page,
  tap,
  post,
  ready,
}) {
  // Isolate the Smart Fit example from the separate, higher-priority first-visit offer.
  await tap(page.getByTestId('owner-nav-services'));
  await tap(page.getByRole('button', {
    name: 'Advanced Settings',
    exact: true,
  }));
  await tap(page.getByTestId('services-tab-catalog'));
  await ready(page.getByRole('checkbox', {
    name: /^First-visit offer/,
  }));
  const offer = page.getByRole('checkbox', {
    name: /^First-visit offer/,
  });
  if (await offer.isChecked()) {
    await tap(offer);
    await post(() => tap(page.getByRole('button', {
      name: 'Save menu display',
      exact: true,
    })), '/api/admin/salon/settings');
    await ready(page.getByText('Saved', {
      exact: true,
    }));
  }
}
export default async ({
  page,
  ctx,
  origin,
  tap,
  fill,
  ready,
  step,
  post,
  evidence,
}) => {
  await step('Show clients a Smart Fit', 'Offer a discount on qualifying gaps in your schedule.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Booking Page/,
    }));
    await ready(page.getByRole('link', {
      name: 'Open live site',
      exact: true,
    }));
  });
  await step('Open the client booking page', 'Show the real booking choices your clients see.', async () => {
    const link = page.getByRole('link', {
      name: 'Open live site',
      exact: true,
    });
    const url = await link.getAttribute('href');
    if (!url.startsWith(`${origin}/`)) {
      throw new Error('Non-local booking page refused');
    }
    const popupPromise = ctx.waitForEvent('page');
    await tap(link);
    const popup = await popupPromise;
    await ctx.clearCookies();
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
    });
    await popup.close();
    await ready(page.getByTestId('service-card-video-demo-solo-service-gel-x-full-set'));
    evidence.customerSegment = 'anonymous view of same isolated public URL';
  });
  await step('Choose the treatment', 'Review the service, price and appointment length.', async () => {
    await tap(page.getByTestId('service-card-video-demo-solo-service-gel-x-full-set'));
    await tap(page.getByTestId('service-continue-button'));
    await ready(page.getByTestId('calendar-day-2026-10-21'));
  });
  await step('Select a qualifying Smart Fit', 'The available gap shows the saved discount and price.', async () => {
    await tap(page.getByTestId('calendar-day-2026-10-21'));
    await ready(page.getByTestId('smart-fit-slot-13:00'));
    evidence.displayedOffer = await page.getByTestId('smart-fit-slot-13:00').innerText();
    await tap(page.getByTestId('smart-fit-slot-13:00'));
    await ready(page.getByRole('textbox', {
      name: 'Customer name',
      exact: true,
    }));
  });
  await step('Add contact details', 'Keep booking details and recovery links together.', async () => {
    await fill(page.getByRole('textbox', {
      name: 'Customer name',
      exact: true,
    }), 'Noah Brooks');
    await fill(page.getByRole('textbox', {
      name: 'Customer email',
      exact: true,
    }), 'noah.brooks@example.invalid');
    await fill(page.getByRole('textbox', {
      name: 'Customer phone',
      exact: true,
    }), '4165550186');
  });
  await step('Review and confirm', 'Review the discount and any tax before confirming.', async () => {
    await tap(page.getByRole('checkbox').last());
    const saved = await post(() => tap(page.getByRole('button', {
      name: /Request appointment|Confirm appointment/i,
    })), '/api/appointments', true);
    evidence.saved = {
      id: saved.data.appointmentId,
      status: saved.data.appointment.status,
      startTime: saved.data.appointment.startTime,
      price: saved.data.appointment.totalPrice,
    };
    await ready(page.getByText('Appointment confirmed', {
      exact: true,
    }));
    if (evidence.saved.status !== 'confirmed') {
      throw new Error('Expected confirmed Smart Fit booking');
    }
  }, 2400);
  await step('Your booking is saved', 'The saved total includes the discount and your tax settings.', null, 2500);
  evidence.scope = 'Actual Smart Fit offer selected and saved as a confirmed booking. The separate first-visit offer was turned off through the local owner UI before recording because discounts do not stack. No payment, delivered message.';
};
