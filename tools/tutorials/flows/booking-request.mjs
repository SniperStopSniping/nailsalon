let appointmentId;
export async function prepare({
  ctx,
  origin,
  api,
}) {
  const settings = await api('/api/admin/salon/settings?salonSlug=atelier-nail-demo');
  if (settings.bookingConfig.confirmationMode !== 'request_approval') {
    throw new Error('Record the supported salon-wide approval setup first');
  }
  const guest = await ctx.browser().newContext({
    viewport: {
      width: 390,
      height: 844,
    },
  });
  try {
    const p = await guest.newPage();
    p.setDefaultTimeout(20000);
    await p.goto(`${origin}/en/atelier-nail-demo/book/service`);
    await p.getByTestId('service-card-video-demo-solo-service-biab-overlay').click();
    await p.getByTestId('service-continue-button').click();
    await p.getByTestId('calendar-day-2026-10-20').click();
    await p.locator('[data-testid="time-slot-9:00"], [data-testid="smart-fit-slot-9:00"]').first().click();
    await p.getByRole('textbox', {
      name: 'Customer name',
      exact: true,
    }).fill('Isabel Reed');
    await p.getByRole('textbox', {
      name: 'Customer email',
      exact: true,
    }).fill('isabel.reed@example.invalid');
    await p.getByRole('textbox', {
      name: 'Customer phone',
      exact: true,
    }).fill('4165550185');
    await p.getByRole('checkbox').last().check();
    const result = p.waitForResponse(r => new URL(r.url()).pathname === '/api/appointments' && r.request().method() === 'POST', {
      timeout: 45000,
    }).catch(error => ({
      error,
    }));
    await p.getByRole('button', {
      name: /^Request this time/i,
    }).click();
    const r = await result;
    if (r.error) {
      throw r.error;
    }
    if (!r.ok()) {
      throw new Error(`Synthetic request failed: ${r.status()}`);
    }
    const d = await r.json();
    appointmentId = d.data.appointmentId;
    if (d.data.appointment.status !== 'pending') {
      throw new Error('Salon-wide approval did not create a pending request');
    }
    await p.getByRole('heading', {
      name: 'Request received',
      exact: true,
    }).waitFor();
  } finally {
    await guest.close();
  }
}
export default async ({
  page,
  tap,
  ready,
  step,
  api,
  evidence,
}) => {
  await step('Open the client’s request', 'Review approval bookings before confirming the visit.', async () => {
    await tap(page.getByTestId('owner-nav-clients'));
    await tap(page.getByTestId('clients-directory-scroll').getByText('Isabel Reed', {
      exact: true,
    }));
    await tap(page.getByRole('combobox', {
      name: 'Client profile section',
    }));
    await page.getByRole('combobox', {
      name: 'Client profile section',
    }).selectOption('appointments');
    await tap(page.getByTestId(`client-appointment-change-${appointmentId}`));
    await ready(page.getByRole('button', {
      name: 'Confirm appointment',
      exact: true,
    }));
  });
  await step('Review the appointment details', 'Check the treatment, technician, time and price.', null, 2500);
  await step('Confirm the booking request', 'Approve only after you are ready to take the visit.', async () => {
    await tap(page.getByRole('button', {
      name: 'Confirm appointment',
      exact: true,
    }));
    await ready(page.getByRole('button', {
      name: 'Start appointment',
      exact: true,
    }));
  }, 2500);
  await step('Check the confirmed result', 'The original request now has a confirmed status.', async () => {
    const d = await api(`/api/appointments/${appointmentId}/manage?salonSlug=atelier-nail-demo`);
    evidence.saved = {
      id: d.data.appointment.id,
      status: d.data.appointment.status,
      startTime: d.data.appointment.startTime,
    };
    if (evidence.saved.status !== 'confirmed') {
      throw new Error('Request not confirmed');
    }
  }, 2500);
  evidence.scope = 'Actual guest request created through the local booking UI, then approved through the owner UI. No real customer, delivered message or payment.';
};
