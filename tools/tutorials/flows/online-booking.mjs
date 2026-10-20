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
  await step('Open your booking page', 'Give clients a clear way to book online.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Booking Page/,
    }));
    await ready(page.getByRole('link', {
      name: 'Open live site',
      exact: true,
    }));
  });
  await step('See the client experience', 'Open the same page your clients use.', async () => {
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
    await ready(page.getByTestId('service-card-video-demo-solo-service-biab-overlay'));
    evidence.customerSegment = 'anonymous view of same isolated public URL';
  });
  await step('Choose a treatment', 'Show the service price and appointment length.', async () => {
    await tap(page.getByTestId('service-card-video-demo-solo-service-biab-overlay'));
    await ready(page.getByTestId('service-addon-row-video-demo-solo-addon-simple-nail-art'));
  });
  await step('Add a little nail art', 'Reserve extra time for the extras they choose.', async () => {
    await tap(page.getByRole('button', {
      name: 'Add Simple Nail Art',
      exact: true,
    }));
    await tap(page.getByTestId('service-continue-button'));
    await ready(page.getByTestId('calendar-day-2026-10-16'));
  });
  await step('Choose an available time', 'Clients select from your live availability.', async () => {
    await tap(page.getByTestId('calendar-day-2026-10-16'));
    await ready(page.getByTestId('time-slot-9:00'));
    await tap(page.getByTestId('time-slot-9:00'));
    await ready(page.getByRole('textbox', {
      name: 'Customer name',
      exact: true,
    }));
  });
  await step('Add contact details', 'Keep booking details and recovery links together.', async () => {
    await fill(page.getByRole('textbox', {
      name: 'Customer name',
      exact: true,
    }), 'Nora Evans');
    await fill(page.getByRole('textbox', {
      name: 'Customer email',
      exact: true,
    }), 'nora.evans@example.invalid');
    await fill(page.getByRole('textbox', {
      name: 'Customer phone',
      exact: true,
    }), '4165550190');
  });
  await step('Review & confirm', 'Check the service, extras, timing and total.', async () => {
    await tap(page.getByRole('checkbox').last());
    const saved = await post(() => tap(page.getByRole('button', {
      name: /^Confirm appointment/,
    })), '/api/appointments');
    evidence.saved = {
      id: saved.data.appointmentId,
      status: saved.data.appointment.status,
      startTime: saved.data.appointment.startTime,
      price: saved.data.appointment.totalPrice,
    };
    await ready(page.getByText(/Appointment confirmed/i).first());
  }, 2400);
  await step('The booking is saved', 'The visit is now part of your salon’s schedule.', null, 2500);
};
